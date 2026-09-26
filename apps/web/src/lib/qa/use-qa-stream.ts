"use client";

import type {
  ApiErrorBody,
  QADoneEvent,
  QAInterruptEvent,
  QARunInfo,
  QAStepEvent,
  QAStreamEvent,
} from "@valt/shared";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";

import { qaEvents, startQaRun, stopQaRun, triggerQaSave } from "@/lib/api";
import { isAbortError } from "@/lib/errors";

const MAX_STEPS = 50;
const RECONNECT_MS = 2000;

export type QAConnection = "connecting" | "open" | "reconnecting";

/** One step in the log; screenshots live only in `screenshot` (latest) to bound memory. */
export type QALogStep = Omit<QAStepEvent, "screenshot_png_b64">;

export interface QAStreamState {
  connection: QAConnection;
  run: QARunInfo | null;
  steps: QALogStep[];
  screenshot: string | null;
  url: string | null;
  interrupt: QAInterruptEvent | null;
  report: QADoneEvent | null;
  error: ApiErrorBody["error"] | null;
}

const initial: QAStreamState = {
  connection: "connecting",
  run: null,
  steps: [],
  screenshot: null,
  url: null,
  interrupt: null,
  report: null,
  error: null,
};

type Action = { type: "connection"; value: QAConnection } | { type: "event"; ev: QAStreamEvent };

function reducer(state: QAStreamState, action: Action): QAStreamState {
  return action.type === "connection"
    ? { ...state, connection: action.value }
    : onEvent(state, action.ev);
}

function onEvent(state: QAStreamState, ev: QAStreamEvent): QAStreamState {
  switch (ev.event) {
    case "step": {
      const { screenshot_png_b64, ...step } = ev.data;
      // A new run resets the panel.
      const base =
        step.kind === "run_started"
          ? { ...state, run: step.run, steps: [], interrupt: null, report: null, error: null }
          : state;
      if (base.run && base.run.run_id !== step.run_id) return state; // stale event
      return {
        ...base,
        steps: [...base.steps, step].slice(-MAX_STEPS),
        screenshot: screenshot_png_b64 ?? base.screenshot,
        url: step.url ?? base.url,
      };
    }
    case "interrupt":
      return { ...state, interrupt: ev.data };
    case "done":
      if (state.run && state.run.run_id !== ev.data.run.run_id) return state;
      return { ...state, run: ev.data.run, report: ev.data };
    case "error":
      return { ...state, error: ev.data };
  }
}

/**
 * Subscribe once to GET /qa/events (every run, manual or save-triggered) and fold the events
 * into panel state. Reconnects after 2 s on error; aborts on unmount (safe under StrictMode).
 */
export function useQaStream() {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      try {
        const events = qaEvents(controller.signal);
        dispatch({ type: "connection", value: "open" });
        for await (const ev of events) dispatch({ type: "event", ev });
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return;
      }
      if (controller.signal.aborted) return;
      dispatch({ type: "connection", value: "reconnecting" });
      timer = setTimeout(connect, RECONNECT_MS);
    }

    void connect();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const start = useMutation({ mutationFn: (scenarioId: string) => startQaRun({ scenario_id: scenarioId }) });
  const stop = useMutation({ mutationFn: () => stopQaRun() });
  const save = useMutation({
    mutationFn: (scenarioId: string) => triggerQaSave({ path: "manual", scenario_id: scenarioId }),
  });

  return { state, start, stop, save };
}
