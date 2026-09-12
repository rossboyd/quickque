import { getScriptPurpose } from '@/lib/script-purpose';
import { getCharacterColor } from '@/lib/actor-colors';
import { SceneCues } from '@/components/scene-cues';
import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import './reader-scene.css';
import { useStore } from '@/lib/store';
import type { PresentationPreferences, Settings } from '@/lib/types';
import { useLocation, useParams } from 'wouter';
import { 
  Play, Pause, X, Minus, Plus, Settings2, Maximize2, Minimize2, ChevronLeft, ChevronRight, Droplets, Loader2, Smartphone, Palette
} from 'lucide-react';
import { isDesktop, setOverlayMode, setAlwaysOnTop, startDragging } from '@/lib/desktop';
import { useLocalFlow } from '@/hooks/use-local-flow';
import { useScenePartner } from '@/hooks/use-scene-partner';
import { ReaderTokenizationCache } from '@/lib/reader-tokenization';
import { tokenize } from '@/lib/flow/tokenize';
import type { SceneVoice } from '@/lib/scene-lifecycle';
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
import { usePresentationPlayback } from '@/hooks/use-presentation-playback';
import { calculateTimedSpeed, getPlaybackTimingSnapshot } from '@/lib/presentation-playback';
import {
  readResumePosition, saveResumePosition, clearResumePosition,
  getReaderContentFingerprint, type ReaderResumePosition,
} from '@/lib/reader-resume-position';
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

  const [readMode, setReadMode] = useState<"manual" | "flow">("flow");
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [showSceneNotes, setShowSceneNotes] = useState(true);
  const [timingMessage, setTimingMessage] = useState<string | null>(null);
  const [resumeChoice, setResumeChoice] = useState<ReaderResumePosition | null>(null);
  const resumePendingRef = useRef(true);
  const saveCurrentPositionRef = useRef<() => void>(() => {});

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
  const measureReaderPositionRef = useRef(measureReaderPosition);
  measureReaderPositionRef.current = measureReaderPosition;

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
    if (updates.speed !== undefined && presentation.targetDurationSeconds !== null) {
      updates = { ...updates, targetDurationSeconds: null };
      setTimingMessage('Timed scrolling turned off because the speed was changed.');
    }
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
    } else {
      presentationRef.current = { ...presentationRef.current, ...updates };
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

  // Keep the scene feature additive: old documents still use the exact reader
  // tokenisation and Flow lifecycle.
  const actor = script?.actor;
  const isPerformance = script ? getScriptPurpose(script) === 'performance' : false;
  const sceneEnabled = isPerformance && actor?.enabled === true;
  const characters = actor?.characters ?? [];
  const characterIds = useMemo(() => new Set(characters.map(character => character.id)), [characters]);
  const sceneTurns = useMemo(() => (script?.sections ?? []).map(section => ({
    id: section.id,
    content: section.content,
    characterId: (() => {
      const characterId = section.characterId ?? null;
      return characterId && characterIds.has(characterId) ? characterId : null;
    })(),
  })), [script?.sections, characterIds]);
  const sceneMyRoleIds = actor?.myRoleIds ?? [];
  const voiceForCharacter = useCallback((characterId: string): SceneVoice | null => {
    const saved = characters.find(character => character.id === characterId)?.voice;
    return saved?.voiceId ? saved : null;
  }, [characters]);
  const sceneVoiceSignature = useMemo(
    () => JSON.stringify(characters.map(character => [
      character.id,
      character.voice.engine,
      character.voice.voiceId,
      character.voice.rate,
    ])),
    [characters],
  );
  const stopFlowBeforePartnerRef = useRef<() => Promise<void>>(async () => {});
  const [sceneFlowEnabled, setSceneFlowEnabled] = useState(false);
  const [sceneSilentManual, setSceneSilentManual] = useState(false);
  const effectiveSceneMyRoleIds = sceneSilentManual
    ? characters.map(character => character.id)
    : sceneMyRoleIds;
  const scene = useScenePartner({
    enabled: sceneEnabled,
    turns: sceneTurns,
    myRoleIds: effectiveSceneMyRoleIds,
    voiceForCharacter,
    voiceSignature: sceneVoiceSignature,
    beforePartnerSpeak: () => stopFlowBeforePartnerRef.current(),
  });
  const sceneFlowTokens = useMemo(
    () => tokenize(scene.currentTurn?.content ?? ''),
    [scene.currentTurn?.id, scene.currentTurn?.content],
  );
  const flow = useLocalFlow({
    tokens: sceneEnabled ? sceneFlowTokens : tokens,
    enabled: sceneEnabled
      ? sceneFlowEnabled && scene.phase === 'waiting'
      : readMode === "flow",
    sceneCompletion: sceneEnabled,
  });
  stopFlowBeforePartnerRef.current = async () => {
    // `flow_command` reaps the helper before its promise resolves. Awaiting
    // this bridge acknowledgement is required before system speech handoff.
    await flow.stopAndWait();
  };
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const readModeRef = useRef(readMode);
  readModeRef.current = readMode;
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;

  useEffect(() => {
    if (readMode === 'flow' && !sceneEnabled) {
      const isSetupDone = localStorage.getItem('quickque-flow-setup-done') === 'true';
      if (!isSetupDone) {
        setShowWizard(true);
      }
    } else {
      setShowWizard(false);
    }
  }, [readMode, sceneEnabled]);

  const readingDistance = useCallback(() => {
    const container = containerRef.current;
    const cue = cueRef.current;
    // A block's trailing edge includes every wrapped inline fragment and
    // title-only sections. Flow token count is unrelated to manual distance.
    const tail = [...sectionRefs.current].reverse()
      .map(section => section?.getBoundingClientRect())
      .find(rect => rect && rect.height > 0);
    if (!container || !cue || !tail) return { remaining: 0, total: 0 };
    const mirror = presentationRef.current.mirrorVertical;
    const delta = clientDeltaToLogicalScroll(
      (mirror ? tail.top : tail.bottom) -
      getLogicalLeadingEdge(cue.getBoundingClientRect(), mirror), mirror);
    const total = Math.max(0, Math.min(container.scrollHeight - container.clientHeight,
      container.scrollTop + delta));
    return { remaining: Math.max(0, total - container.scrollTop), total };
  }, []);

  const { controller: playback, state: playbackState } = usePresentationPlayback(() => {
    if (sceneRef.current.enabled) {
      void sceneRef.current.start();
    } else if (readModeRef.current === 'manual') playback.activate();
    else flowRef.current.start();
  });
  const isPlaying = !sceneEnabled && readMode === 'manual' && playbackState.phase === 'playing';
  const timerState = playbackState.timerState;
  const pausePlayback = useCallback(() => {
    const wasRequested = ['starting', 'playing'].includes(playback.state.phase);
    playback.pause();
    if (sceneRef.current.enabled) {
      void sceneRef.current.pause();
      flowRef.current.pause();
    } else if (readModeRef.current === 'flow' && (wasRequested || flowRef.current.status === 'listening')) {
      flowRef.current.pause();
    }
  }, [playback]);
  const reanchorAtPosition = useCallback(() => {
    const anchorId = measureReaderPosition()?.anchorId;
    if (!anchorId) return;
    for (const section of enrichedSections) {
      const index = section.spans.findIndex((_, i) => `${section.id}:${i}` === anchorId);
      if (index < 0) continue;
      const token = section.spans.slice(index).find(span => span.startTokenIdx !== undefined);
      playback.suspendForPreparation();
      flowRef.current.reanchor(token?.startTokenIdx ?? section.firstTokenIdx ?? 0);
      break;
    }
  }, [enrichedSections, measureReaderPosition, playback]);
  const manualGestureRef = useRef(false);
  const completedGestureTopRef = useRef<number | null>(null);
  const interruptForGesture = useCallback(() => {
    completedGestureTopRef.current = playback.state.phase === 'completed'
      ? containerRef.current?.scrollTop ?? null : null;
    if (!presentationRef.current.pauseOnManualScroll) return;
    manualGestureRef.current = true;
    pausePlayback();
  }, [pausePlayback, playback]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const wheel = (event: WheelEvent) => {
      if (event.deltaY !== 0 || event.deltaX !== 0) interruptForGesture();
    };
    const touch = () => interruptForGesture();
    const pointer = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (event.clientX >= rect.right - 18 || event.clientX <= rect.left + 18) interruptForGesture();
    };
    const key = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.code)) interruptForGesture();
    };
    const scrolled = () => {
      // A gesture at the boundary may not move anything. Only actual backward
      // movement can turn a completed presentation into a resumable one.
      const rewoundFromCompletion = completedGestureTopRef.current !== null &&
        container.scrollTop < completedGestureTopRef.current - 1;
      if (!sceneRef.current.enabled && (readModeRef.current === 'manual' || rewoundFromCompletion) &&
          playback.state.phase === 'completed' && readingDistance().remaining > 1) {
        playback.seek();
        completedGestureTopRef.current = null;
      }
      if (!manualGestureRef.current) return;
      if (!sceneRef.current.enabled && readModeRef.current === 'flow') reanchorAtPosition();
    };
    container.addEventListener('wheel', wheel, { passive: true });
    container.addEventListener('touchmove', touch, { passive: true });
    container.addEventListener('pointerdown', pointer);
    container.addEventListener('keydown', key);
    container.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      container.removeEventListener('wheel', wheel);
      container.removeEventListener('touchmove', touch);
      container.removeEventListener('pointerdown', pointer);
      container.removeEventListener('keydown', key);
      container.removeEventListener('scroll', scrolled);
    };
  }, [interruptForGesture, reanchorAtPosition, playback, readingDistance]);
  const completePlayback = useCallback(() => {
    playback.complete();
    if (!sceneRef.current.enabled && readModeRef.current === 'flow') flowRef.current.pause();
    setTimingMessage('End of script. Choose Start over to begin a new presentation.');
  }, [playback]);

  useEffect(() => {
    if (sceneEnabled || readMode !== 'flow') return;
    if (flow.status !== 'listening' && playback.state.phase === 'playing') playback.suspendForPreparation();
    if (flow.status === 'listening' && playback.state.phase === 'starting') playback.activate();
    if (['error', 'silence-stopped', 'paused', 'stopped', 'unsupported', 'needs-model', 'ready', 'downloading'].includes(flow.status) &&
        ['starting', 'playing'].includes(playback.state.phase)) playback.pause();
    if (flow.status === 'listening' && tokens.length > 0 && flow.anchor >= tokens.length) completePlayback();
  }, [sceneEnabled, flow.status, flow.anchor, readMode, tokens.length, playback, completePlayback]);

  // Scene turns reuse the presentation lifecycle/clock. A partner preparing
  // line freezes active time, and the clock starts again only when playback or
  // a visible actor turn is actually ready. Flow is intentionally scoped to
  // the current actor turn; a stale transcript can never complete another one.
  const sceneFlowCompletionRef = useRef<number | null>(null);
  const sceneFlowStartedGenerationRef = useRef<number | null>(null);
  if (sceneFlowStartedGenerationRef.current !== null &&
    sceneFlowStartedGenerationRef.current !== scene.generation) {
    // This synchronous generation fence closes the render/effect gap where a
    // prior turn's `listening` state is still visible while a new actor turn
    // commits. Only an explicit Flow start for this exact turn may advance it.
    sceneFlowStartedGenerationRef.current = null;
  }
  useEffect(() => {
    if (!sceneEnabled) return;
    if (scene.phase === 'preparing' && playback.state.phase === 'playing') {
      playback.suspendForPreparation();
    } else if (['speaking', 'waiting'].includes(scene.phase) &&
      playback.state.phase === 'starting') {
      playback.activate();
    } else if (scene.phase === 'blocked' &&
      ['starting', 'playing'].includes(playback.state.phase)) {
      playback.pause();
    } else if (scene.phase === 'completed') {
      completePlayback();
    }

    if (scene.phase !== 'waiting' || !sceneFlowEnabled) {
      sceneFlowCompletionRef.current = null;
      return;
    }
    if (playback.state.phase === 'playing' && flow.status === 'ready' &&
      sceneFlowStartedGenerationRef.current !== scene.generation) {
      sceneFlowStartedGenerationRef.current = scene.generation;
      flow.start();
    }
    if (flow.status === 'listening' && sceneFlowTokens.length > 0 &&
      flow.sceneCompletion.completed &&
      sceneFlowStartedGenerationRef.current === scene.generation &&
      sceneFlowCompletionRef.current !== scene.generation) {
      sceneFlowCompletionRef.current = scene.generation;
      void scene.next();
    }
    // A `silence-stopped` status is deliberately not restarted or advanced.
    // Resuming must remain an explicit user action.
  }, [
    sceneEnabled, scene.phase, scene.generation, sceneFlowEnabled,
    sceneFlowTokens.length, flow.status, flow.anchor, flow.sceneCompletion, playback,
    completePlayback,
  ]);

  useEffect(() => {
    if (!sceneEnabled || scene.turnIndex >= enrichedSections.length) return;
    setActiveSectionIdx(scene.turnIndex);
    const section = sectionRefs.current[scene.turnIndex];
    const container = containerRef.current;
    const cue = cueRef.current;
    if (!section || !container || !cue) return;
    const delta = getLogicalLeadingEdge(
      section.getBoundingClientRect(),
      presentation.mirrorVertical,
    ) - getLogicalLeadingEdge(cue.getBoundingClientRect(), presentation.mirrorVertical);
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const targetTop = Math.max(0, Math.min(
      maxScrollTop,
      container.scrollTop + clientDeltaToLogicalScroll(delta, presentation.mirrorVertical),
    ));
    exactScrollTopRef.current = targetTop;
    container.scrollTo({ top: targetTop, behavior: 'auto' });
  }, [sceneEnabled, scene.turnIndex, enrichedSections.length, presentation.mirrorVertical]);

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
    saveCurrentPositionRef.current();
    playback.pause();
    await sceneRef.current.pause();
    await flowRef.current.stopAndWait();
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
  }, [setLocation, playback]);

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
    if (sceneEnabled || readMode !== "manual" || !isPlaying) {
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
        if (playback.state.phase !== 'playing') return;
        const distance = readingDistance();
        if (distance.remaining <= 1) {
          completePlayback();
          return;
        }
        let pxPerSecond = (presentation.speed / 50) * (presentation.fontSize * 1.5);
        if (presentation.targetDurationSeconds !== null) {
          const remainingMs = presentation.targetDurationSeconds * 1000 -
            getElapsedMs(playback.state.timerState, performance.now());
          const timed = calculateTimedSpeed(distance.remaining, remainingMs);
          if (timed.error) {
            pausePlayback();
            setTimingMessage(timed.error);
            return;
          }
          pxPerSecond = timed.speed;
        }
        const pxPerFrame = (pxPerSecond * deltaTime) / 1000;
        
        const maxScroll = distance.total;
        if (containerRef.current.scrollTop < maxScroll) {
          exactScrollTopRef.current = Math.min(maxScroll, exactScrollTopRef.current + pxPerFrame);
          containerRef.current.scrollTop = exactScrollTopRef.current;
        } else {
          completePlayback();
          return;
        }
      }
      reqRef.current = requestAnimationFrame(scrollLoop);
    };

    reqRef.current = requestAnimationFrame(scrollLoop);
    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
      lastTimeRef.current = 0;
    };
  }, [sceneEnabled, isPlaying, readMode, presentation.speed, presentation.fontSize, presentation.targetDurationSeconds,
    playback, readingDistance, completePlayback, pausePlayback]);

  // Flow Smooth scroll following active token ONLY on confident matching
  useEffect(() => {
    if (sceneEnabled || readMode !== "flow" || flow.status !== 'listening' || !flow.isFollowing) {
      return;
    }

    let req: number;
    const loop = () => {
      if (playback.state.phase !== 'playing') return;
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
    sceneEnabled,
    readMode,
    flow.status,
    flow.isFollowing,
    flow.anchor,
    presentation.fontFamily,
    presentation.fontSize,
    presentation.cuePosition,
    presentation.mirrorVertical,
    playback,
    playbackState.phase,
  ]);

  // Section tracking during scroll (only in manual mode or paused)
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;
      exactScrollTopRef.current = containerRef.current.scrollTop;
      queueStableReaderPosition();
      if (sceneEnabled || (readMode === 'flow' && ['listening', 'loading'].includes(flow.status))) return;
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
    sceneEnabled,
    readMode,
    flow.status,
    presentation.cuePosition,
    presentation.mirrorVertical,
    queueStableReaderPosition,
  ]);

  // Auto-advance section tracking in Flow mode
  useEffect(() => {
    if (sceneEnabled || readMode !== "flow") return;
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
  }, [sceneEnabled, flow.anchor, readMode, enrichedSections, activeSectionIdx]);

  const reanchorRef = useRef(flow.reanchor);
  reanchorRef.current = flow.reanchor;

  const jumpToSection = useCallback((idx: number) => {
    if (!script) return;
    if (idx < 0 || idx >= script.sections.length) return;
    if (sceneEnabled) {
      setActiveSectionIdx(idx);
      void sceneRef.current.goTo(idx);
      return;
    }
    
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
          playback.suspendForPreparation();
          reanchorRef.current(firstToken);
        }
      }
    }
  }, [script, sceneEnabled, readMode, enrichedSections, presentation.mirrorVertical, playback]);

  const activeSectionIdxRef = useRef(activeSectionIdx);
  activeSectionIdxRef.current = activeSectionIdx;

  const dispatchCommand = useCallback((cmd: any) => {
    if (!script || resumePendingRef.current) return;
    const requestedAction = cmd.action || cmd.detail || ({
      NextSection: 'next',
      PreviousSection: 'previous',
    } as Record<string, string>)[cmd.type || ''];
    // The legacy reducer intentionally clamps Next at the final section. In a
    // scene that final section can be the actor's last line, where advancing
    // once more is how the lifecycle reaches its completed state.
    if (sceneRef.current.enabled && requestedAction === 'next' &&
      activeSectionIdxRef.current >= script.sections.length - 1) {
      void sceneRef.current.next();
      return;
    }

    const effect = resolveCommandEffect(cmd, {
      readMode: readModeRef.current,
      sceneEnabled: sceneRef.current.enabled,
      isPlaying: ['countdown', 'starting', 'playing'].includes(playback.state.phase),
      playbackPhase: playback.state.phase,
      flowStatus: flowRef.current.status,
      activeSectionIdx: activeSectionIdxRef.current,
      sectionCount: script.sections.length,
       speed: presentationRef.current.speed,
       fontSize: presentationRef.current.fontSize
    });

    if (!effect) return;

    switch (effect.type) {
      case 'setPlaying':
      case 'flowStart':
        if (effect.type === 'setPlaying' && !effect.playing) {
          pausePlayback();
        } else {
          if (playback.state.phase === 'completed') {
            setTimingMessage('End of script. Choose Start over, or move to an earlier section.');
            break;
          }
          if (!sceneRef.current.enabled && readModeRef.current === 'manual') {
            const distance = readingDistance();
            if (distance.remaining <= 1) { completePlayback(); break; }
            if (presentationRef.current.targetDurationSeconds !== null) {
              const timed = calculateTimedSpeed(distance.remaining,
                presentationRef.current.targetDurationSeconds * 1000 - getElapsedMs(playback.state.timerState, performance.now()));
              if (timed.error) { setTimingMessage(timed.error); break; }
            }
          }
          setTimingMessage(null);
          manualGestureRef.current = false;
           if (!sceneRef.current.enabled && readModeRef.current === 'flow') reanchorAtPosition();
          playback.requestStart(presentationRef.current.countdownSeconds);
        }
        break;
      case 'flowPause':
        pausePlayback();
        break;
      case 'jumpToSection':
        activeSectionIdxRef.current = effect.index;
        jumpToSection(effect.index);
        playback.seek();
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
          playback.seek();
        }
        break;
      case 'setReadMode':
        // Scene turn-taking owns motion. Keep the existing remote protocol but
        // do not let an old mode command restart all-script Flow mid-scene.
        if (sceneRef.current.enabled) break;
        if (effect.mode === readModeRef.current) break;
        pausePlayback();
        readModeRef.current = effect.mode;
        setReadMode(effect.mode);
        if (effect.mode === 'flow') {
          const targetAnchor = enrichedSections[activeSectionIdxRef.current]?.firstTokenIdx ?? 0;
          flowRef.current.reanchor(targetAnchor);
        } else {
          flowRef.current.stop();
        }
        break;
    }
  }, [script, jumpToSection, updatePresentation, enrichedSections, playback, pausePlayback, completePlayback, readingDistance, reanchorAtPosition]);

  useReaderCommands(dispatchCommand);

  // State publishing
  const { isRunning, isApproved } = useRemoteStore();

  const publishSnapshot = useCallback(() => {
    if (!script || !isRunning || !isApproved) return;
    const snapshot: RemoteSnapshot = {
      mode: readModeRef.current,
      section: activeSectionIdx,
      sectionCount: script.sections.length,
      ...getPlaybackTimingSnapshot(playback.state, performance.now()),
      fontSize: presentation.fontSize,
      scrollSpeed: presentation.speed,
      position: exactScrollTopRef.current
    };
    invoke('remote_publish_state', { snapshot }).catch(() => {});
  }, [script, isRunning, isApproved, activeSectionIdx, isPlaying, presentation.fontSize, presentation.speed, playback, playbackState.phase]);

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
      if (e.target instanceof Element) {
        if (e.target.closest('[role="slider"]')) return;
        // Space/Enter belong to the focused button, but horizontal arrows
        // remain turn navigation after a toolbar click.
        if (e.target.closest('button, a, [role="button"]') &&
          e.code !== 'ArrowRight' && e.code !== 'ArrowLeft') return;
      }
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
    const isActivelyPlaying = sceneEnabled
      ? ['preparing', 'speaking', 'waiting'].includes(scene.phase)
      : readMode === 'manual' ? isPlaying : flow.status === 'listening';
    const resetHide = () => {
      setShowControls(true);
      clearTimeout(timeout);
      if (isActivelyPlaying && presentation.hideControlsWhilePlaying) {
        timeout = window.setTimeout(() => setShowControls(false), 3000);
      }
    };
    
    window.addEventListener('mousemove', resetHide);
    window.addEventListener('focusin', resetHide);
    if (isActivelyPlaying) {
      resetHide();
    } else {
      setShowControls(true);
    }
    
    return () => {
      window.removeEventListener('mousemove', resetHide);
      window.removeEventListener('focusin', resetHide);
      clearTimeout(timeout);
    };
  }, [sceneEnabled, scene.phase, isPlaying, readMode, flow.status, presentation.hideControlsWhilePlaying]);

  const startOver = useCallback(async () => {
    const restartingScene = sceneRef.current.enabled;
    if (restartingScene) {
      playback.pause();
      await sceneRef.current.reset();
      await flowRef.current.stopAndWait().catch(() => {});
    } else {
      pausePlayback();
    }
    playback.reset();
    manualGestureRef.current = false;
    if (containerRef.current) containerRef.current.scrollTop = 0;
    exactScrollTopRef.current = 0;
    stableReaderPositionRef.current = null;
    pendingReflowPositionRef.current = null;
    setActiveSectionIdx(0);
    if (!restartingScene) flowRef.current.reanchor(0);
    setTimingMessage(null);
    setResumeChoice(null);
    resumePendingRef.current = false;
    if (script) {
      const cleared = clearResumePosition(script.id);
      if (!cleared.ok) setTimingMessage(cleared.error);
    }
    // Start over is itself an explicit start action. It uses the established
    // countdown controller rather than allowing SceneLifecycle to bypass it.
    if (restartingScene) {
      playback.requestStart(presentationRef.current.countdownSeconds);
    }
  }, [pausePlayback, playback, script]);

  // This metadata lives outside the script/export envelope. Content changes
  // invalidate it; appearance changes deliberately do not.
  const contentFingerprint = script ? getReaderContentFingerprint(script) : '';
  useEffect(() => {
    playback.reset();
    if (containerRef.current) containerRef.current.scrollTop = 0;
    exactScrollTopRef.current = 0;
    stableReaderPositionRef.current = null;
    pendingReflowPositionRef.current = null;
    if (!script) { resumePendingRef.current = true; return; }
    const saved = readResumePosition(script);
    if (!saved.ok) {
      setTimingMessage(saved.error);
      resumePendingRef.current = false;
      return;
    }
    const position = saved.position;
    setResumeChoice(position);
    resumePendingRef.current = position !== null;
    // Immutable script snapshot is intentional: old pagehide/cleanup must
    // never save the previous location under a newly navigated script ID.
    const checkpoint = () => {
      if (resumePendingRef.current) return;
      if (exactScrollTopRef.current <= 1 && playback.state.phase !== 'completed') {
        const cleared = clearResumePosition(script.id);
        if (!cleared.ok) setTimingMessage(cleared.error);
        return;
      }
      const anchor = measureReaderPositionRef.current()?.anchorId;
      if (!anchor) return;
      const atEnd = sceneRef.current.enabled
        ? sceneRef.current.turnIndex >= script.sections.length
        : readModeRef.current === 'flow'
        ? flowRef.current.anchor >= tokens.length
        : readingDistance().remaining <= 1;
      const result = saveResumePosition(script, anchor, playback.state.phase === 'completed' && atEnd);
      if (!result.ok) setTimingMessage(result.error);
    };
    saveCurrentPositionRef.current = checkpoint;
    const interval = window.setInterval(checkpoint, 1000);
    const leavingPage = () => { checkpoint(); pausePlayback(); };
    window.addEventListener('pagehide', leavingPage);
    return () => {
      checkpoint();
      saveCurrentPositionRef.current = () => {};
      window.clearInterval(interval);
      window.removeEventListener('pagehide', leavingPage);
    };
    // Presentation commits clone script objects but must not reopen a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id, contentFingerprint, playback]);

  const resumeReading = useCallback(() => {
    if (!resumeChoice?.anchorId) { startOver(); return; }
    const anchorId = resumeChoice.anchorId;
    playback.resumePaused();
    if (sceneEnabled && script) {
      const turnIndex = script.sections.findIndex(section =>
        anchorId.startsWith(`${section.id}:`),
      );
      if (turnIndex >= 0) void scene.goTo(turnIndex);
    }
    pendingReflowPositionRef.current = {
      anchorId: resumeChoice.anchorId, anchorOffset: 0, fallbackScrollTop: 0,
      verticalMirror: presentation.mirrorVertical,
    };
    resumePendingRef.current = false;
    setResumeChoice(null);
    setReflowRevision(revision => revision + 1);
    setTimingMessage('Position restored. Press Play when ready; session time starts from zero.');
  }, [resumeChoice, startOver, playback, presentation.mirrorVertical, sceneEnabled, scene, script]);

  const getTimingMetrics = useCallback(() => {
    const elapsed = getElapsedMs(playback.state.timerState, performance.now());
    const target = presentationRef.current.targetDurationSeconds;
    if (sceneRef.current.enabled) {
      const count = enrichedSections.length;
      return {
        remainingMs: null,
        progress: count ? Math.min(1, sceneRef.current.turnIndex / count) : 0,
        timed: false,
      };
    }
    if (readModeRef.current === 'flow') {
      return { remainingMs: null, progress: tokens.length ? flowRef.current.anchor / tokens.length : 0, timed: false };
    }
    const distance = readingDistance();
    if (target !== null) return {
      remainingMs: Math.max(0, target * 1000 - elapsed),
      progress: playback.state.phase === 'completed' ? 1 : Math.min(1, elapsed / (target * 1000)),
      timed: true,
    };
    const speed = (presentationRef.current.speed / 50) * (presentationRef.current.fontSize * 1.5);
    return { remainingMs: distance.remaining / speed * 1000,
      progress: distance.total > 0 ? 1 - distance.remaining / distance.total : 0, timed: false };
  }, [playback, readingDistance, tokens.length, enrichedSections.length]);

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
      className={`flex flex-col transition-all duration-300 ${readerSurface.className} ${sceneEnabled ? 'scene-reader' : ''}`}
      style={readerSurface.style}
    >
      {/* Title Bar (Draggable in compact mode) */}
      <div 
        className={`flex flex-col z-50 transition-opacity duration-300 ${showControls || (sceneEnabled ? !['preparing', 'speaking', 'waiting'].includes(scene.phase) : readMode === 'manual' ? !isPlaying : flow.status !== 'listening') ? 'opacity-100' : 'opacity-0'}`}
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
        <div className="scene-titlebar flex items-center justify-between p-3">
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
                     title={isPerformance ? 'Rehearsal settings' : 'Present settings'}
                     aria-label={isPerformance ? 'Open rehearsal settings' : 'Open present settings'}
                  >
                    <Palette className="w-4 h-4" aria-hidden="true" />
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-[min(92vw,32rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:p-6">
                  <DialogHeader>
                     <DialogTitle>{isPerformance ? 'Rehearsal settings' : 'Present settings'}</DialogTitle>
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
                   {sceneEnabled && (
                     <fieldset className="space-y-3 rounded-lg border border-border p-3 text-sm">
                       <legend className="px-1 font-semibold">Scene options</legend>
                       <label className="flex items-center gap-2">
                         <input type="checkbox" checked={sceneFlowEnabled}
                           onChange={event => setSceneFlowEnabled(event.target.checked)} />
                         Follow my turn with local Mac Flow
                       </label>
                       {!isDesktop() && <label className="flex items-center gap-2">
                         <input type="checkbox" checked={sceneSilentManual}
                           onChange={event => setSceneSilentManual(event.target.checked)} />
                         Silent cues — no audio in browser preview
                       </label>}
                       <p className="text-xs text-muted-foreground">Voices are selected in the cast editor. Scene mode never uses timed scrolling.</p>
                     </fieldset>
                   )}
                   <PresentationControls
                     value={presentation}
                      readMode={sceneEnabled ? 'flow' : readMode}
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

          <div className={`scene-options-bar flex items-center gap-2 bg-background/50 backdrop-blur-md px-3 py-1.5 border border-border/50 text-sm max-w-full ${sceneEnabled ? 'flex-wrap rounded-xl' : 'rounded-full overflow-hidden'}`}>
            <div className={`flex items-center gap-1.5 ${sceneEnabled ? 'basis-full min-w-0' : 'flex-1 min-w-[80px]'}`}>
               {sceneEnabled ? (
                 <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                   <span className="font-semibold whitespace-nowrap">
                     {sceneSilentManual
                       ? 'Scene: silent manual cues'
                       : sceneMyRoleIds.length === 0
                       ? 'Scene: full read-through'
                       : characters.length > 0 && characters.every(character => sceneMyRoleIds.includes(character.id))
                         ? 'Scene: silent cue reader'
                         : 'Scene partner'}
                   </span>
                   <label className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
                     <input
                       type="checkbox"
                       checked={sceneFlowEnabled}
                       onChange={event => setSceneFlowEnabled(event.target.checked)}
                     />
                     Follow my turn
                   </label>
                   {!isDesktop() && (
                     <label className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
                       <input
                         type="checkbox"
                         checked={sceneSilentManual}
                         onChange={event => setSceneSilentManual(event.target.checked)}
                       />
                       Silent cues
                     </label>
                   )}
                 </div>
               ) : (
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
               )}
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
                 disabled={sceneEnabled || readMode === 'flow'}
                 style={{ opacity: sceneEnabled || readMode === 'flow' ? 0.5 : 1 }}
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

      <div className="contents scene-hud">
      <PresentationHUD
        mode={sceneEnabled ? 'manual' : readMode}
        status={flow.status}
        isFollowing={flow.isFollowing}
        audioLevelRef={flow.audioLevelRef}
        timerState={timerState}
        onResetTimer={startOver}
        showTiming={presentation.showTiming}
        getTimingMetrics={getTimingMetrics}
      />
      </div>
      <Dialog open={resumeChoice !== null} onOpenChange={open => { if (!open) void exitReader(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{resumeChoice?.completed ? 'Script completed' : 'Continue this script?'}</DialogTitle>
            <DialogDescription>
              {resumeChoice?.completed
                ? 'You reached the end last time. Start over for a new presentation.'
                : 'Resume your saved reading position, or start from the beginning. Both open paused with a fresh session clock. No microphone capture starts automatically.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <button className="rounded-md border px-4 py-2" onClick={startOver}>Start over</button>
            {resumeChoice?.anchorId && <button className="rounded-md bg-primary text-primary-foreground px-4 py-2" onClick={resumeReading}>Resume</button>}
          </div>
        </DialogContent>
      </Dialog>
      {playbackState.phase === 'countdown' && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-background/90" role="status" aria-live="polite">
          <p className="text-lg">Starting in</p>
          <strong className="text-7xl tabular-nums">{playbackState.countdownSeconds}</strong>
          <button className="rounded-full border px-6 py-3" onClick={pausePlayback}>Cancel countdown</button>
        </div>
      )}
      {timingMessage && (
        <div role="status" className="relative z-50 flex items-center justify-between gap-3 bg-background border-b px-4 py-2 text-sm">
          <span>{timingMessage}</span>
          <button onClick={() => setTimingMessage(null)} className="underline">Dismiss</button>
        </div>
      )}
      {!showControls && (
        <button className="absolute left-3 bottom-3 z-[60] rounded-full bg-background/90 border px-4 py-2 text-sm"
          onClick={() => setShowControls(true)}>Show controls</button>
      )}

      {error && (
        <div role="alert" className="relative z-50 shrink-0 border-b border-destructive/30 bg-background px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {isPerformance && <SceneCues script={script}
        turnIndex={sceneEnabled ? scene.turnIndex : activeSectionIdx}
        phase={sceneEnabled ? scene.phase : 'paused'}
        silent={!sceneEnabled || sceneSilentManual}
        transform={viewportTransform} />}

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
            tabIndex={0}
            aria-label="Script reading area"
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
                className={`transition-opacity duration-500 opacity-100 ${isPerformance ? 'border-l-4 pl-4' : ''}`}
                style={isPerformance ? { borderLeftColor: getCharacterColor(characters.find(character => character.id === script.sections[idx]?.characterId)) } : undefined}
              >
                {isPerformance && <p className="mb-2 text-sm font-semibold text-foreground">
                  {characters.find(character => character.id === script.sections[idx]?.characterId)?.name ?? 'Unassigned'}
                  {' · '}{script.sections[idx]?.characterId && characterIds.has(script.sections[idx].characterId!)
                    ? sceneMyRoleIds.includes(script.sections[idx].characterId!) ? 'In Person' : 'AI Partner'
                    : 'Assign a character'}
                </p>}
                {enrichedSections.length > 1 && (
                  <h3
                    className="font-bold mb-6 flex items-center gap-4"
                      data-scene-section-heading
                      style={{ fontSize: `${presentation.fontSize * 0.75}px` }}
                  >
                    <span className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-mono tracking-tighter">
                      {idx + 1}
                    </span>
                    {section.title}
                  </h3>
                )}
                {sceneEnabled && idx === scene.turnIndex && (() => {
                  // Tokenisation deliberately ignores scene metadata so Flow's
                  // token array remains stable on notes/assignment edits. Read
                  // visible metadata from the live section instead.
                  const raw = script.sections[idx] ?? section;
                  const character = characters.find(item => item.id === raw.characterId);
                  const mine = !!character && effectiveSceneMyRoleIds.includes(character.id);
                  const ownership = !character
                    ? 'Unassigned turn'
                    : sceneMyRoleIds.includes(character.id) ? 'In Person · Your turn' : sceneSilentManual ? 'AI Partner · Silent cues' : scene.phase === 'speaking' ? 'AI Partner · Speaking' : 'AI Partner · Ready';
                  return (
                    <aside
                      className="mb-4 rounded-lg border border-border border-l-4 bg-background text-foreground px-4 py-3 shadow-sm"
                      style={{ borderLeftColor: getCharacterColor(character) }}
                      aria-live="polite"
                      aria-label="Current scene turn"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold text-base leading-snug">
                          {character?.name ?? 'Unassigned'} <span className="font-normal text-muted-foreground">— {ownership}</span>
                        </p>
                        <button
                          type="button"
                          className="text-xs underline"
                          onClick={() => setShowSceneNotes(value => !value)}
                        >
                          {showSceneNotes ? 'Hide notes' : 'Show notes'}
                        </button>
                      </div>
                      {character && [character.age, character.gender, character.style]
                        .filter(value => value.trim()).length > 0 && (
                        <p className="mt-1 text-xs font-normal text-muted-foreground">
                          {[character.age, character.gender, character.style]
                            .filter(value => value.trim())
                            .join(' · ')}
                        </p>
                      )}
                      {showSceneNotes && raw.notes?.trim() && (
                        <p className="scene-notes mt-2 whitespace-pre-wrap text-sm font-normal opacity-90">
                          <span className="font-semibold">Notes: </span>{raw.notes}
                        </p>
                      )}
                      {mine && sceneFlowEnabled && (
                        <p className="mt-2 text-xs font-normal text-muted-foreground">
                          {!flow.sceneCompletion.eligible
                            ? 'Short or repetitive line—press Next when you finish.'
                            : flow.sceneCompletion.uncertain
                              ? <>
                                  Couldn’t match this line. Press Next or{' '}
                                  <button type="button" className="font-semibold underline"
                                    onClick={() => flow.reanchor(0)}>
                                    retry from the beginning
                                  </button>.
                                </>
                            : flow.status === 'listening'
                            ? 'Following your current turn locally.'
                            : flow.status === 'silence-stopped'
                              ? <>
                                  Flow stopped for inactivity; this turn was not advanced.{' '}
                                  <button
                                    type="button"
                                    className="font-semibold underline"
                                    onClick={() => flow.start()}
                                  >
                                    Resume Flow
                                  </button>
                                </>
                              : `Flow for your turn: ${flow.error ?? flow.status}.`}
                        </p>
                      )}
                      {scene.message && (
                        <p role="alert" className="mt-2 text-sm font-normal text-destructive">{scene.message}</p>
                      )}
                    </aside>
                  );
                })()}
                {!sceneEnabled && idx === activeSectionIdx && (script.sections[idx]?.notes?.trim()) && (
                  <aside
                    className="mb-4 rounded-lg border border-border bg-muted/50 px-4 py-3"
                    aria-label="Section notes"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => setShowSceneNotes(value => !value)}
                      >
                        {showSceneNotes ? 'Hide notes' : 'Show notes'}
                      </button>
                    </div>
                    {showSceneNotes && (
                      <p className="mt-2 whitespace-pre-wrap text-sm font-normal">{script.sections[idx].notes}</p>
                    )}
                  </aside>
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
                       if (!sceneEnabled && readMode === "flow") {
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

      {readMode === 'flow' && !sceneEnabled && !showWizard && (
        <FlowStatusPanel 
          flow={{ ...flow, start: () => dispatchCommand({ action: 'playPause' }) }}
          onCancelMode={() => dispatchCommand({ action: 'setReadMode', mode: 'manual' })}
          onOpenWizard={() => setShowWizard(true)}
        />
      )}

      {showWizard && !sceneEnabled && (
        <FlowSetupWizard
          flow={{ ...flow, start: () => dispatchCommand({ action: 'playPause' }) }}
          onComplete={() => {
            localStorage.setItem('quickque-flow-setup-done', 'true');
            setShowWizard(false);
          }}
          onCancel={() => {
            const isSetupDone = localStorage.getItem('quickque-flow-setup-done') === 'true';
            if (!isSetupDone) {
              dispatchCommand({ action: 'setReadMode', mode: 'manual' });
            }
            setShowWizard(false);
          }}
        />
      )}

      {/* Bottom Controls / Section Navigation */}
      <div className={`scene-transport absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 md:gap-4 p-2 md:p-3 rounded-full bg-background/80 backdrop-blur-xl border border-border shadow-2xl z-50 transition-all duration-300 ${showControls || (sceneEnabled ? scene.phase !== 'speaking' && scene.phase !== 'preparing' : readMode === 'manual' ? !isPlaying : flow.status !== 'listening') ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>
        
        <button
          onClick={() => dispatchCommand({ action: 'previous' })}
          disabled={activeSectionIdx === 0}
          className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
          title={sceneEnabled ? 'Previous turn (Left Arrow)' : 'Previous section (Left Arrow)'}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {sceneEnabled && (
          <button
            type="button"
            onClick={() => {
              // A paused replay is a new active playback interval, not speech
              // running behind a paused presentation clock.
              if (playback.state.phase === 'playing') void scene.replay();
              else playback.requestStart(0);
            }}
            disabled={scene.phase === 'completed' || ['countdown', 'starting'].includes(playbackState.phase)}
            className="px-2 text-xs underline whitespace-nowrap"
            title="Replay current turn"
          >
            Replay
          </button>
        )}

        <select
          aria-label={isPerformance ? 'Turn navigation' : 'Section navigation'}
          value={activeSectionIdx}
          onChange={(e) => dispatchCommand({ action: 'jumpToSection', value: Number(e.target.value) })}
          className="bg-transparent font-medium text-foreground appearance-none outline-none text-center text-sm px-2 w-32 md:w-48 truncate cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded"
        >
          {enrichedSections.map((sec, idx) => (
            <option key={sec.id} value={idx}>
              {idx + 1}. {isPerformance
                ? `${characters.find(character => character.id === script.sections[idx]?.characterId)?.name ?? 'Unassigned'} · ${sceneMyRoleIds.includes(script.sections[idx]?.characterId ?? '') ? 'In Person' : 'AI Partner'} · ${sec.title || 'Untitled'}`
                : sec.title || 'Untitled'}
            </option>
          ))}
        </select>

        <button
          onClick={() => dispatchCommand({ action: 'next' })}
          disabled={!sceneEnabled && activeSectionIdx === enrichedSections.length - 1}
          className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
          title={sceneEnabled ? 'Next turn (Right Arrow)' : 'Next section (Right Arrow)'}
        >
          <span className="flex items-center gap-1">{sceneEnabled && <span className="text-sm font-medium">Next</span>}<ChevronRight className="w-5 h-5" /></span>
        </button>
        
        <div className="w-px h-6 bg-border mx-1" />
        
        <button
          onClick={() => dispatchCommand({ action: 'playPause' })}
          aria-label={['countdown', 'starting', 'playing'].includes(playbackState.phase) ? isPerformance ? 'Pause rehearsal' : 'Pause presentation' : sceneEnabled ? 'Start or resume scene' : 'Play presentation'}
          disabled={!sceneEnabled && readMode === 'flow' && !['ready', 'listening', 'paused', 'silence-stopped', 'stopped', 'loading', 'error'].includes(flow.status)}
          className="w-14 h-14 flex items-center justify-center bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 hover:scale-105 transition-all focus:outline-none focus:ring-4 focus:ring-primary/30 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
        >
          {!sceneEnabled && readMode === 'flow' && flow.status === 'loading' ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            ['countdown', 'starting', 'playing'].includes(playbackState.phase) ?
              <Pause className="w-6 h-6 fill-current" /> : 
              <Play className="w-6 h-6 fill-current ml-1" />
          )}
        </button>
        <button onClick={startOver} className="px-3 text-xs underline whitespace-nowrap">Start over</button>
      </div>

    </div>
  );
}
