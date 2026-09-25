"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/feedback/states";
import { ProcessingScreen, type ProcessingStep } from "@/components/ai/processing-screen";
import { Button } from "@/components/ui/button";
import { MultimodalInput } from "@/components/workflow/multimodal-input";
import { WorkflowProgress } from "@/components/workflow/workflow-progress";
import { useAiWorkflow, type WorkflowState } from "@/lib/workflow/use-ai-workflow";
import type { WorkflowConfig } from "@/lib/workflow/types";

const PHASES = ["Input", "Processing", "Results"];

/**
 * Input → Processing → Results for any WorkflowConfig. Contains no domain logic: what to call
 * lives in `config.run`, how to show it in `config.Result`.
 */
export function AiWorkflow<TResult>({ config }: { config: WorkflowConfig<TResult> }) {
  const { state, input, submit, cancel, retry, reset } = useAiWorkflow(config);
  const top = useRef<HTMLDivElement>(null);
  const prevStatus = useRef(state.status);

  // On phase change, scroll to the top so results aren't below the fold on phones.
  useEffect(() => {
    if (prevStatus.current === state.status) return;
    prevStatus.current = state.status;
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (state.status === "success") toast.success("Results ready");
  }, [state.status]);

  const phase = state.status === "idle" ? 0 : state.status === "success" ? 2 : 1;

  return (
    <div ref={top} className="flex scroll-mt-20 flex-col gap-8">
      <WorkflowProgress steps={PHASES} current={phase} />

      {state.status === "idle" && (
        <MultimodalInput config={config.input} defaultValues={input} onSubmit={submit} />
      )}

      {state.status === "running" && (
        <ProcessingScreen
          startedAt={state.startedAt}
          steps={toSteps(config, state)}
          hints={config.stages.analyzeHints}
          onCancel={cancel}
        />
      )}

      {state.status === "error" && (
        <ErrorState
          error={state.error}
          onRetry={retry}
          secondaryAction={
            <Button variant="secondary" onClick={cancel}>
              Edit input
            </Button>
          }
          className="rounded-xl bg-card shadow-card"
        />
      )}

      {state.status === "success" && input && (
        <config.Result result={state.result} input={input} onReset={reset} />
      )}
    </div>
  );
}

function toSteps<T>(
  config: WorkflowConfig<T>,
  s: Extract<WorkflowState<T>, { status: "running" }>,
): ProcessingStep[] {
  const order = ["upload", "analyze", "finalize"] as const;
  const at = order.indexOf(s.stage);
  const state = (i: number): ProcessingStep["state"] =>
    i < at ? "done" : i === at ? "active" : "pending";
  return [
    {
      id: "upload",
      label: config.stages.upload,
      detail: s.totalFiles ? `${s.uploaded} of ${s.totalFiles}` : undefined,
      state: s.totalFiles === 0 ? "skipped" : state(0),
    },
    { id: "analyze", label: config.stages.analyze, state: state(1) },
    { id: "finalize", label: config.stages.finalize, state: state(2) },
  ];
}
