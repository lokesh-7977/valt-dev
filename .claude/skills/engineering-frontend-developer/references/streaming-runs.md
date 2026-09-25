# Streaming AI Runs (SSE) in the Web App

Backend contract: ADR 0007 and `engineering-backend-architect/references/ai-patterns.md` §6.
`POST /api/py/<feature>/runs` with `{ thread_id, message }` or `{ thread_id, resume }` returns
`text/event-stream` with events `token | step | interrupt | done | error`.

`EventSource` only supports GET, so we read the stream with `fetch`.

## Shared event types

```ts
// packages/shared/src/index.ts — mirror of schemas.py
export interface RunRequest {
  thread_id: string;
  message?: string;
  resume?: string;
}

export type RunEvent =
  | { event: "token"; data: { text: string } }
  | { event: "step"; data: { node: string; status: "done" } }
  | { event: "interrupt"; data: { value: unknown } }
  | { event: "done"; data: { message: string } }
  | { event: "error"; data: { message: string } };
```

## SSE parser

```ts
// apps/web/src/lib/sse.ts
import type { RunEvent } from "@valt/shared";

export async function* readSse(res: Response): AsyncGenerator<RunEvent> {
  if (!res.body) throw new Error("response has no body");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value.replace(/\r\n/g, "\n");
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue; // keep-alive comment
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { event, data: JSON.parse(data.join("\n")) } as RunEvent;
    }
  }
}
```

## `useRun` hook

```ts
// apps/web/src/lib/use-run.ts
"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RunEvent, RunRequest } from "@valt/shared";
import { readSse } from "@/lib/sse";

type Status = "idle" | "streaming" | "interrupted" | "done" | "error";

interface RunState {
  status: Status;
  text: string;
  steps: string[];
  interrupt: unknown;
  error: string | null;
}

const initial: RunState = { status: "idle", text: "", steps: [], interrupt: null, error: null };

type Action = { type: "start" } | { type: "event"; e: RunEvent } | { type: "fail"; msg: string };

function reducer(s: RunState, a: Action): RunState {
  if (a.type === "start") return { ...initial, status: "streaming" };
  if (a.type === "fail") return { ...s, status: "error", error: a.msg };
  const { e } = a;
  switch (e.event) {
    case "token":
      return { ...s, text: s.text + e.data.text };
    case "step":
      return { ...s, steps: [...s.steps, e.data.node] };
    case "interrupt":
      return { ...s, status: "interrupted", interrupt: e.data.value };
    case "done":
      return { ...s, status: "done", text: e.data.message };
    case "error":
      return { ...s, status: "error", error: e.data.message };
  }
}

export function useRun(path: string, threadId: string, threadKey: readonly unknown[]) {
  const [state, dispatch] = useReducer(reducer, initial);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const run = useCallback(
    async (body: Omit<RunRequest, "thread_id">) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      dispatch({ type: "start" });
      try {
        const res = await fetch(`/api/py${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ ...body, thread_id: threadId }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`run failed: ${res.status}`);
        for await (const e of readSse(res)) {
          dispatch({ type: "event", e });
          if (e.event === "done") void queryClient.invalidateQueries({ queryKey: threadKey });
        }
      } catch {
        if (ctrl.signal.aborted) return; // user pressed Stop
        dispatch({ type: "fail", msg: "Connection lost. Try again." });
      }
    },
    [path, threadId, threadKey, queryClient],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  useEffect(() => stop, [stop]); // abort on unmount

  return {
    ...state,
    send: (message: string) => run({ message }),
    resume: (answer: string) => run({ resume: answer }),
    stop,
  };
}
```

This is deliberately **not** a `useMutation`: mutations have no incremental state and may retry.

## Chat UI wiring

```tsx
// apps/web/src/components/chat/chat-panel.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/lib/use-run";
import { threadKeys } from "@/lib/queries/threads";
import { ApprovalCard } from "./approval-card";

export function ChatPanel({ threadId }: { threadId: string }) {
  const r = useRun("/chat/runs", threadId, threadKeys.detail(threadId));
  const busy = r.status === "streaming";

  return (
    <Card>
      <CardContent className="space-y-3">
        <div aria-live="polite" className="whitespace-pre-wrap text-sm">
          {r.text || (busy && <span className="text-muted-foreground">Thinking…</span>)}
        </div>
        {r.status === "interrupted" && (
          <ApprovalCard value={r.interrupt} onDecide={(d) => r.resume(d)} />
        )}
        {r.status === "error" && (
          <p role="alert" className="text-sm text-destructive">{r.error}</p>
        )}
      </CardContent>
      <CardFooter>
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const input = new FormData(e.currentTarget).get("message");
            if (typeof input === "string" && input.trim()) void r.send(input);
            e.currentTarget.reset();
          }}
        >
          <Textarea name="message" aria-label="Message" className="min-h-10" disabled={busy} />
          {busy ? (
            <Button type="button" variant="outline" onClick={r.stop}>Stop</Button>
          ) : (
            <Button type="submit">Send</Button>
          )}
        </form>
      </CardFooter>
    </Card>
  );
}
```

```tsx
// apps/web/src/components/chat/approval-card.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function ApprovalCard({
  value,
  onDecide,
}: {
  value: unknown;
  onDecide: (decision: "approve" | "reject") => void;
}) {
  return (
    <Card className="border-amber-500/50">
      <CardHeader>
        <CardTitle>Approval needed</CardTitle>
        <CardDescription>The agent wants to continue with this action.</CardDescription>
      </CardHeader>
      <pre className="mx-6 overflow-x-auto rounded bg-muted p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
      <CardFooter className="gap-2">
        <Button onClick={() => onDecide("approve")}>Approve</Button>
        <Button variant="outline" onClick={() => onDecide("reject")}>Reject</Button>
      </CardFooter>
    </Card>
  );
}
```

## Rendering model output

- Plain text: `whitespace-pre-wrap` as above.
- Markdown: `react-markdown` (no raw HTML by default) — never enable `rehype-raw` on model output.
- Code blocks: syntax highlight client-side, lazily loaded with `next/dynamic`.
