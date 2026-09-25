"use client";

import type { UploadedFile } from "@valt/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { uploadFile } from "@/lib/api";
import { isAbortError, toUserError, type UserFacingError } from "@/lib/errors";
import type { WorkflowConfig, WorkflowInput } from "@/lib/workflow/types";

export type WorkflowStage = "upload" | "analyze" | "finalize";

export type WorkflowState<TResult> =
  | { status: "idle" }
  | {
      status: "running";
      stage: WorkflowStage;
      uploaded: number;
      totalFiles: number;
      startedAt: number;
    }
  | { status: "success"; result: TResult; durationMs: number }
  | { status: "error"; error: UserFacingError };

/**
 * Input → upload → run → result, with cancel and retry. UI-agnostic: components render from
 * `state` and call `submit` / `cancel` / `retry` / `reset`.
 */
export function useAiWorkflow<TResult>(config: Pick<WorkflowConfig<TResult>, "run">) {
  const [state, setState] = useState<WorkflowState<TResult>>({ status: "idle" });
  const [input, setInput] = useState<WorkflowInput | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Retry doesn't re-upload files that already succeeded.
  const uploads = useRef(new WeakMap<File, UploadedFile>());
  const runRef = useRef(config.run);
  useEffect(() => {
    runRef.current = config.run;
  });

  const submit = useCallback(async (next: WorkflowInput) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setInput(next);

    const startedAt = Date.now();
    const pending = next.files.filter((f) => !uploads.current.has(f));
    let uploaded = next.files.length - pending.length;
    setState({
      status: "running",
      stage: pending.length ? "upload" : "analyze",
      uploaded,
      totalFiles: next.files.length,
      startedAt,
    });

    try {
      await Promise.all(
        pending.map(async (file) => {
          const meta = await uploadFile(file, { signal: ctrl.signal });
          uploads.current.set(file, meta);
          uploaded += 1;
          setState((s) => (s.status === "running" ? { ...s, uploaded } : s));
        }),
      );

      setState((s) => (s.status === "running" ? { ...s, stage: "analyze" } : s));
      const files = next.files.map((f) => uploads.current.get(f)!);
      const result = await runRef.current({
        text: next.text.trim(),
        files,
        fileIds: files.map((f) => f.id),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;

      setState({ status: "success", result, durationMs: Date.now() - startedAt });
    } catch (err) {
      if (isAbortError(err) || ctrl.signal.aborted) return;
      setState({ status: "error", error: toUserError(err) });
    }
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState({ status: "idle" });
  }, []);

  const retry = useCallback(() => {
    if (input) void submit(input);
  }, [input, submit]);

  /** Back to an empty form. */
  const reset = useCallback(() => {
    controller.current?.abort();
    setInput(null);
    setState({ status: "idle" });
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  return { state, input, submit, cancel, retry, reset };
}
