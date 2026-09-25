"use client";

import { CheckIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn, formatDuration } from "@/lib/utils";

export interface ProcessingStep {
  id: string;
  label: string;
  /** Extra detail, e.g. "2 of 3 files". */
  detail?: string;
  state: "pending" | "active" | "done" | "skipped";
}

/**
 * Honest progress for a slow AI call: real steps, elapsed time, and rotating status lines —
 * no fake percentages. Visible within a frame of submit.
 */
export function ProcessingScreen({
  title = "Working on it",
  steps,
  hints = [],
  startedAt,
  onCancel,
  className,
}: {
  title?: string;
  steps: ProcessingStep[];
  hints?: string[];
  startedAt: number;
  onCancel?: () => void;
  className?: string;
}) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  const hint = hints.length ? hints[Math.floor(elapsed / 3500) % hints.length] : null;
  const visible = steps.filter((s) => s.state !== "skipped");
  const done = visible.filter((s) => s.state === "done").length;

  return (
    <Card className={cn("mx-auto w-full max-w-[560px]", className)}>
      <CardContent className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div role="status" aria-live="polite">
            <p className="text-title-3 font-semibold">{title}</p>
            <p className="mt-1 min-h-[1.4em] text-callout text-muted-foreground">
              {hint ?? "This usually takes a few seconds."}
            </p>
          </div>
          <span className="shrink-0 font-mono text-footnote text-muted-foreground tabular-nums">
            {formatDuration(elapsed)}
          </span>
        </div>

        <Progress
          value={((done + 0.5) / Math.max(visible.length, 1)) * 100}
          aria-label="Progress"
          className="h-1.5"
        />

        <ol className="flex flex-col gap-3">
          {visible.map((step) => (
            <li key={step.id} className="flex items-center gap-3">
              <span
                aria-hidden
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full",
                  step.state === "done" && "bg-success/12 text-success",
                  step.state === "active" && "bg-primary/10 text-primary",
                  step.state === "pending" && "bg-secondary text-muted-foreground",
                )}
              >
                {step.state === "done" ? (
                  <CheckIcon className="size-3.5" strokeWidth={2.5} />
                ) : step.state === "active" ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <span
                className={cn(
                  "text-callout",
                  step.state === "pending" ? "text-muted-foreground" : "text-foreground",
                  step.state === "active" && "font-medium",
                )}
              >
                {step.label}
                <span className="sr-only">
                  {step.state === "done"
                    ? " (done)"
                    : step.state === "active"
                      ? " (in progress)"
                      : ""}
                </span>
              </span>
              {step.detail && (
                <span className="ml-auto text-footnote text-muted-foreground tabular-nums">
                  {step.detail}
                </span>
              )}
            </li>
          ))}
        </ol>

        {onCancel && (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
