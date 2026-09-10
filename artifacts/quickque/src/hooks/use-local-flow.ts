import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { FlowAligner } from '../lib/flow/alignment';
import { NormalizedToken } from '../lib/flow/tokenize';
import { isDesktop } from '../lib/desktop';

export type FlowStatus = "needs-model" | "ready" | "downloading" | "loading" | "listening" | "paused" | "silence-stopped" | "stopped" | "unsupported" | "error";

export interface FlowState {
  status: FlowStatus;
  error: string | null;
  progress: number | null;
  totalBytes: number | null;
  downloadMessage: string | null;
  anchor: number;
  isFollowing: boolean;
  start: () => void;
  pause: () => void;
  stop: () => void;
  download: () => void;
  cancelDownload: () => void;
  reanchor: (tokenIndex: number) => void;
}

interface UseLocalFlowArgs {
  tokens: NormalizedToken[];
  enabled: boolean;
}

let globalGeneration = Date.now();
const nextGen = () => ++globalGeneration;

export function useLocalFlow({ tokens, enabled }: UseLocalFlowArgs): FlowState {
  const [status, setStatus] = useState<FlowStatus>("unsupported");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<number>(0);
  const [isFollowing, setIsFollowing] = useState<boolean>(false);

  const statusRef = useRef<FlowStatus>("unsupported");
  const activeGenRef = useRef<number>(globalGeneration);
  const anchorRef = useRef<number>(0);
  const alignerRef = useRef<FlowAligner | null>(null);
  const lastSequenceRef = useRef<number>(-1);
  const activeRef = useRef(false);
  const listenerReadyRef = useRef(false);
  const captureRequestedRef = useRef(false);

  // Synchronously update aligner if tokens change
  const prevTokens = useRef(tokens);
  if (prevTokens.current !== tokens || !alignerRef.current) {
    alignerRef.current = new FlowAligner(tokens);
    prevTokens.current = tokens;
    anchorRef.current = 0;
  }

  const setStatusSync = useCallback((s: FlowStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const invokeFlow = useCallback(async (action: string, gen: number) => {
    if (!isDesktop()) return;
    try {
      await invoke("flow_command", { command: { action, generation: gen } });
    } catch {
      if (!activeRef.current || activeGenRef.current !== gen) return;
      activeGenRef.current = nextGen();
      captureRequestedRef.current = false;
      setStatusSync("error");
      setIsFollowing(false);
      setError("An error occurred communicating with the audio engine.");
      // Use the failed generation: cleanup events cannot revive the UI.
      void invoke("flow_command", { command: { action: "stop", generation: gen } }).catch(() => {});
    }
  }, [setStatusSync]);

  useEffect(() => {
    setAnchor(anchorRef.current);
    if (!isDesktop()) {
      if (enabled) setStatusSync("unsupported");
      return;
    }
    if (!enabled) {
      return;
    }

    const currentGen = nextGen();
    activeGenRef.current = currentGen;
    activeRef.current = true;
    listenerReadyRef.current = false;
    captureRequestedRef.current = false;
    
    setStatusSync("loading");
    setError(null);
    setProgress(null);
    setTotalBytes(null);
    setDownloadMessage(null);
    setIsFollowing(false);
    lastSequenceRef.current = -1;

    let unlisten: UnlistenFn | null = null;
    let isCancelled = false;

    const fail = (message: string) => {
      const failedGen = activeGenRef.current;
      activeGenRef.current = nextGen();
      captureRequestedRef.current = false;
      setStatusSync("error");
      setIsFollowing(false);
      setError(message);
      void invoke("flow_command", { command: { action: "stop", generation: failedGen } }).catch(() => {});
    };

    const setup = async () => {
      try {
        unlisten = await listen("quickque:flow", (event: any) => {
          if (isCancelled) return;
          const payload = event.payload;
          if (!payload || payload.generation !== activeGenRef.current) return;

          if (payload.type === "status") {
            if (payload.status === "error") {
              fail(payload.message || "The local audio engine stopped.");
            } else {
              if (!["needs-model", "ready", "downloading", "loading", "listening", "paused", "silence-stopped", "stopped", "unsupported"].includes(payload.status)) return;
              if (["paused", "silence-stopped", "stopped", "unsupported", "needs-model", "ready"].includes(payload.status)) {
                captureRequestedRef.current = false;
                setIsFollowing(false);
              }
              setStatusSync(payload.status);
              if (payload.progress !== undefined) setProgress(payload.progress);
              if (payload.totalBytes !== undefined) setTotalBytes(payload.totalBytes);
              if (payload.message) setDownloadMessage(payload.message);
            }
          } else if (payload.type === "error") {
            fail(payload.message || "The local audio engine stopped.");
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
          return;
        }

        listenerReadyRef.current = true;
        await invokeFlow("status", currentGen);
      } catch (err: any) {
        if (isCancelled || activeGenRef.current !== currentGen) return;
        setError("Failed to initialize the audio engine.");
        setStatusSync("error");
      }
    };

    setup();

    return () => {
      isCancelled = true;
      activeRef.current = false;
      listenerReadyRef.current = false;
      captureRequestedRef.current = false;
      const stopGen = nextGen();
      activeGenRef.current = stopGen;
      
      // Attempt best-effort stop; suppress exceptions silently from unmounted lifecycle
      void invoke("flow_command", { command: { action: "stop", generation: stopGen } }).catch(() => {});
      if (unlisten) unlisten();
    };
  }, [enabled, tokens, invokeFlow, setStatusSync]);

  const start = useCallback(() => {
    if (!activeRef.current || statusRef.current === "unsupported" || statusRef.current === "downloading") return;
    if (!listenerReadyRef.current) {
      setStatusSync("error");
      setError("Flow could not initialise. Return to manual mode, then choose Voice Follow again.");
      return;
    }
    if (!tokens.length) {
      setStatusSync("error");
      setError("Add some script text before starting Flow.");
      return;
    }
    captureRequestedRef.current = true;
    setError(null);
    setIsFollowing(false);
    lastSequenceRef.current = -1;
    
    // Explicit anchor reload to discard prior partial matches/utterances globally 
    if (alignerRef.current) alignerRef.current.reanchor(anchorRef.current);
    
    const gen = nextGen();
    activeGenRef.current = gen;
    setStatusSync("loading");
    invokeFlow("start", gen).catch(() => {});
  }, [invokeFlow, setStatusSync, tokens.length]);

  const pause = useCallback(() => {
    captureRequestedRef.current = false;
    const gen = nextGen();
    activeGenRef.current = gen;
    setStatusSync("paused");
    setIsFollowing(false);
    invokeFlow("pause", gen).catch(() => {});
  }, [invokeFlow, setStatusSync]);

  const stop = useCallback(() => {
    captureRequestedRef.current = false;
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
    setProgress(0);
    setTotalBytes(null);
    setDownloadMessage(null);
    
    const gen = nextGen();
    activeGenRef.current = gen;
    setStatusSync("downloading");
    invokeFlow("download", gen).catch(() => {});
  }, [invokeFlow, setStatusSync]);

  const cancelDownload = useCallback(() => {
    captureRequestedRef.current = false;
    const gen = nextGen();
    activeGenRef.current = gen;
    invokeFlow("cancelDownload", gen).catch(() => {});
    setStatusSync("needs-model");
  }, [invokeFlow, setStatusSync]);

  const reanchor = useCallback((tokenIndex: number) => {
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
      // The native command atomically replaces the previous helper; there is
      // no deferred restart that could race with a subsequent manual pause.
      invokeFlow("start", startGen).catch(() => {});
    }
  }, [invokeFlow, setStatusSync]);

  return {
    status,
    error,
    progress,
    totalBytes,
    downloadMessage,
    anchor,
    isFollowing,
    start,
    pause,
    stop,
    download,
    cancelDownload,
    reanchor,
  };
}
