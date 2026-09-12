import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { useStore } from '@/lib/store';
import type { Settings } from '@/lib/types';
import { useLocation, useParams } from 'wouter';
import { 
  Play, Pause, X, Minus, Plus, Settings2, Maximize2, Minimize2, ChevronLeft, ChevronRight, Droplets, Loader2, Smartphone, Palette
} from 'lucide-react';
import { isDesktop, setOverlayMode, setAlwaysOnTop, startDragging } from '@/lib/desktop';
import { useLocalFlow } from '@/hooks/use-local-flow';
import { tokenize, NormalizedToken } from '@/lib/flow/tokenize';
import { FlowStatusPanel } from '@/components/flow-status-panel';
import { RemoteControlDialog } from '@/components/remote-control-dialog';
import { useReaderCommands } from '@/lib/remote/use-reader-commands';
import { useRemoteStore } from '@/lib/remote/store';
import { resolveCommandEffect } from '@/lib/remote/reducer';
import type { RemoteSnapshot } from '@/lib/remote/types';
import { invoke } from '@tauri-apps/api/core';
import { getReaderSurfacePresentation } from '@/lib/reader-surface';
import { getFontFamilyCss, getTextColorCss } from '@/lib/appearance';
import {
  findNearestReaderAnchor,
  getReaderAnchorOffset,
  restoreReaderScrollTop,
} from '@/lib/reader-position';
import { FlowSetupWizard } from '@/components/flow-setup-wizard';
import { usePresentationTimer } from '@/hooks/use-presentation-timer';
import { PresentationHUD } from '@/components/presentation-hud';
import { getElapsedMs } from '@/lib/presentation-timer';
import { AppearanceControls } from '@/components/appearance-controls';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type ReaderPositionSnapshot = {
  anchorId: string;
  anchorOffset: number;
  fallbackScrollTop: number;
};

export default function Reader() {
  const { scripts, settings, updateSettings: persistReaderSettings } = useStore();
  const params = useParams();
  const [_, setLocation] = useLocation();
  const script = scripts.find(s => s.id === params.id);

  const [isPlaying, setIsPlaying] = useState(false);
  const [readMode, setReadMode] = useState<"manual" | "flow">("flow");
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const textContentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pendingReflowPositionRef = useRef<ReaderPositionSnapshot | null>(null);

  // All reader settings changes, including phone font-size commands, pass here.
  // Measure BEFORE requesting a React update: parent layout-effect cleanup can
  // already see descendant host mutations and therefore cannot capture old text.
  const updateSettings = useCallback((updates: Partial<Settings>) => {
    const fontChanges =
      (updates.fontFamily !== undefined && updates.fontFamily !== settings.fontFamily) ||
      (updates.fontSize !== undefined && updates.fontSize !== settings.fontSize);
    const container = containerRef.current;
    const content = textContentRef.current;
    if (fontChanges && container && content) {
      const guideTop = container.getBoundingClientRect().top + container.clientHeight * 0.3;
      const anchors = Array.from(
        content.querySelectorAll<HTMLElement>('[data-reader-anchor]'),
      ).map(element => ({
        id: element.dataset.readerAnchor ?? '',
        top: element.getBoundingClientRect().top,
      }));
      const nearest = findNearestReaderAnchor(anchors, guideTop);
      pendingReflowPositionRef.current = {
        anchorId: nearest?.id ?? '',
        anchorOffset: nearest ? getReaderAnchorOffset(nearest.top, guideTop) : 0,
        fallbackScrollTop: container.scrollTop,
      };
    }
    persistReaderSettings(updates);
  }, [persistReaderSettings, settings.fontFamily, settings.fontSize]);

  useEffect(() => {
    if (readMode === 'flow') {
      const isSetupDone = localStorage.getItem('quickque-flow-setup-done') === 'true';
      if (!isSetupDone) {
        setShowWizard(true);
      }
    } else {
      setShowWizard(false);
    }
  }, [readMode]);
  
  const lastTimeRef = useRef<number>(0);
  const reqRef = useRef<number>(0);

  const [desktopError, setDesktopError] = useState<string | null>(null);

  // Pre-process tokens for Flow aligner
  const { tokens, enrichedSections } = useMemo(() => {
    if (!script) return { tokens: [], enrichedSections: [] };

    let globalIdx = 0;
    const allTokens: NormalizedToken[] = [];

    const sections = script.sections.map((sec, secIdx) => {
      const secTokens = tokenize(sec.content);
      const enriched = secTokens.map(t => ({
        ...t,
        sectionIdx: secIdx,
        globalTokenIdx: globalIdx++
      }));
      allTokens.push(...enriched);
      
      const spans: { type: 'text' | 'token'; text: string; startTokenIdx?: number; endTokenIdx?: number }[] = [];
      let lastEnd = 0;
      for (const token of enriched) {
        if (token.start > lastEnd) {
          spans.push({ type: 'text', text: sec.content.slice(lastEnd, token.start) });
        }
        if (token.end > lastEnd) {
          spans.push({ 
            type: 'token', 
            text: token.source, 
            startTokenIdx: token.globalTokenIdx, 
            endTokenIdx: token.globalTokenIdx 
          });
          lastEnd = token.end;
        } else {
          // One-to-many token mapped to the same span
          if (spans.length > 0 && spans[spans.length - 1].type === 'token') {
             spans[spans.length - 1].endTokenIdx = token.globalTokenIdx;
          }
        }
      }
      if (lastEnd < sec.content.length) {
        spans.push({ type: 'text', text: sec.content.slice(lastEnd) });
      }
      
      return { ...sec, spans, firstTokenIdx: enriched.length > 0 ? enriched[0].globalTokenIdx : null };
    });
    
    return { tokens: allTokens, enrichedSections: sections };
  }, [script]);

  const flow = useLocalFlow({ tokens, enabled: readMode === "flow" });

  useEffect(() => {
    const initDesktop = async () => {
      try {
        if (isDesktop()) {
          await setAlwaysOnTop(true);
          if (settings.compactMode) {
            document.documentElement.classList.add('is-overlay');
            await setOverlayMode(true);
          }
        } else if (settings.compactMode) {
          document.documentElement.classList.add('is-overlay');
        }
      } catch (err: any) {
        setDesktopError(`Failed to set always on top: ${err.message || String(err)}`);
      }
    };
    initDesktop();
    
    return () => {
      try {
        if (isDesktop()) {
          setAlwaysOnTop(false).catch(() => {});
          setOverlayMode(false).catch(() => {});
        }
      } catch (e) {}
      document.documentElement.classList.remove('is-overlay');
    };
  }, [settings.compactMode]);

  useEffect(() => {
    return () => {
      if (isDesktop()) {
        void useRemoteStore.getState().stopServer();
      }
    };
  }, []);

  const toggleCompactMode = useCallback(async () => {
    const newMode = !settings.compactMode;
    updateSettings({ compactMode: newMode });

    try {
      if (newMode) {
        document.documentElement.classList.add('is-overlay');
        if (isDesktop()) {
          await setOverlayMode(true);
        }
      } else {
        document.documentElement.classList.remove('is-overlay');
        if (isDesktop()) {
          await setOverlayMode(false);
        }
      }
    } catch (err: any) {
      setDesktopError(`Failed to toggle overlay mode: ${err.message || String(err)}`);
      updateSettings({ compactMode: !newMode });
      if (!newMode) {
        document.documentElement.classList.add('is-overlay');
      } else {
        document.documentElement.classList.remove('is-overlay');
      }
    }
  }, [settings.compactMode, updateSettings]);

  const exitReader = useCallback(async () => {
    setIsPlaying(false);
    flow.stop();
    try {
      if (isDesktop()) {
        await useRemoteStore.getState().stopServer();
        await setAlwaysOnTop(false);
        await setOverlayMode(false);
      }
    } catch (err: any) {
      setDesktopError(`Failed to exit overlay: ${err.message || String(err)}`);
    }
    document.documentElement.classList.remove('is-overlay');
    setLocation('/');
  }, [setLocation, flow]);

  const exactScrollTopRef = useRef<number>(0);
  const activeTokenSpanRef = useRef<HTMLSpanElement>(null);
  // Restore the pre-update word measurement after the new font has reflowed.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const pending = pendingReflowPositionRef.current;
    if (container && pending) {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      let targetScrollTop = Math.min(pending.fallbackScrollTop, maxScrollTop);
      const anchor = Array.from(
        textContentRef.current?.querySelectorAll<HTMLElement>('[data-reader-anchor]') ?? [],
      ).find(element => element.dataset.readerAnchor === pending.anchorId);
      if (anchor) {
        const containerRect = container.getBoundingClientRect();
        const guideTop = containerRect.top + container.clientHeight * 0.3;
        targetScrollTop = restoreReaderScrollTop(
          container.scrollTop,
          anchor.getBoundingClientRect().top,
          guideTop,
          pending.anchorOffset,
          maxScrollTop,
        );
      }
      container.scrollTop = targetScrollTop;
      exactScrollTopRef.current = targetScrollTop;
      pendingReflowPositionRef.current = null;
    }

  }, [settings.fontFamily, settings.fontSize]);

  // Manual Scrolling logic
  useEffect(() => {
    if (readMode !== "manual" || !isPlaying) {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
      return;
    }

    if (containerRef.current) {
      exactScrollTopRef.current = containerRef.current.scrollTop;
    }

    const scrollLoop = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const deltaTime = Math.min(time - lastTimeRef.current, 50);
      lastTimeRef.current = time;

      if (containerRef.current && textContentRef.current) {
        const pxPerSecond = (settings.speed / 50) * (settings.fontSize * 1.5);
        const pxPerFrame = (pxPerSecond * deltaTime) / 1000;
        
        const maxScroll = containerRef.current.scrollHeight - containerRef.current.clientHeight;
        if (containerRef.current.scrollTop < maxScroll) {
          exactScrollTopRef.current += pxPerFrame;
          containerRef.current.scrollTop = exactScrollTopRef.current;
        } else {
          setIsPlaying(false);
        }
      }
      reqRef.current = requestAnimationFrame(scrollLoop);
    };

    reqRef.current = requestAnimationFrame(scrollLoop);
    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
      lastTimeRef.current = 0;
    };
  }, [isPlaying, readMode, settings.speed, settings.fontSize]);

  // Flow Smooth scroll following active token ONLY on confident matching
  useEffect(() => {
    if (readMode !== "flow" || flow.status !== 'listening' || !flow.isFollowing) {
      return;
    }

    let req: number;
    const loop = () => {
      if (activeTokenSpanRef.current && containerRef.current) {
        const span = activeTokenSpanRef.current;
        const container = containerRef.current;
        
        const spanRect = span.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        
        // Target is to keep the span at 30% of the container height
        const targetViewportY = containerRect.top + containerRect.height * 0.3;
        const delta = spanRect.top - targetViewportY;
        
        if (Math.abs(delta) > 5) {
          container.scrollTop += delta * 0.05;
          exactScrollTopRef.current = container.scrollTop;
        }
      }
      req = requestAnimationFrame(loop);
    };
    req = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(req);
  }, [
    readMode,
    flow.status,
    flow.isFollowing,
    flow.anchor,
    settings.fontFamily,
    settings.fontSize,
  ]);

  // Section tracking during scroll (only in manual mode or paused)
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      if (readMode === 'flow' && ['listening', 'loading'].includes(flow.status)) return;
      
      const scrollY = containerRef.current.scrollTop;
      const viewportMid = scrollY + containerRef.current.clientHeight / 3;

      let currentIdx = 0;
      for (let i = 0; i < sectionRefs.current.length; i++) {
        const el = sectionRefs.current[i];
        if (el && el.offsetTop <= viewportMid) {
          currentIdx = i;
        }
      }
      
      if (currentIdx !== activeSectionIdx) {
        setActiveSectionIdx(currentIdx);
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
    return undefined;
  }, [activeSectionIdx, readMode, flow.status]);

  // Auto-advance section tracking in Flow mode
  useEffect(() => {
    if (readMode !== "flow") return;
    const currentAnchor = flow.anchor;
    let targetSecIdx = activeSectionIdx;
    
    for (let i = 0; i < enrichedSections.length; i++) {
      const sec = enrichedSections[i];
      if (sec.spans.length === 0) continue;
      const lastSpan = sec.spans.slice().reverse().find(s => s.type === 'token');
      if (!lastSpan) continue;
      
      const firstToken = sec.firstTokenIdx;
      const lastToken = lastSpan.endTokenIdx!;
      
      if (firstToken !== null && currentAnchor >= firstToken && currentAnchor <= lastToken + 1) {
        targetSecIdx = i;
        if (currentAnchor > lastToken && i < enrichedSections.length - 1) {
          targetSecIdx = i + 1;
        }
        break;
      }
    }
    
    if (targetSecIdx !== activeSectionIdx) {
      setActiveSectionIdx(targetSecIdx);
    }
  }, [flow.anchor, readMode, enrichedSections, activeSectionIdx]);

  const reanchorRef = useRef(flow.reanchor);
  reanchorRef.current = flow.reanchor;

  const jumpToSection = useCallback((idx: number) => {
    if (!script) return;
    if (idx < 0 || idx >= script.sections.length) return;
    
    const el = sectionRefs.current[idx];
    if (el && containerRef.current) {
      const offset = el.offsetTop - (containerRef.current.clientHeight * 0.3);
      const targetTop = offset > 0 ? offset : 0;
      exactScrollTopRef.current = targetTop;
      containerRef.current.scrollTo({ top: targetTop, behavior: 'auto' });
      setActiveSectionIdx(idx);

      if (readMode === "flow" && enrichedSections[idx]) {
        const firstToken = enrichedSections[idx].firstTokenIdx;
        if (firstToken !== null) {
          reanchorRef.current(firstToken);
        }
      }
    }
  }, [script, readMode, enrichedSections]);

  const flowRef = useRef(flow);
  flowRef.current = flow;
  const readModeRef = useRef(readMode);
  readModeRef.current = readMode;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const activeSectionIdxRef = useRef(activeSectionIdx);
  activeSectionIdxRef.current = activeSectionIdx;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Single authoritative presentation timer hook replacing independent elapsedRef accumulation
  const isTimerActive = readMode === 'manual' ? isPlaying : flow.status === 'listening';
  const { timerState, reset: resetTimer } = usePresentationTimer(isTimerActive, script?.id || '');
  const timerStateRef = useRef(timerState);
  timerStateRef.current = timerState;

  const dispatchCommand = useCallback((cmd: any) => {
    if (!script) return;

    const effect = resolveCommandEffect(cmd, {
      readMode: readModeRef.current,
      isPlaying: isPlayingRef.current,
      flowStatus: flowRef.current.status,
      activeSectionIdx: activeSectionIdxRef.current,
      sectionCount: script.sections.length,
      speed: settingsRef.current.speed,
      fontSize: settingsRef.current.fontSize
    });

    if (!effect) return;

    switch (effect.type) {
      case 'setPlaying':
        isPlayingRef.current = effect.playing;
        setIsPlaying(effect.playing);
        break;
      case 'flowStart':
        flowRef.current.start();
        break;
      case 'flowPause':
        flowRef.current.pause();
        break;
      case 'jumpToSection':
        activeSectionIdxRef.current = effect.index;
        jumpToSection(effect.index);
        break;
      case 'setSpeed':
        settingsRef.current = { ...settingsRef.current, speed: effect.speed };
        updateSettings({ speed: effect.speed });
        break;
      case 'setFontSize':
        settingsRef.current = { ...settingsRef.current, fontSize: effect.fontSize };
        updateSettings({ fontSize: effect.fontSize });
        break;
      case 'adjustPosition':
        if (containerRef.current) {
          const max = Math.max(0, containerRef.current.scrollHeight - containerRef.current.clientHeight);
          exactScrollTopRef.current = Math.max(0, Math.min(max, exactScrollTopRef.current + effect.delta));
          containerRef.current.scrollTop = exactScrollTopRef.current;
        }
        break;
      case 'setReadMode':
        readModeRef.current = effect.mode;
        setReadMode(effect.mode);
        if (effect.mode === 'flow') {
          isPlayingRef.current = false;
          setIsPlaying(false);
          const targetAnchor = enrichedSections[activeSectionIdxRef.current]?.firstTokenIdx ?? 0;
          flowRef.current.reanchor(targetAnchor);
        } else {
          flowRef.current.stop();
        }
        break;
    }
  }, [script, jumpToSection, updateSettings, enrichedSections]);

  useReaderCommands(dispatchCommand);

  // State publishing
  const { isRunning, isApproved } = useRemoteStore();

  const publishSnapshot = useCallback(() => {
    if (!script || !isRunning || !isApproved) return;
    const snapshot: RemoteSnapshot = {
      mode: readModeRef.current,
      section: activeSectionIdx,
      sectionCount: script.sections.length,
      elapsedMs: getElapsedMs(timerStateRef.current, performance.now()),
      playing: readModeRef.current === 'manual' ? isPlaying : flowRef.current.status === 'listening',
      fontSize: settings.fontSize,
      scrollSpeed: settings.speed,
      position: exactScrollTopRef.current
    };
    invoke('remote_publish_state', { snapshot }).catch(() => {});
  }, [script, isRunning, isApproved, activeSectionIdx, isPlaying, settings.fontSize, settings.speed]);

  useEffect(() => {
    publishSnapshot();
  }, [publishSnapshot]);

  useEffect(() => {
    if (!isRunning || !isApproved) return;
    const interval = setInterval(publishSnapshot, 1000);
    return () => clearInterval(interval);
  }, [isRunning, isApproved, publishSnapshot]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Let the pairing dialog handle Escape and focused buttons. Closing it
      // must not also exit the reader and tear down the local session.
      if (e.defaultPrevented ||
          (e.target instanceof Element && e.target.closest('[role="dialog"]'))) return;
      if (
        e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement || 
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement).isContentEditable
      ) return;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

      if (e.code === 'Space') {
        e.preventDefault();
        dispatchCommand({ type: 'TogglePlay' });
      } else if (e.code === 'Escape') {
        e.preventDefault();
        exitReader();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        dispatchCommand({ type: 'NextSection' });
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        dispatchCommand({ type: 'PreviousSection' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [exitReader, dispatchCommand]);

  // External Native Controls
  useEffect(() => {
    const handleNativeControl = (e: any) => {
      dispatchCommand(e);
    };
    
    window.addEventListener('quickque:control', handleNativeControl);
    return () => window.removeEventListener('quickque:control', handleNativeControl);
  }, [dispatchCommand]);

  // Auto-hide controls
  useEffect(() => {
    let timeout: number;
    const isActivelyPlaying = readMode === 'manual' ? isPlaying : flow.status === 'listening';
    const resetHide = () => {
      setShowControls(true);
      clearTimeout(timeout);
      if (isActivelyPlaying) {
        timeout = window.setTimeout(() => setShowControls(false), 3000);
      }
    };
    
    window.addEventListener('mousemove', resetHide);
    if (isActivelyPlaying) {
      resetHide();
    } else {
      setShowControls(true);
    }
    
    return () => {
      window.removeEventListener('mousemove', resetHide);
      clearTimeout(timeout);
    };
  }, [isPlaying, readMode, flow.status]);

  if (!script) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-4 text-center">
        <h2 className="text-2xl font-semibold mb-2">Script not found</h2>
        <p className="text-muted-foreground mb-8">The script you are trying to read doesn't exist.</p>
        <button 
          onClick={exitReader} 
          className="px-6 py-3 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  const readerSurface = getReaderSurfacePresentation(
    settings.compactMode,
    settings.backgroundOpacity,
  );

  return (
    <div 
      className={`flex flex-col transition-all duration-300 ${readerSurface.className}`}
      style={readerSurface.style}
    >
      {/* Title Bar (Draggable in compact mode) */}
      <div 
        className={`flex flex-col z-50 transition-opacity duration-300 ${showControls || (readMode === 'manual' ? !isPlaying : flow.status !== 'listening') ? 'opacity-100' : 'opacity-0'}`}
        onMouseDown={async (e) => {
          if (settings.compactMode && !(e.target as HTMLElement).closest('button, input, select')) {
            try {
              if (isDesktop()) {
                await startDragging();
              }
            } catch (err: any) {
              setDesktopError(`Drag failed: ${err.message || String(err)}`);
            }
          }
        }}
      >
        {desktopError && (
          <div className="bg-destructive/90 text-destructive-foreground text-xs px-3 py-1.5 flex justify-between items-center backdrop-blur-md">
            <span>{desktopError}</span>
            <button onClick={() => setDesktopError(null)}>Dismiss</button>
          </div>
        )}
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-4">
            <button 
              onClick={exitReader}
              className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors backdrop-blur-md"
              title="Exit (Esc)"
               aria-label="Exit reader"
            >
               <X className="w-5 h-5" aria-hidden="true" />
            </button>
            
            <div className="flex items-center gap-1">
              <button 
                onClick={toggleCompactMode}
                className={`p-2 rounded-full transition-colors backdrop-blur-md ${settings.compactMode ? 'bg-primary text-primary-foreground' : 'hover:bg-black/10 dark:hover:bg-white/10'}`}
                title="Toggle Compact Overlay"
              >
                {settings.compactMode ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
              </button>

              <div className="flex items-center">
                <RemoteControlDialog
                  trigger={
                    <button
                      className="p-2 rounded-full transition-colors backdrop-blur-md hover:bg-black/10 dark:hover:bg-white/10"
                      title="Phone Remote"
                      aria-label="Open phone remote"
                    >
                      <Smartphone className="w-4 h-4" aria-hidden="true" />
                    </button>
                  }
                />
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="p-2 rounded-full transition-colors backdrop-blur-md hover:bg-black/10 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Script appearance"
                    aria-label="Open script appearance settings"
                  >
                    <Palette className="w-4 h-4" aria-hidden="true" />
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-[min(92vw,32rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:p-6">
                  <DialogHeader>
                    <DialogTitle>Script appearance</DialogTitle>
                    <DialogDescription>
                      Choose the font and text colour for script copy in the
                      editor and reader.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex items-center justify-between gap-3" role="group" aria-label="Script text size">
                    <span className="font-medium">Text size</span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        aria-label="Decrease script text size"
                        disabled={settings.fontSize <= 16}
                        onClick={() => dispatchCommand({ action: 'fontSize', value: -4 })}
                        className="rounded-md border border-border p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Minus className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <output className="min-w-[4ch] text-center font-mono text-sm">{settings.fontSize}px</output>
                      <button
                        type="button"
                        aria-label="Increase script text size"
                        disabled={settings.fontSize >= 120}
                        onClick={() => dispatchCommand({ action: 'fontSize', value: 4 })}
                        className="rounded-md border border-border p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <AppearanceControls settings={settings} updateSettings={updateSettings} />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-background/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-border/50 overflow-hidden text-sm max-w-full">
            <div className="flex items-center gap-1.5 flex-1 min-w-[80px]">
              <select
                value={readMode}
                onChange={e => {
                  dispatchCommand({ action: 'setReadMode', mode: e.target.value as "manual" | "flow" });
                }}
                className="bg-transparent border-none outline-none text-foreground font-semibold text-xs cursor-pointer"
              >
                <option value="manual">Manual Scroll</option>
                <option value="flow">Voice Follow</option>
              </select>
            </div>

            <div className="w-px h-4 bg-border mx-1" />

            <div className="flex items-center gap-1">
              <button 
                onClick={() => dispatchCommand({ action: 'fontSize', value: -4 })}
                className="p-1 hover:text-primary transition-colors"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="font-mono min-w-[3ch] text-center text-xs">{settings.fontSize}</span>
              <button 
                onClick={() => dispatchCommand({ action: 'fontSize', value: 4 })}
                className="p-1 hover:text-primary transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            
            <div className="w-px h-4 bg-border mx-1" />
            
            <div className="flex items-center gap-1.5 flex-1 min-w-[60px]">
              <Settings2 className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <input 
                type="range" 
                min="10" 
                max="150" 
                value={settings.speed}
                title="Scroll Speed"
                onChange={e => dispatchCommand({ action: 'scrollSpeed', value: parseInt(e.target.value) - settings.speed })}
                className="w-12 md:w-20 accent-primary"
                disabled={readMode === 'flow'}
                style={{ opacity: readMode === 'flow' ? 0.5 : 1 }}
              />
            </div>

            <div className="w-px h-4 bg-border mx-1" />

            <div className="flex items-center gap-1.5 flex-1 min-w-[60px]">
              <Droplets className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={settings.backgroundOpacity}
                title="Background Opacity"
                onChange={e => updateSettings({ backgroundOpacity: parseInt(e.target.value) })}
                className="w-12 md:w-20 accent-primary"
              />
            </div>
          </div>
        </div>
      </div>

      <PresentationHUD
        mode={readMode}
        status={flow.status}
        isFollowing={flow.isFollowing}
        audioLevelRef={flow.audioLevelRef}
        timerState={timerState}
        onResetTimer={resetTimer}
      />

      {/* Reader Content Area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Read Marker (Resume here marker) */}
        <div className="absolute left-0 right-0 top-[30%] h-[2px] bg-primary/70 z-30 pointer-events-none flex items-center">
          <div className="w-3 h-3 bg-primary rounded-full ml-4" />
          {readMode === 'manual' && !isPlaying && (
            <div className="ml-3 px-2 py-0.5 rounded text-xs font-bold bg-primary text-primary-foreground shadow-sm uppercase tracking-wider animate-in fade-in zoom-in duration-200">
              Paused - Space to resume
            </div>
          )}
          {readMode === 'flow' && ['paused', 'silence-stopped', 'stopped', 'ready'].includes(flow.status) && (
            <div className="ml-3 px-2 py-0.5 rounded text-xs font-bold bg-primary text-primary-foreground shadow-sm uppercase tracking-wider animate-in fade-in zoom-in duration-200">
              {flow.status === 'ready' ? 'Ready - Start to begin' : flow.status === 'silence-stopped' ? '30 seconds of silence — stopped' : 'Paused - Space to resume'}
            </div>
          )}
          {readMode === 'flow' && flow.status === 'loading' && (
            <div className="ml-3 px-2 py-0.5 rounded text-xs font-bold bg-primary text-primary-foreground shadow-sm uppercase tracking-wider animate-in fade-in zoom-in duration-200">
              Preparing Apple speech...
            </div>
          )}
          {readMode === 'flow' && flow.status === 'listening' && (
            <div className="ml-3 px-2 py-0.5 rounded text-xs font-bold bg-primary text-primary-foreground shadow-sm uppercase tracking-wider animate-in fade-in zoom-in duration-200">
              {flow.isFollowing ? 'Following' : 'Listening — waiting for script'}
            </div>
          )}
        </div>

        {/* Scrollable Container */}
        <div 
          ref={containerRef}
          className="absolute inset-0 overflow-y-auto px-6 md:px-24 pb-[80vh]"
          style={{ 
            paddingTop: '30vh',
            fontSize: `${settings.fontSize}px`,
            lineHeight: 1.5
          }}
        >
          <div
            ref={textContentRef}
            className="max-w-4xl mx-auto space-y-[10vh]"
            style={{
              fontFamily: getFontFamilyCss(settings.fontFamily),
              color: getTextColorCss(settings.textColor),
            }}
          >
            {enrichedSections.map((section, idx) => (
              <div 
                key={section.id} 
                ref={el => { sectionRefs.current[idx] = el; }}
                className={`transition-opacity duration-500 ${activeSectionIdx === idx ? 'opacity-100' : 'opacity-30'}`}
              >
                {enrichedSections.length > 1 && (
                  <h3 
                    className="font-bold text-primary mb-6 flex items-center gap-4"
                    style={{ fontSize: `${settings.fontSize * 0.75}px` }}
                  >
                    <span className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-mono tracking-tighter">
                      {idx + 1}
                    </span>
                    {section.title}
                  </h3>
                )}
                <div 
                  className="whitespace-pre-wrap font-medium tracking-tight"
                >
                  {section.spans.map((span, i) => {
                     if (span.type === 'text') {
                       return (
                         <span
                           key={i}
                           data-reader-anchor={`${section.id}:${i}`}
                         >
                           {span.text}
                         </span>
                       );
                    } else {
                      const isRead = flow.anchor > span.endTokenIdx!;
                      const isActive = flow.anchor >= span.startTokenIdx! && flow.anchor <= span.endTokenIdx!;
                      
                      let className = "transition-colors duration-200 ";
                      if (readMode === "flow") {
                        if (isActive) {
                          className += "text-primary bg-primary/20 rounded px-1 py-0.5 shadow-sm";
                        } else if (isRead) {
                          className += "text-muted-foreground opacity-60";
                        }
                      }
                      
                      return (
                        <span 
                          key={i} 
                          data-reader-anchor={`${section.id}:${i}`}
                          className={className}
                          ref={isActive ? activeTokenSpanRef : null}
                        >
                          {span.text}
                        </span>
                      );
                    }
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {readMode === 'flow' && !showWizard && (
        <FlowStatusPanel 
          flow={flow} 
          onCancelMode={() => setReadMode('manual')} 
          onOpenWizard={() => setShowWizard(true)}
        />
      )}

      {showWizard && (
        <FlowSetupWizard
          flow={flow}
          onComplete={() => {
            localStorage.setItem('quickque-flow-setup-done', 'true');
            setShowWizard(false);
          }}
          onCancel={() => {
            const isSetupDone = localStorage.getItem('quickque-flow-setup-done') === 'true';
            if (!isSetupDone) {
              setReadMode('manual');
              flow.stop();
            }
            setShowWizard(false);
          }}
        />
      )}

      {/* Bottom Controls / Section Navigation */}
      <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 md:gap-4 p-2 md:p-3 rounded-full bg-background/80 backdrop-blur-xl border border-border shadow-2xl z-50 transition-all duration-300 ${showControls || (readMode === 'manual' ? !isPlaying : flow.status !== 'listening') ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>
        
        <button
          onClick={() => dispatchCommand({ action: 'previous' })}
          disabled={activeSectionIdx === 0}
          className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
          title="Previous Section (Left Arrow)"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <select
          value={activeSectionIdx}
          onChange={(e) => dispatchCommand({ action: 'jumpToSection', value: Number(e.target.value) })}
          className="bg-transparent font-medium text-foreground appearance-none outline-none text-center text-sm px-2 w-32 md:w-48 truncate cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded"
        >
          {enrichedSections.map((sec, idx) => (
            <option key={sec.id} value={idx}>
              {idx + 1}. {sec.title || 'Untitled'}
            </option>
          ))}
        </select>

        <button
          onClick={() => dispatchCommand({ action: 'next' })}
          disabled={activeSectionIdx === enrichedSections.length - 1}
          className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
          title="Next Section (Right Arrow)"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        
        <div className="w-px h-6 bg-border mx-1" />
        
        <button
          onClick={() => dispatchCommand({ action: 'playPause' })}
          disabled={readMode === 'flow' && !['ready', 'listening', 'paused', 'silence-stopped', 'stopped', 'loading', 'error'].includes(flow.status)}
          className="w-14 h-14 flex items-center justify-center bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 hover:scale-105 transition-all focus:outline-none focus:ring-4 focus:ring-primary/30 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
        >
          {readMode === 'flow' && flow.status === 'loading' ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            (readMode === 'manual' ? isPlaying : flow.status === 'listening') ? 
              <Pause className="w-6 h-6 fill-current" /> : 
              <Play className="w-6 h-6 fill-current ml-1" />
          )}
        </button>
      </div>

    </div>
  );
}
