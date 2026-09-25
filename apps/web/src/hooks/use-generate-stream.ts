"use client";

import type { GenerateRequest } from "@valt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { generateStream } from "@/lib/api";
import { isAbortError, toUserError, type UserFacingError } from "@/lib/errors";

export type StreamStatus = "idle" | "waiting" | "streaming" | "done" | "error";

/** Streams POST /generate/stream into `text`. `stop()` aborts; unmount aborts too. */
export function useGenerateStream() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<UserFacingError | null>(null);
  const controller = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const start = useCallback(
    async (req: GenerateRequest) => {
      stop();
      const ctrl = new AbortController();
      controller.current = ctrl;
      setText("");
      setError(null);
      setStatus("waiting");
      try {
        for await (const ev of generateStream(req, ctrl.signal)) {
          if (ev.event === "token") {
            setStatus("streaming");
            setText((t) => t + ev.data.text);
          } else if (ev.event === "error") {
            setError({
              title: "Generation stopped",
              description: ev.data.message,
              retryable: true,
              requestId: ev.data.request_id,
            });
            setStatus("error");
            return;
          }
        }
        setStatus("done");
      } catch (err) {
        if (isAbortError(err)) {
          setStatus((s) => (s === "waiting" ? "idle" : "done"));
          return;
        }
        setError(toUserError(err));
        setStatus("error");
      }
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return { text, status, error, start, stop };
}
