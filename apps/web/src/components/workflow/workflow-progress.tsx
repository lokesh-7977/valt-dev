import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Compact "Input → Processing → Results" indicator for the top of a workflow page. */
export function WorkflowProgress({
  steps,
  current,
  className,
}: {
  steps: string[];
  current: number;
  className?: string;
}) {
  return (
    <ol aria-label="Progress" className={cn("flex items-center gap-1.5 sm:gap-3", className)}>
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <li key={label} className="flex items-center gap-1.5 sm:gap-3">
            {i > 0 && (
              <span
                aria-hidden
                className={cn("h-px w-3 sm:w-10", i <= current ? "bg-foreground/40" : "bg-border")}
              />
            )}
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 text-footnote",
                state === "upcoming" ? "text-muted-foreground" : "text-foreground",
                state === "current" && "font-semibold",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-5 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
                  state === "done" && "bg-foreground text-background",
                  state === "current" && "bg-primary text-primary-foreground",
                  state === "upcoming" && "bg-secondary text-muted-foreground",
                )}
              >
                {state === "done" ? <CheckIcon className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
