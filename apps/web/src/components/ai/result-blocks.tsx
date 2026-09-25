import { ArrowRightIcon, CheckCircle2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Small, schema-agnostic building blocks for result screens. Compose them in a Result component
 * (see analysis-result.tsx) — they take plain values, never API types.
 */

export function ConfidenceMeter({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const level = pct >= 75 ? "High" : pct >= 45 ? "Medium" : "Low";
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between">
        <span className="text-footnote text-muted-foreground">Confidence</span>
        <span className="text-callout font-semibold tabular-nums">
          {pct}% <span className="font-normal text-muted-foreground">· {level}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label="Confidence"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 75 ? "bg-success" : pct >= 45 ? "bg-primary" : "bg-warning",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** The "what should I do now" card — visually the most prominent result block. */
export function RecommendedActions({
  actions,
  title = "Recommended next steps",
  className,
}: {
  actions: string[];
  title?: string;
  className?: string;
}) {
  if (!actions.length) return null;
  const [first, ...rest] = actions;
  return (
    <Card className={cn("ring-1 ring-primary/25", className)}>
      <CardHeader>
        <CardDescription className="font-semibold text-primary">{title}</CardDescription>
        <CardTitle className="text-title-3 text-balance">{first}</CardTitle>
      </CardHeader>
      {rest.length > 0 && (
        <CardContent>
          <ol className="flex flex-col gap-2.5">
            {rest.map((a, i) => (
              <li key={i} className="flex gap-2.5">
                <ArrowRightIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{a}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      )}
    </Card>
  );
}

export function KeyPoints({
  points,
  title = "Key findings",
  className,
}: {
  points: string[];
  title?: string;
  className?: string;
}) {
  if (!points.length) return null;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {points.map((p, i) => (
            <li key={i} className="flex gap-3">
              <CheckCircle2Icon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span className="text-body">{p}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function TagList({
  title,
  items,
  className,
}: {
  title: string;
  items: { label: string; hint?: string }[];
  className?: string;
}) {
  if (!items.length) return null;
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <p className="text-footnote text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <Badge key={i} variant="secondary" title={it.hint}>
            {it.label}
            {it.hint && <span className="text-muted-foreground">· {it.hint}</span>}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** Label/value rows for small facts (model, duration, sentiment…). */
export function FactList({
  facts,
  className,
}: {
  facts: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-col divide-y", className)}>
      {facts.map((f) => (
        <div
          key={f.label}
          className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
        >
          <dt className="text-footnote text-muted-foreground">{f.label}</dt>
          <dd className="text-callout font-medium text-right">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
