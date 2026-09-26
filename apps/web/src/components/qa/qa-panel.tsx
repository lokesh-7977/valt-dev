"use client";

import type { QARunStatus } from "@valt/shared";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toUserError } from "@/lib/errors";
import { useQaStream } from "@/lib/qa/use-qa-stream";

const SCENARIOS = [
  { id: "signup_empty_password", label: "Signup: empty password" },
  { id: "signup_happy_path", label: "Signup: happy path" },
];

const STATUS: Record<
  QARunStatus,
  { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }
> = {
  running: { label: "Running", variant: "default" },
  passed: { label: "Passed", variant: "success" },
  bug_found: { label: "Bug found", variant: "destructive" },
  inconclusive: { label: "Inconclusive", variant: "warning" },
  stopped: { label: "Stopped", variant: "secondary" },
  needs_confirmation: { label: "Needs confirmation", variant: "warning" },
  blocked: { label: "Blocked", variant: "warning" },
  error: { label: "Error", variant: "destructive" },
};

/** Live QA agent: the browser feed, what the agent is doing and why, and its verdict. */
export function QAPanel() {
  const { state, start, stop, save } = useQaStream();
  const [scenario, setScenario] = useState("signup_empty_password");
  const running = state.run?.status === "running";
  const mutationError = start.error ?? stop.error ?? save.error;
  const status = state.run ? STATUS[state.run.status] : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Scenario"
            className="h-11 rounded-xl border bg-background px-3 text-callout"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <Button onClick={() => start.mutate(scenario)} disabled={start.isPending}>
            Run QA
          </Button>
          <Button variant="outline" onClick={() => save.mutate(scenario)} disabled={save.isPending}>
            Simulate save
          </Button>
          <Button
            variant="destructive"
            onClick={() => stop.mutate()}
            disabled={!running || stop.isPending}
          >
            Stop agent
          </Button>
          <span className="ml-auto flex items-center gap-2 text-footnote text-muted-foreground">
            {status && <Badge variant={status.variant}>{status.label}</Badge>}
            {state.connection !== "open" && <span>{state.connection}…</span>}
          </span>
        </div>

        {mutationError && (
          <Alert variant="destructive">
            <AlertTitle>{toUserError(mutationError).title}</AlertTitle>
            <AlertDescription>{toUserError(mutationError).description}</AlertDescription>
          </Alert>
        )}

        <div className="overflow-hidden rounded-xl border bg-muted">
          {state.url && (
            <div className="truncate border-b bg-background px-3 py-2 text-footnote text-muted-foreground">
              {state.url}
            </div>
          )}
          {state.screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element -- live base64 frames
            <img
              src={`data:image/png;base64,${state.screenshot}`}
              alt="Live view of the agent's browser"
              className="block aspect-[16/10] w-full object-contain"
            />
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center text-callout text-muted-foreground">
              Save your code or press Run QA to start the agent.
            </div>
          )}
        </div>

        {state.interrupt && (
          <Alert variant="warning">
            <AlertTitle>The agent stopped to ask for confirmation</AlertTitle>
            <AlertDescription>{state.interrupt.explanation}</AlertDescription>
          </Alert>
        )}
        {state.error && (
          <Alert variant="destructive">
            <AlertTitle>{state.error.code}</AlertTitle>
            <AlertDescription>{state.error.message}</AlertDescription>
          </Alert>
        )}

        {state.report && (
          <Card>
            <CardHeader>
              <CardTitle>
                {state.report.verdict === "bug"
                  ? "Bug found"
                  : state.report.verdict === "pass"
                    ? "Works as expected"
                    : "No verdict"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-callout">
              <p>{state.report.summary}</p>
              {state.report.findings.length > 0 && (
                <ul className="list-disc pl-5 text-muted-foreground">
                  {state.report.findings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
              <p className="text-footnote text-muted-foreground">
                {state.report.steps} steps · {(state.report.duration_ms / 1000).toFixed(1)} s
                {state.report.usage?.total_tokens
                  ? ` · ${state.report.usage.total_tokens.toLocaleString()} tokens`
                  : ""}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="max-h-[720px] overflow-hidden">
        <CardHeader>
          <CardTitle>Step log</CardTitle>
        </CardHeader>
        <CardContent className="overflow-y-auto">
          {state.steps.length === 0 ? (
            <p className="text-callout text-muted-foreground">No steps yet.</p>
          ) : (
            <ol className="flex flex-col gap-3" aria-live="polite">
              {state.steps.map((s) => (
                <li key={`${s.run_id}-${s.index}`} className="flex gap-3 text-callout">
                  <span className="w-5 shrink-0 text-right text-muted-foreground">{s.index}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {s.kind === "run_started" ? "Opened app" : s.action}
                      </span>
                      {s.kind === "blocked" && <Badge variant="warning">blocked</Badge>}
                    </div>
                    {(s.intent ?? s.note) && (
                      <p className="text-muted-foreground">{s.intent ?? s.note}</p>
                    )}
                    {s.kind === "blocked" && s.intent && s.note && (
                      <p className="text-footnote text-warning">{s.note}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
