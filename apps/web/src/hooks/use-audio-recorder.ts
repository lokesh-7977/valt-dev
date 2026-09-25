"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { toWav } from "@/lib/audio";

export type RecorderStatus = "idle" | "requesting" | "recording" | "processing" | "done" | "error";

export interface RecorderState {
  status: RecorderStatus;
  /** Final recording as a WAV File, ready to upload. */
  file: File | null;
  elapsedMs: number;
  error: string | null;
}

export function useAudioRecorder({ maxMs = 5 * 60_000 }: { maxMs?: number } = {}) {
  const [state, setState] = useState<RecorderState>({
    status: "idle",
    file: null,
    elapsedMs: 0,
    error: null,
  });
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    clearTimer();
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState((s) => ({
        ...s,
        status: "error",
        error: "Recording isn't supported in this browser.",
      }));
      return;
    }
    setState({ status: "requesting", file: null, elapsedMs: 0, error: null });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState((s) => ({
        ...s,
        status: "error",
        error: "Microphone access was blocked. Allow it in your browser settings.",
      }));
      return;
    }

    const rec = new MediaRecorder(stream);
    recorder.current = rec;
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState((s) => ({ ...s, status: "processing" }));
      try {
        const wav = await toWav(new Blob(chunks.current, { type: rec.mimeType }));
        const file = new File([wav], `recording-${Date.now()}.wav`, { type: "audio/wav" });
        setState((s) => ({ ...s, status: "done", file }));
      } catch {
        setState((s) => ({ ...s, status: "error", error: "Couldn't process the recording." }));
      }
    };

    const startedAt = performance.now();
    rec.start(250);
    setState((s) => ({ ...s, status: "recording" }));
    timer.current = window.setInterval(() => {
      const elapsedMs = performance.now() - startedAt;
      setState((s) => ({ ...s, elapsedMs }));
      if (elapsedMs >= maxMs) stop();
    }, 200);
  }, [maxMs, stop]);

  const reset = useCallback(() => {
    stop();
    setState({ status: "idle", file: null, elapsedMs: 0, error: null });
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { ...state, start, stop, reset };
}
