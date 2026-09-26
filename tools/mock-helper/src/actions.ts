import type { Bug, Envelope, ExtensionToHelper } from "@valt/protocol";
import { extraRoutes } from "./control.js";
import { buildContract } from "./contract.js";
import type { MockHelper } from "./server.js";
import type { Behavior, Session } from "./session.js";
import { SWEEP_INTERVAL_MS, sweepBugs } from "./sweep.js";

const TICKET_BASE = "https://linear.app/alt/issue/ALT-";

/** Per-process mock state, kept on helper.state so /__mock/reset clears it. */
function store(helper: MockHelper) {
  const get = <T>(key: string, init: () => T): T => {
    if (!helper.state.has(key)) helper.state.set(key, init());
    return helper.state.get(key) as T;
  };
  return {
    submits: get("submits", () => new Set<string>()),
    expected: get("expected", () => new Set<string>()),
    bugs: get("bugs", () => new Map<string, Bug>()),
    ticket: get("ticket", () => ({ next: 12 })),
  };
}

function emitBug(helper: MockHelper, session: Session, bug: Bug): void {
  store(helper).bugs.set(bug.bugId, bug);
  session.send({ type: "bug_found", payload: bug });
}

function onSubmit(helper: MockHelper, session: Session, msg: Envelope<ExtensionToHelper>): void {
  if (msg.type !== "captured_submit") return;
  const s = store(helper);
  const submit = msg.payload;
  if (s.submits.has(submit.submitId)) return;
  s.submits.add(submit.submitId);
  const { rows, bug } = buildContract(submit);
  const report = bug && !s.expected.has(bug.fingerprint) ? bug : null;
  if (report) emitBug(helper, session, report);
  session.send({
    type: "contract_result",
    payload: {
      submitId: submit.submitId,
      route: submit.route,
      rows,
      bugIds: report ? [report.bugId] : [],
    },
  });
  session.sendStats("manual_submit");
}

function onSweep(helper: MockHelper, session: Session, msg: Envelope<ExtensionToHelper>): void {
  if (msg.type !== "run_sweep") return;
  const role = msg.payload.role ?? "admin";
  session.sendActivity(`Full sweep of ${msg.payload.target} as ${role}`);
  session.sendActivity("Crawling routes");
  const bugs = sweepBugs().filter((b) => !store(helper).expected.has(b.fingerprint));
  bugs.forEach((bug, i) => {
    setTimeout(() => {
      session.sendActivity(`Found: ${bug.title}`);
      emitBug(helper, session, { ...bug, status: "open" });
      if (i === bugs.length - 1) session.sendStats("sweep");
    }, (i + 1) * SWEEP_INTERVAL_MS);
  });
  if (bugs.length === 0) session.sendStats("sweep");
}

function onAction(helper: MockHelper, session: Session, msg: Envelope<ExtensionToHelper>): void {
  if (msg.type !== "bug_action" || session.cfg.mute_actions) return;
  const s = store(helper);
  const { bugId, action } = msg.payload;
  const bug = s.bugs.get(bugId);
  switch (action) {
    case "ignore":
      session.send({ type: "bug_updated", payload: { bugId, status: "ignored" } });
      return;
    case "expected":
      if (bug) s.expected.add(bug.fingerprint);
      session.send({ type: "bug_updated", payload: { bugId, status: "expected" } });
      return;
    case "reopen":
      if (bug) s.expected.delete(bug.fingerprint);
      session.send({ type: "bug_updated", payload: { bugId, status: "open" } });
      return;
    case "file_ticket": {
      const ticketUrl = `${TICKET_BASE}${s.ticket.next++}`;
      setTimeout(
        () => session.send({ type: "bug_updated", payload: { bugId, status: "open", ticketUrl } }),
        600,
      );
      return;
    }
    case "copy_fix_prompt": {
      const where = bug?.likelyCause
        ? `${bug.likelyCause.file}${bug.likelyCause.line ? `:${bug.likelyCause.line}` : ""}`
        : "the code that builds this request";
      const text = [
        `Fix "${bug?.title ?? bugId}" in ${where}.`,
        bug ? `Expected: ${bug.expected}` : "",
        bug ? `Actual: ${bug.actual}` : "",
        bug?.likelyCause ? `Likely cause: ${bug.likelyCause.reason}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      session.send({ type: "fix_prompt", payload: { bugId, text } });
      return;
    }
  }
}

/** The mock's scripted behaviour for authenticated messages. */
export function mockBehavior(helper: MockHelper): Behavior {
  extraRoutes.set("/__mock/emit", (h, body) => {
    const bugs = Array.isArray(body.bugs) ? (body.bugs as Bug[]) : [];
    for (const session of h.sessions) bugs.forEach((b) => emitBug(h, session, b));
    return { emitted: bugs.length };
  });
  extraRoutes.set("/__mock/garbage", (h, body) => {
    const n = typeof body.n === "number" ? body.n : 1;
    for (const session of h.sessions) {
      for (let i = 0; i < n; i++) {
        session.sendRaw(`{not json ${i}`);
        session.sendRaw(JSON.stringify({ type: "ping", id: `g-${i}`, ts: Date.now(), payload: {} }));
      }
    }
    return { sent: n * 2 };
  });
  return (session, msg) => {
    onSubmit(helper, session, msg);
    onSweep(helper, session, msg);
    onAction(helper, session, msg);
  };
}
