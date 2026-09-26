// ALT MAIN-world script (T12). Runs in the page's own JS world at document_start.
//
// - Reports console.error, uncaught errors and unhandled rejections to the isolated-world content
//   script via window.postMessage({__alt: 1, kind, message, stack, ts}).
// - In ALT's worker tab only (sessionStorage.__alt_worker === "1"), neutralises alert/confirm/prompt
//   and beforeunload prompts so a dialog can never block the unattended test run, and reports each.
//
// No imports: this file is bundled standalone and must not leak module syntax into the page.

type AltMainKind = "console_error" | "unhandled_rejection" | "error" | "dialog";

(() => {
  const w = window as Window & { __altMain?: boolean };
  try {
    if (w.__altMain) return;
    w.__altMain = true;
  } catch {
    return;
  }

  const MAX_MESSAGE = 500;
  const MAX_STACK = 2000;
  let origin = "*";
  try {
    if (location.origin && location.origin !== "null") origin = location.origin;
  } catch {
    // keep "*": the target is this same window either way
  }

  function describe(value: unknown): string {
    try {
      if (value instanceof Error) return `${value.name}: ${value.message}`;
      if (typeof value === "string") return value;
      if (value === undefined) return "undefined";
      if (value === null) return "null";
      if (typeof value === "object") {
        const json = JSON.stringify(value);
        return json === undefined ? String(value) : json;
      }
      return String(value);
    } catch {
      return "[unserialisable value]";
    }
  }

  function post(kind: AltMainKind, message: string, stack: string | null | undefined): void {
    try {
      window.postMessage(
        {
          __alt: 1,
          kind,
          message: message.slice(0, MAX_MESSAGE),
          stack: stack ? String(stack).slice(0, MAX_STACK) : null,
          ts: Date.now(),
        },
        origin,
      );
    } catch {
      // never throw into the page
    }
  }

  // ---- console.error ----
  try {
    const original = console.error;
    const wrapped = function (this: unknown, ...args: unknown[]): void {
      try {
        const err = args.find((a): a is Error => a instanceof Error);
        post("console_error", args.map(describe).join(" "), err?.stack ?? null);
      } catch {
        // ignore
      }
      return original.apply(this === undefined ? console : this, args);
    };
    console.error = wrapped;
  } catch {
    // console may be frozen; skip capture
  }

  // ---- uncaught errors (script errors only; resource errors don't bubble to window) ----
  try {
    window.addEventListener("error", (event: Event) => {
      if (!(event instanceof ErrorEvent)) return;
      const err: unknown = event.error;
      const stack = err instanceof Error ? err.stack : null;
      const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
      post("error", `${event.message || describe(err)}${where}`, stack);
    });
    window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
      const reason: unknown = event.reason;
      post("unhandled_rejection", describe(reason), reason instanceof Error ? reason.stack : null);
    });
  } catch {
    // ignore
  }

  // ---- worker tab only: neutralise blocking dialogs ----
  let worker = false;
  try {
    worker = window.sessionStorage.getItem("__alt_worker") === "1";
  } catch {
    worker = false; // sandboxed frames throw on sessionStorage
  }
  if (!worker) return;

  try {
    window.alert = function (message?: unknown): void {
      post("dialog", `alert: ${describe(message ?? "")}`, null);
    };
    window.confirm = function (message?: string): boolean {
      post("dialog", `confirm: ${describe(message ?? "")} (ALT answered Cancel)`, null);
      return false;
    };
    window.prompt = function (message?: string): string | null {
      post("dialog", `prompt: ${describe(message ?? "")} (ALT answered Cancel)`, null);
      return null;
    };
    window.addEventListener(
      "beforeunload",
      (event: Event) => {
        event.stopImmediatePropagation();
      },
      true,
    );
  } catch {
    // ignore
  }
})();

// Module marker for TypeScript only; esbuild emits an IIFE with no import/export.
export {};
