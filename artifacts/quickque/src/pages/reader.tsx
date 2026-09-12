import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { useStore } from '@/lib/store';
import type { PresentationPreferences, Settings } from '@/lib/types';
import { useLocation, useParams } from 'wouter';
import { 
  Play, Pause, X, Minus, Plus, Settings2, Maximize2, Minimize2, ChevronLeft, ChevronRight, Droplets, Loader2, Smartphone, Palette
} from 'lucide-react';
import { isDesktop, setOverlayMode, setAlwaysOnTop, startDragging } from '@/lib/desktop';
import { useLocalFlow } from '@/hooks/use-local-flow';
import { ReaderTokenizationCache } from '@/lib/reader-tokenization';
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
} from '@/lib/reader-position';
import { FlowSetupWizard } from '@/components/flow-setup-wizard';
import { usePresentationTimer } from '@/hooks/use-presentation-timer';
import { PresentationHUD } from '@/components/presentation-hud';
import { getElapsedMs } from '@/lib/presentation-timer';
import { PresentationControls } from '@/components/presentation-controls';
import {
  clientDeltaToLogicalScroll,
  getLogicalLeadingEdge,
  getLogicalScrollCoordinate,
  getReaderTopPaddingPx,
  getReaderViewportTransform,
  restoreLogicalReaderScrollTop,
} from '@/lib/reader-geometry';
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
  verticalMirror: boolean;
};

function affectsReaderLayout(
  updates: Partial<PresentationPreferences>,
  current: PresentationPreferences,
): boolean {
  return (
    (updates.fontSize !== undefined && updates.fontSize !== current.fontSize) ||
    (updates.fontFamily !== undefined && updates.fontFamily !== current.fontFamily) ||
    (updates.lineSpacing !== undefined && updates.lineSpacing !== current.lineSpacing) ||
    (updates.horizontalMargin !== undefined &&
      updates.horizontalMargin !== current.horizontalMargin) ||
    (updates.cuePosition !== undefined && updates.cuePosition !== current.cuePosition) ||
    (updates.cueStyle !== undefined && updates.cueStyle !== current.cueStyle) ||
    (updates.mirrorHorizontal !== undefined &&
      updates.mirrorHorizontal !== current.mirrorHorizontal) ||
    (updates.mirrorVertical !== undefined && updates.mirrorVertical !== current.mirrorVertical)
  );
}

export default function Reader() {
  const {
    scripts,
    settings,
    error,
    presentationDefaults,
    updateScriptPresentation,
    resetScriptPresentation,
    updateSettings: persistAppSettings,
  } = useStore();
  const params = useParams();
  const [_, setLocation] = useLocation();
  const script = scripts.find(s => s.id === params.id);
  // Presentation is document data. App settings intentionally remain limited
  // to app/overlay concerns, so one script's prompter layout cannot alter
  // another script or the editor.
  const presentation = useMemo<PresentationPreferences>(() => ({
    ...presentationDefaults,
    ...(script?.presentation ?? {}),
  }), [presentationDefaults, script?.presentation]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [readMode, setReadMode] = useState<"manual" | "flow">("flow");
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const textContentRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pendingReflowPositionRef = useRef<ReaderPositionSnapshot | null>(null);
  const stableReaderPositionRef = useRef<ReaderPositionSnapshot | null>(null);
  const stableViewportRef = useRef({ width: 0, height: 0 });
  const [reflowRevision, setReflowRevision] = useState(0);
  const [readerViewportHeight, setReaderViewportHeight] = useState(0);
  const scrollMeasurementFrameRef = useRef<number>(0);
  const exactScrollTopRef = useRef<number>(0);
  const activeTokenSpanRef = useRef<HTMLSpanElement>(null);

  /**
   * Capture before state is requested, never from an effect cleanup. React may
   * have committed descendant style changes by then, which loses the old word
   * geometry (see reader-reflow-anchoring.md).
   */
  const measureReaderPosition = useCallback((): ReaderPositionSnapshot | null => {
    const container = containerRef.current;
    const content = textContentRef.current;
    const cue = cueRef.current;
    if (container && content && cue) {
      const verticalMirror = presentation.mirrorVertical;
      const guideTop = getLogicalLeadingEdge(cue.getBoundingClientRect(), verticalMirror);
      const anchors = Array.from(
        content.querySelectorAll<HTMLElement>('[data-reader-anchor]'),
      ).map(element => ({
        id: element.dataset.readerAnchor ?? '',
        top: getLogicalLeadingEdge(element.getBoundingClientRect(), verticalMirror),
      }));
      const nearest = findNearestReaderAnchor(anchors, guideTop);
      return {
        anchorId: nearest?.id ?? '',
        anchorOffset: nearest ? getReaderAnchorOffset(nearest.top, guideTop) : 0,
        fallbackScrollTop: container.scrollTop,
        verticalMirror,
      };
    }
    return null;
  }, [presentation.mirrorVertical]);

  const captureReaderPosition = useCallback(() => {
    const snapshot = measureReaderPosition();
    if (snapshot) {
      stableReaderPositionRef.current = snapshot;
      pendingReflowPositionRef.current = snapshot;
    }
  }, [measureReaderPosition]);

  // Wheel/trackpad scrolling does not rerender. Cache the currently read word
  // on the next frame so a later ResizeObserver starts from the user's actual
  // reading position, while a pending presentation reflow stays authoritative.
  const queueStableReaderPosition = useCallback(() => {
    if (scrollMeasurementFrameRef.current) return;
    scrollMeasurementFrameRef.current = requestAnimationFrame(() => {
      scrollMeasurementFrameRef.current = 0;
      if (pendingReflowPositionRef.current) return;
      const container = containerRef.current;
      // Resize-generated scroll events must not replace the last pre-resize
      // word before ResizeObserver has delivered the new dimensions.
      if (!container || container.clientWidth !== stableViewportRef.current.width ||
        container.clientHeight !== stableViewportRef.current.height) return;
      const snapshot = measureReaderPosition();
      if (snapshot) {
        stableReaderPositionRef.current = snapshot;
        exactScrollTopRef.current = snapshot.fallbackScrollTop;
      }
    });
  }, [measureReaderPosition]);

  useEffect(() => () => {
    if (scrollMeasurementFrameRef.current) {
      cancelAnimationFrame(scrollMeasurementFrameRef.current);
    }
  }, []);

  // Remote speed/font commands use this exact path and only mutate the
  // current script's presentation, never app-wide defaults.
  const updatePresentation = useCallback((updates: Partial<PresentationPreferences>): boolean => {
    if (!script) return false;
    if (affectsReaderLayout(updates, presentation)) {
      captureReaderPosition();
    } else {
      // A colour/opacity-only commit does not run the reflow layout effect.
      // Do not leave an old snapshot around to interfere with a later resize.
      pendingReflowPositionRef.current = null;
    }
    const saved = updateScriptPresentation(script.id, updates);
    if (!saved) {
      pendingReflowPositionRef.current = null;
    }
    return saved;
  }, [captureReaderPosition, presentation, script, updateScriptPresentation]);

  const resetCurrentPresentation = useCallback((): boolean => {
    if (!script) return false;
    captureReaderPosition();
    const saved = resetScriptPresentation(script.id);
    if (!saved) {
      pendingReflowPositionRef.current = null;
    }
    return saved;
  }, [captureReaderPosition, resetScriptPresentation, script]);

  const updateAppSettings = useCallback((updates: Partial<Settings>) => {
    if (updates.compactMode !== undefined && updates.compactMode !== settings.compactMode) {
      captureReaderPosition();
    }
    persistAppSettings(updates);
  }, [captureReaderPosition, persistAppSettings, settings.compactMode]);

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

  // commitLibrary defensively clones every script section for a presentation
  // edit. A structural cache, rather than a `useMemo([script.sections])`,
  // keeps the exact Flow token array/aligner input stable in that case.
  const tokenizationCacheRef = useRef(new ReaderTokenizationCache());
  const { tokens, enrichedSections } = tokenizationCacheRef.current.get(
    script?.id ?? '',
    script?.sections ?? [],
  );

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
    updateAppSettings({ compactMode: newMode });

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
      updateAppSettings({ compactMode: !newMode });
      if (!newMode) {
        document.documentElement.classList.add('is-overlay');
      } else {
        document.documentElement.classList.remove('is-overlay');
      }
    }
  }, [settings.compactMode, updateAppSettings]);

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

  // Restore the pre-update word measurement after the new font has reflowed.
  useLayoutEffect(() => {
    const container = containerRef.current;
    // Do not snapshot the temporary, zero-padding first render or a resize
    // whose viewport-relative spacer has not yet committed.
    if (!container || readerViewportHeight === 0 ||
      readerViewportHeight !== container.clientHeight) return;
    // Defaults can change outside this component. In that case there was no
    // event handler in which to synchronously capture, so use the prior
    // layout-effect measurement rather than accepting a reading-position jump.
    const pending = pendingReflowPositionRef.current ?? stableReaderPositionRef.current;
    if (container && pending) {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      let targetScrollTop = Math.min(pending.fallbackScrollTop, maxScrollTop);
      const anchor = Array.from(
        textContentRef.current?.querySelectorAll<HTMLElement>('[data-reader-anchor]') ?? [],
      ).find(element => element.dataset.readerAnchor === pending.anchorId);
      const cue = cueRef.current;
      if (anchor && cue) {
        const guideTop = getLogicalLeadingEdge(
          cue.getBoundingClientRect(),
          presentation.mirrorVertical,
        );
        targetScrollTop = restoreLogicalReaderScrollTop(
          container.scrollTop,
          getLogicalLeadingEdge(anchor.getBoundingClientRect(), presentation.mirrorVertical),
          guideTop,
          pending.anchorOffset,
          maxScrollTop,
          presentation.mirrorVertical,
          pending.verticalMirror,
        );
      }
      container.scrollTop = targetScrollTop;
      exactScrollTopRef.current = targetScrollTop;
      pendingReflowPositionRef.current = null;
    }
    const stable = measureReaderPosition();
    if (stable) stableReaderPositionRef.current = stable;
    stableViewportRef.current = {
      width: container.clientWidth,
      height: container.clientHeight,
    };

  }, [
    presentation.fontFamily,
    presentation.fontSize,
    presentation.lineSpacing,
    presentation.horizontalMargin,
    presentation.cuePosition,
    presentation.cueStyle,
    presentation.mirrorHorizontal,
    presentation.mirrorVertical,
    settings.compactMode,
    measureReaderPosition,
    reflowRevision,
    readerViewportHeight,
  ]);

  // A resize has already changed layout by the time ResizeObserver runs. Keep
  // a previously cached word measurement so resizing, compact mode, or a
  // transform toggle can still restore the same logical reading position.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    setReaderViewportHeight(container.clientHeight);
    const observer = new ResizeObserver(() => {
      if (container.clientWidth === stableViewportRef.current.width &&
        container.clientHeight === stableViewportRef.current.height) return;
      // Promote the old snapshot BEFORE scheduling any React layout change.
      // A deferred rAF here races scroll measurements from the resized DOM.
      if (scrollMeasurementFrameRef.current) {
        cancelAnimationFrame(scrollMeasurementFrameRef.current);
        scrollMeasurementFrameRef.current = 0;
      }
      pendingReflowPositionRef.current ??= stableReaderPositionRef.current;
      setReaderViewportHeight(container.clientHeight);
      setReflowRevision(revision => revision + 1);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [script?.id]);

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
        const pxPerSecond = (presentation.speed / 50) * (presentation.fontSize * 1.5);
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
  }, [isPlaying, readMode, presentation.speed, presentation.fontSize]);

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
        
        const cue = cueRef.current;
        if (!cue) {
          req = requestAnimationFrame(loop);
          return;
        }
        const delta = getLogicalLeadingEdge(
          span.getBoundingClientRect(),
          presentation.mirrorVertical,
        ) - getLogicalLeadingEdge(cue.getBoundingClientRect(), presentation.mirrorVertical);
        
        if (Math.abs(delta) > 5) {
          container.scrollTop += clientDeltaToLogicalScroll(
            delta * 0.05,
            presentation.mirrorVertical,
          );
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
    presentation.fontFamily,
    presentation.fontSize,
    presentation.cuePosition,
    presentation.mirrorVertical,
  ]);

  // Section tracking during scroll (only in manual mode or paused)
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      exactScrollTopRef.current = containerRef.current.scrollTop;
      queueStableReaderPosition();
      if (readMode === 'flow' && ['listening', 'loading'].includes(flow.status)) return;
      const cue = cueRef.current;
      if (!cue) return;
      const container = containerRef.current;
      const verticalMirror = presentation.mirrorVertical;
      const viewportRect = container.getBoundingClientRect();
      const guideCoordinate = getLogicalScrollCoordinate(
        container.scrollTop,
        viewportRect,
        getLogicalLeadingEdge(cue.getBoundingClientRect(), verticalMirror),
        verticalMirror,
      );

      let currentIdx = 0;
      for (let i = 0; i < sectionRefs.current.length; i++) {
        const el = sectionRefs.current[i];
        if (el && getLogicalScrollCoordinate(
          container.scrollTop,
          viewportRect,
          getLogicalLeadingEdge(el.getBoundingClientRect(), verticalMirror),
          verticalMirror,
        ) <= guideCoordinate) {
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
  }, [
    activeSectionIdx,
    readMode,
    flow.status,
    presentation.cuePosition,
    presentation.mirrorVertical,
    queueStableReaderPosition,
  ]);

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
      const cue = cueRef.current;
      if (!cue) return;
      const delta = getLogicalLeadingEdge(
        el.getBoundingClientRect(),
        presentation.mirrorVertical,
      ) - getLogicalLeadingEdge(cue.getBoundingClientRect(), presentation.mirrorVertical);
      const maxScrollTop = Math.max(
        0,
        containerRef.current.scrollHeight - containerRef.current.clientHeight,
      );
      const targetTop = Math.max(0, Math.min(
        maxScrollTop,
        containerRef.current.scrollTop + clientDeltaToLogicalScroll(
          delta,
          presentation.mirrorVertical,
        ),
      ));
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
  }, [script, readMode, enrichedSections, presentation.mirrorVertical]);

  const flowRef = useRef(flow);
  flowRef.current = flow;
  const readModeRef = useRef(readMode);
  readModeRef.current = readMode;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const activeSectionIdxRef = useRef(activeSectionIdx);
  activeSectionIdxRef.current = activeSectionIdx;
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;

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
       speed: presentationRef.current.speed,
       fontSize: presentationRef.current.fontSize
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
        if (updatePresentation({ speed: effect.speed })) {
          presentationRef.current = { ...presentationRef.current, speed: effect.speed };
        }
        break;
      case 'setFontSize':
        if (updatePresentation({ fontSize: effect.fontSize })) {
          presentationRef.current = { ...presentationRef.current, fontSize: effect.fontSize };
        }
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
  }, [script, jumpToSection, updatePresentation, enrichedSections]);

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
      fontSize: presentation.fontSize,
      scrollSpeed: presentation.speed,
      position: exactScrollTopRef.current
    };
    invoke('remote_publish_state', { snapshot }).catch(() => {});
  }, [script, isRunning, isApproved, activeSectionIdx, isPlaying, presentation.fontSize, presentation.speed]);

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
    presentation.backgroundOpacity,
    presentation.backgroundColor,
  );
  const viewportTransform = getReaderViewportTransform({
    horizontal: presentation.mirrorHorizontal,
    vertical: presentation.mirrorVertical,
  });

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
                     title="Present settings"
                     aria-label="Open present settings"
                  >
                    <Palette className="w-4 h-4" aria-hidden="true" />
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-[min(92vw,32rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:p-6">
                  <DialogHeader>
                     <DialogTitle>Present settings</DialogTitle>
                    <DialogDescription>
                       Adjust this script's reader layout and appearance.
                    </DialogDescription>
                  </DialogHeader>
                   {error && (
                     <p
                       role="alert"
                       className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                     >
                       {error}
                     </p>
                   )}
                   <PresentationControls
                     value={presentation}
                     onChange={updates => updatePresentation(updates as Partial<PresentationPreferences>)}
                     globalDarkTheme={settings.darkTheme}
                   />
                   <div className="flex justify-end border-t border-border pt-4">
                     <button
                       type="button"
                       onClick={resetCurrentPresentation}
                       className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                     >
                       Reset this script to defaults
                     </button>
                   </div>
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
               <span className="font-mono min-w-[3ch] text-center text-xs">{presentation.fontSize}</span>
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
                 value={presentation.speed}
                title="Scroll Speed"
                 onChange={e => dispatchCommand({ action: 'scrollSpeed', value: parseInt(e.target.value) - presentation.speed })}
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
                 value={presentation.backgroundOpacity}
                title="Background Opacity"
                 onChange={e => updatePresentation({ backgroundOpacity: parseInt(e.target.value) })}
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

      {error && (
        <div role="alert" className="relative z-50 shrink-0 border-b border-destructive/30 bg-background px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Reader Content Area */}
      <div className="flex-1 relative overflow-hidden">
        {/*
          Only this viewport and its cue are transformed. Header, dialogs, and
          transport controls are intentionally siblings so they stay usable in
          every H/V mirror combination.
        */}
        <div
          className="absolute inset-0"
          style={{
            transform: viewportTransform,
            transformOrigin: 'center',
          }}
        >
          {/* Read Marker / Flow guide. It shares the transformed coordinate
              space with copy, which makes cue, jumps, Flow, and tracking agree. */}
          <div
            ref={cueRef}
            className={`absolute left-0 right-0 h-0 z-30 pointer-events-none flex items-center ${
              presentation.cueStyle === 'hidden' ? 'invisible' : ''
            }`}
            style={{ top: `${presentation.cuePosition}%`, color: presentation.cueColor, opacity: presentation.cueOpacity / 100 }}
          >
            {presentation.cueStyle === 'arrows' ? (
              <div className="w-full flex items-center justify-between px-4 text-xl leading-none" aria-hidden="true">
                <span>›</span><span>‹</span>
              </div>
            ) : (
              <div className="w-full h-[2px]" style={{ backgroundColor: presentation.cueColor }} />
            )}
          </div>

          {/* Scrollable Container: scrollTop remains a normal logical document
              coordinate even while its painted viewport is mirrored. */}
          <div
            ref={containerRef}
            className="absolute inset-0 overflow-y-auto"
            style={{
              paddingLeft: `${presentation.horizontalMargin}%`,
              paddingRight: `${presentation.horizontalMargin}%`,
              fontSize: `${presentation.fontSize}px`,
              lineHeight: presentation.lineSpacing,
            }}
          >
            <div
              ref={textContentRef}
              className="max-w-4xl mx-auto space-y-[10vh] [overflow-wrap:anywhere]"
              style={{
                // Spacers belong to content, not the measured scroll viewport.
                // At small overlay heights viewport padding can exceed its
                // available height, creating a ResizeObserver feedback loop.
                paddingTop: `${getReaderTopPaddingPx(
                  readerViewportHeight,
                  presentation.cuePosition,
                )}px`,
                paddingBottom: `${readerViewportHeight}px`,
                fontFamily: getFontFamilyCss(presentation.fontFamily),
                color: getTextColorCss(presentation.textColor),
              }}
            >
            {enrichedSections.map((section, idx) => (
              <div
                key={section.id} 
                ref={el => { sectionRefs.current[idx] = el; }}
                // Never fade whole inactive sections: custom foreground colours
                // can become unreadable at 30% alpha over a camera/background.
                className="transition-opacity duration-500 opacity-100"
              >
                {enrichedSections.length > 1 && (
                  <h3
                    className="font-bold mb-6 flex items-center gap-4"
                     style={{ fontSize: `${presentation.fontSize * 0.75}px` }}
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
                           // This is an explicit contrast pair, independent of
                           // a user's reader background or foreground colour.
                           className += "bg-primary text-primary-foreground rounded px-1 py-0.5 shadow-sm";
                        } else if (isRead) {
                           // Retain the chosen reader text colour. Underline and
                           // a modest alpha change communicate progress without
                           // swapping to a theme colour that may not contrast.
                           className += "opacity-80 underline decoration-current/40 underline-offset-4";
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
