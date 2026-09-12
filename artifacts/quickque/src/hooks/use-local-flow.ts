import { useState, useEffect, useRef, useCallback, type MutableRefObject } from 'react';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { FlowAligner } from '../lib/flow/alignment';
import { NormalizedToken } from '../lib/flow/tokenize';
import { isDesktop } from '../lib/desktop';
import { recordFlowDebug, recordFlowEvent } from '../lib/flow/diagnostics';
import { parseAudioLevel, type AudioLevelSample } from '../lib/flow/audio-level';
import {
  parseAudioDroppedWarning,
  parseNativeErrorDetails,
  normalizeNativeErrorCode,
  MAX_NATIVE_MESSAGE_LENGTH,
  type AudioDroppedWarning,
  type NativeErrorDetails,
} from '../lib/flow/native-errors';

// One wrapper also traces best-effort stop commands, even after UI unmount.
async function invoke(name: string, args: { command: { action: string; generation: number } }) {
  const { action, generation } = args.command;
  const started = performance.now();
  recordFlowDebug('command_sent', generation, undefined, action);
  try {
    await tauriInvoke(name, args);
    recordFlowDebug('command_resolved', generation, Math.round(performance.now() - started), action);
  } catch (error) {
    recordFlowDebug('command_failed', generation, Math.round(performance.now() - started), action);
    if (action === 'stop') recordFlowDebug('cleanup_failed', generation);
    throw error;
  }
}

export type FlowStatus = "needs-model" | "ready" | "downloading" | "loading" | "listening" | "paused" | "silence-stopped" | "stopped" | "unsupported" | "error";

export interface FlowState {
  status: FlowStatus;
  error: string | null;
  errorCode: string | null;
  errorDetails: NativeErrorDetails | null;
  warning: AudioDroppedWarning | null;
  progress: number | null;
  downloadMessage: string | null;
  anchor: number;
  isFollowing: boolean;
  audioLevelRef: MutableRefObject<AudioLevelSample>;
  start: () => void;
  pause: () => void;
  stop: () => void;
  download: () => void;
  cancelDownload: () => void;
  reanchor: (tokenIndex: number) => void;
  clearErrorDetails: () => void;
}

interface UseLocalFlowArgs {
  tokens: NormalizedToken[];
  enabled: boolean;
}

let globalGeneration = Date.now();
const nextGen = () => ++globalGeneration;

// Keep lifecycle diagnostics bounded and strip control characters so native
// failures cannot become a transcript or audio logging channel.
function safeDiagnostic(value: unknown): string {
  return (typeof value === "string" ? value : "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 240);
}

function bridgeError(error: unknown, operation: string): string {
  const detail = typeof error === "string"
    ? error
    : error && typeof error === "object" && "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  const safeDetail = safeDiagnostic(detail);
  return safeDetail
    ? `Flow ${operation} failed: ${safeDetail}`
    : `Flow ${operation} failed. Check that the Quickque desktop bridge is available.`;
}

export function useLocalFlow({ tokens, enabled }: UseLocalFlowArgs): FlowState {
  const [status, setStatus] = useState<FlowStatus>("unsupported");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<NativeErrorDetails | null>(null);
  const [warning, setWarning] = useState<AudioDroppedWarning | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<number>(0);
  const [isFollowing, setIsFollowing] = useState<boolean>(false);
  // The meter reads a ref so audio telemetry never rerenders the entire script.
  const audioLevelRef = useRef<AudioLevelSample>({ level: 0, receivedAt: 0 });

  const statusRef = useRef<FlowStatus>("unsupported");
  const activeGenRef = useRef<number>(globalGeneration);
  const anchorRef = useRef<number>(0);
  const alignerRef = useRef<FlowAligner | null>(null);
  const lastSequenceRef = useRef<number>(-1);
  const activeRef = useRef(false);
  const listenerReadyRef = useRef(false);
  const captureRequestedRef = useRef(false);
  const watchdogArmRef = useRef<((generation: number, milliseconds: number, code: string, message: string) => void) | null>(null);
  const watchdogClearRef = useRef<(() => void) | null>(null);

  // Synchronously update aligner if tokens change
  const prevTokens = useRef(tokens);
  if (prevTokens.current !== tokens || !alignerRef.current) {
    alignerRef.current = new FlowAligner(tokens);
    prevTokens.current = tokens;
    anchorRef.current = 0;
  }

  const setStatusSync = useCallback((s: FlowStatus) => {
    if (s !== "listening") audioLevelRef.current = { level: 0, receivedAt: 0 };
    statusRef.current = s;
    setStatus(s);
  }, []);

  const clearErrorDetails = useCallback(() => {
    setErrorDetails(null);
  }, []);

  const invokeFlow = useCallback(async (action: string, gen: number) => {
    if (!isDesktop()) return;
    try {
      await invoke("flow_command", { command: { action, generation: gen } });
    } catch (err) {
      if (!activeRef.current || activeGenRef.current !== gen) return;
      activeGenRef.current = nextGen();
      captureRequestedRef.current = false;
      setStatusSync("error");
      setIsFollowing(false);
      setErrorCode("FLOW_INVOKE");
      setErrorDetails(null);
      setWarning(null);
      setError(`[FLOW_INVOKE] ${bridgeError(err, action)}`);
      // Use the failed generation: cleanup events cannot revive the UI.
      const stopGen = nextGen();
      void invoke("flow_command", { command: { action: "stop", generation: stopGen } }).catch(() => {});
      activeGenRef.current = nextGen();
    }
  }, [setStatusSync]);

  useEffect(() => {
    setAnchor(anchorRef.current);
    if (!isDesktop()) {
      if (enabled) setStatusSync("unsupported");
      return;
    }
    if (!enabled) {
      audioLevelRef.current = { level: 0, receivedAt: 0 };
      setWarning(null);
      setErrorDetails(null);
      setErrorCode(null);
      return;
    }

    const currentGen = nextGen();
    recordFlowDebug('session_begin', currentGen);
    activeGenRef.current = currentGen;
    activeRef.current = true;
    listenerReadyRef.current = false;
    captureRequestedRef.current = false;
    
    setStatusSync("loading");
    setError(null);
    setErrorCode(null);
    setErrorDetails(null);
    setWarning(null);
    setProgress(null);
    setDownloadMessage(null);
    setIsFollowing(false);
    lastSequenceRef.current = -1;

    let unlisten: UnlistenFn | null = null;
    let isCancelled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const clearWatchdog = () => {
      if (watchdog !== null) {
        clearTimeout(watchdog);
        recordFlowDebug('watchdog_cleared', activeGenRef.current);
      }
      watchdog = null;
    };
    const armWatchdog = (generation: number, milliseconds: number, code: string, message: string) => {
      clearWatchdog();
      recordFlowDebug('watchdog_armed', generation, milliseconds);
      watchdog = setTimeout(() => {
        if (isCancelled || activeGenRef.current !== generation) return;
        recordFlowDebug('watchdog_expired', generation, milliseconds);
        activeGenRef.current = nextGen();
        captureRequestedRef.current = false;
        setStatusSync("error");
        setIsFollowing(false);
        setErrorCode(code);
        setErrorDetails(null);
        setWarning(null);
        setError(`[${code}] ${message}`);
        const stopGen = nextGen();
        void invoke("flow_command", { command: { action: "stop", generation: stopGen } }).catch(() => {});
        activeGenRef.current = nextGen();
      }, milliseconds);
    };
    watchdogArmRef.current = armWatchdog;
    watchdogClearRef.current = clearWatchdog;

    const fail = (message: string, details: NativeErrorDetails | null = null, code: string | null = null) => {
      activeGenRef.current = nextGen();
      captureRequestedRef.current = false;
      clearWatchdog();
      setStatusSync("error");
      setIsFollowing(false);
      const safeMessage = safeDiagnostic(message) || "The local Flow engine stopped.";
      recordFlowDebug('lifecycle_error', activeGenRef.current);
      setError(safeMessage);
      setErrorCode(code);
      setErrorDetails(details);
      setWarning(null);
      const stopGen = nextGen();
      void invoke("flow_command", { command: { action: "stop", generation: stopGen } }).catch(() => {});
      activeGenRef.current = nextGen();
    };

    const setup = async () => {
      try {
        recordFlowDebug('listener_begin', currentGen);
        unlisten = await listen("quickque:flow", (event: any) => {
          if (isCancelled) return;
          const payload = event.payload;
          recordFlowEvent(payload, activeGenRef.current);
          if (!payload || payload.generation !== activeGenRef.current) return;

          if (payload.type === "audio_level") {
            const sample = parseAudioLevel(
              payload, activeGenRef.current, statusRef.current === "listening",
              performance.now(),
            );
            if (sample) audioLevelRef.current = sample;
          } else if (payload.type === "status") {
            if (payload.status === "downloading") {
              armWatchdog(activeGenRef.current, 15 * 60 * 1000, "FLOW_TIMEOUT",
                "Apple language asset download is taking too long. Cancel it and try again.");
            } else if (payload.status === "loading") {
              armWatchdog(activeGenRef.current, 2 * 60 * 1000, "FLOW_TIMEOUT",
                "Flow is taking too long to prepare. Stop and try again.");
            } else if (payload.status === "ready" || payload.status === "needs-model" ||
              payload.status === "listening" || payload.status === "silence-stopped" ||
              payload.status === "paused" || payload.status === "stopped" ||
              payload.status === "unsupported") {
              clearWatchdog();
            }
            if (payload.status === "error") {
              fail(payload.message || "The local audio engine stopped.");
            } else {
              if (!["needs-model", "ready", "downloading", "loading", "listening", "paused", "silence-stopped", "stopped", "unsupported"].includes(payload.status)) return;
              if (["paused", "silence-stopped", "stopped", "unsupported", "needs-model", "ready"].includes(payload.status)) {
                captureRequestedRef.current = false;
                setIsFollowing(false);
                setWarning(null);
              }
              setStatusSync(payload.status);
              if (typeof payload.progress === "number" &&
                  Number.isFinite(payload.progress) &&
                  payload.progress >= 0 && payload.progress <= 1) {
                setProgress(payload.progress);
                if (payload.status === "downloading") {
                  armWatchdog(activeGenRef.current, 15 * 60 * 1000, "FLOW_TIMEOUT",
                    "Apple language asset download is taking too long. Cancel it and try again.");
                }
              }
              if (typeof payload.message === "string" && payload.message.length <= MAX_NATIVE_MESSAGE_LENGTH) {
                setDownloadMessage(payload.message);
              }
            }
          } else if (payload.type === "warning") {
            // Audio drops are transient pipeline feedback. They never fail
            // the session, reset a watchdog, or change capture state.
            const audioWarning = parseAudioDroppedWarning(payload, activeGenRef.current);
            if (audioWarning) setWarning(audioWarning);
          } else if (payload.type === "error") {
            const helperMessage = typeof payload.message === "string" && payload.message.length <= MAX_NATIVE_MESSAGE_LENGTH
              ? payload.message
              : "The local Flow helper reported a failure.";
            const code = normalizeNativeErrorCode(payload.code);
            fail(`[${code}] ${helperMessage}`, parseNativeErrorDetails(payload, activeGenRef.current), code);
          } else if (payload.type === "transcript") {
            // Immediate statusRef gates transcript acceptance
            if (statusRef.current !== "listening") return;
            
            // Sequence deduplication and strict ordering constraint
            if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 0 ||
              typeof payload.text !== "string" || payload.text.length > 32000 ||
              typeof payload.utteranceId !== "string" || typeof payload.isFinal !== "boolean") {
              fail("Invalid recognition update. Restart Flow to try again.");
              return;
            }
            if (payload.sequence <= lastSequenceRef.current) return;
            if (payload.sequence > lastSequenceRef.current + 1) {
              fail("Recognition updates lost their order. Restart Flow to try again.");
              return;
            }
            lastSequenceRef.current = payload.sequence;
            
            if (alignerRef.current) {
              const res = alignerRef.current.update(payload.utteranceId, payload.text, payload.isFinal);
              if (res.matched) {
                setIsFollowing(true);
                setAnchor(res.anchor);
                anchorRef.current = res.anchor;
              } else if (!payload.isFinal) {
                setIsFollowing(false);
              }
            }
          }
        });

        // Cancelled before async listener finished binding
        if (isCancelled || activeGenRef.current !== currentGen) {
          unlisten();
          recordFlowDebug('listener_removed', currentGen);
          return;
        }

        listenerReadyRef.current = true;
        recordFlowDebug('listener_ready', currentGen);
        await invokeFlow("status", currentGen);
      } catch (err) {
        if (isCancelled || activeGenRef.current !== currentGen) return;
        clearWatchdog();
        recordFlowDebug('listener_failed', currentGen);
        setErrorCode("FLOW_LISTENER");
        setErrorDetails(null);
        setWarning(null);
        setError(`[FLOW_LISTENER] ${bridgeError(err, "event listener")}`);
        setStatusSync("error");
      }
    };

    armWatchdog(currentGen, 30 * 1000, "FLOW_TIMEOUT",
      "Flow did not respond. Check the desktop bridge, then retry.");
    setup();

    return () => {
      isCancelled = true;
      audioLevelRef.current = { level: 0, receivedAt: 0 };
      recordFlowDebug('session_cleanup', activeGenRef.current);
      clearWatchdog();
      watchdogArmRef.current = null;
      watchdogClearRef.current = null;
      activeRef.current = false;
      listenerReadyRef.current = false;
      captureRequestedRef.current = false;
      setWarning(null);
      setErrorDetails(null);
      setErrorCode(null);
      const stopGen = nextGen();
      activeGenRef.current = stopGen;
      
      // Attempt best-effort stop; suppress exceptions silently from unmounted lifecycle
      void invoke("flow_command", { command: { action: "stop", generation: stopGen } }).catch(() => {});
      if (unlisten) {
        unlisten();
        recordFlowDebug('listener_removed', currentGen);
      }
    };
  }, [enabled, tokens, invokeFlow, setStatusSync]);

  const start = useCallback(() => {
    if (!activeRef.current || statusRef.current === "unsupported" || statusRef.current === "downloading") return;
    if (!listenerReadyRef.current) {
      setStatusSync("error");
      setErrorCode("FLOW_LISTENER");
      setErrorDetails(null);
      setWarning(null);
      setError("Flow could not initialise. Return to manual mode, then choose Voice Follow again.");
      return;
    }
    if (!tokens.length) {
      setStatusSync("error");
      setErrorCode("FLOW_INPUT");
      setErrorDetails(null);
      setWarning(null);
      setError("Add some script text before starting Flow.");
      return;
    }
    captureRequestedRef.current = true;
    setError(null);
    setErrorCode(null);
    setErrorDetails(null);
    setWarning(null);
    setIsFollowing(false);
    lastSequenceRef.current = -1;
    
    // Explicit anchor reload to discard prior partial matches/utterances globally 
    if (alignerRef.current) alignerRef.current.reanchor(anchorRef.current);
    
    const gen = nextGen();
    activeGenRef.current = gen;
    setStatusSync("loading");
    watchdogArmRef.current?.(gen, 2 * 60 * 1000, "FLOW_TIMEOUT",
      "Flow is taking too long to prepare. Stop and try again.");
    invokeFlow("start", gen).catch(() => {});
  }, [invokeFlow, setStatusSync, tokens.length]);

  const pause = useCallback(() => {
    captureRequestedRef.current = false;
    setWarning(null);
    setErrorDetails(null);
    setErrorCode(null);
    const gen = nextGen();
    activeGenRef.current = gen;
    setStatusSync("paused");
    setIsFollowing(false);
    invokeFlow("pause", gen).catch(() => {});
  }, [invokeFlow, setStatusSync]);

  const stop = useCallback(() => {
    captureRequestedRef.current = false;
    watchdogClearRef.current?.();
    setWarning(null);
    setErrorDetails(null);
    setErrorCode(null);
    const gen = nextGen();
    activeGenRef.current = gen;
    setStatusSync("stopped");
    setIsFollowing(false);
    invokeFlow("stop", gen).catch(() => {});
  }, [invokeFlow, setStatusSync]);

  const download = useCallback(() => {
    if (!activeRef.current) return;
    captureRequestedRef.current = false;
    setError(null);
    setErrorCode(null);
    setErrorDetails(null);
    setWarning(null);
    setProgress(0);
    setDownloadMessage(null);
    
    const gen = nextGen();
    activeGenRef.current = gen;
    setStatusSync("downloading");
    watchdogArmRef.current?.(gen, 15 * 60 * 1000, "FLOW_TIMEOUT",
      "Apple language asset download is taking too long. Cancel it and try again.");
    invokeFlow("download", gen).catch(() => {});
  }, [invokeFlow, setStatusSync]);

  const cancelDownload = useCallback(() => {
    captureRequestedRef.current = false;
    setWarning(null);
    setErrorDetails(null);
    setErrorCode(null);
    const gen = nextGen();
    activeGenRef.current = gen;
    invokeFlow("cancelDownload", gen).catch(() => {});
    setStatusSync("needs-model");
  }, [invokeFlow, setStatusSync]);

  const reanchor = useCallback((tokenIndex: number) => {
    audioLevelRef.current = { level: 0, receivedAt: 0 };
    setWarning(null);
    setErrorDetails(null);
    setErrorCode(null);
    if (alignerRef.current) alignerRef.current.reanchor(tokenIndex);
    setAnchor(tokenIndex);
    anchorRef.current = tokenIndex;
    setIsFollowing(false);

    // Synchronously invalidate and restart if was actively running
    if (activeRef.current && captureRequestedRef.current) {
      const startGen = nextGen();
      activeGenRef.current = startGen;
      lastSequenceRef.current = -1;
      setStatusSync("loading");
      watchdogArmRef.current?.(startGen, 2 * 60 * 1000, "FLOW_TIMEOUT",
        "Flow is taking too long to prepare. Stop and try again.");
      // The native command atomically replaces the previous helper; there is
      // no deferred restart that could race with a subsequent manual pause.
      invokeFlow("start", startGen).catch(() => {});
    }
  }, [invokeFlow, setStatusSync]);

  return {
    status,
    error,
    errorCode,
    errorDetails,
    warning,
    progress,
    downloadMessage,
    anchor,
    isFollowing,
    audioLevelRef,
    start,
    pause,
    stop,
    download,
    cancelDownload,
    reanchor,
    clearErrorDetails,
  };
}
