import type {
  ConsoleEvent,
  FieldMessage,
  NetworkEvent,
  PageMessage,
  TestCase,
  TestOutcome,
  TestResult,
} from "@valt/shared";

/**
 * Deterministic verdicts: what did the app do with ALT's input, and was that what the case
 * expected? `unexpected` is an observation for Phase 2/3 — never a confirmed bug.
 */

export interface OutcomeEvidence {
  blockedUnsafe?: boolean;
  clientInvalid: boolean;
  validationMessages: FieldMessage[];
  messages: PageMessage[];
  urlBefore: string;
  urlAfter: string;
  formReset: boolean;
  mutatingRequests: Array<Pick<NetworkEvent, "method" | "url" | "status">>;
  consoleErrors: ConsoleEvent[];
}

const ok = (s: number) => s >= 200 && s < 400;

export function classifyOutcome(e: OutcomeEvidence): TestOutcome {
  if (e.blockedUnsafe) return "blocked_unsafe";
  const statuses = e.mutatingRequests.map((r) => r.status);
  if (statuses.some((s) => s >= 500)) return "server_error";
  const sent = e.mutatingRequests.length > 0;
  const errorMsg = e.messages.some((m) => m.tone === "error");
  const successMsg = e.messages.some((m) => m.tone === "success");
  const fieldErrors = e.validationMessages.length > 0;
  if (e.clientInvalid && !sent) return "rejected_client";
  if (!sent && fieldErrors) return "rejected_client";
  if (statuses.some((s) => s >= 400 && s < 500)) return "rejected_server";
  if (sent && statuses.every((s) => s === 0)) return errorMsg ? "rejected_server" : "no_response";
  if (errorMsg && !successMsg) return sent ? "rejected_server" : "rejected_client";
  const navigated = stripHash(e.urlBefore) !== stripHash(e.urlAfter);
  if (sent && statuses.some(ok)) return navigated && !successMsg ? "navigated" : "accepted";
  if (successMsg || (e.formReset && !fieldErrors)) return "accepted";
  if (navigated) return "navigated";
  return "no_response";
}

function stripHash(u: string): string {
  const i = u.indexOf("#");
  return i < 0 ? u : u.slice(0, i);
}

const REJECTED: ReadonlySet<TestOutcome> = new Set(["rejected_client", "rejected_server"]);
const ACCEPTED: ReadonlySet<TestOutcome> = new Set(["accepted", "navigated"]);

export function judge(
  tc: Pick<TestCase, "expectation" | "kind" | "title">,
  outcome: TestOutcome,
  e: Pick<OutcomeEvidence, "consoleErrors"> = { consoleErrors: [] },
): TestResult {
  if (outcome === "blocked_unsafe") {
    return { status: "skipped", reason: "Not executed: destructive action and allowDestructive is off" };
  }
  if (outcome === "server_error") {
    return { status: "unexpected", reason: "Server error (5xx) instead of a handled response" };
  }
  if (outcome === "no_response" && tc.expectation !== "observe") {
    return { status: "inconclusive", reason: "No request, message or navigation observed after submit" };
  }
  switch (tc.expectation) {
    case "reject":
      if (REJECTED.has(outcome)) {
        return { status: "pass", reason: outcome === "rejected_client" ? "Rejected in the browser" : "Rejected by the server" };
      }
      return { status: "unexpected", reason: "Invalid input was accepted" };
    case "accept":
      if (ACCEPTED.has(outcome)) return { status: "pass", reason: "Valid input was accepted" };
      return {
        status: "unexpected",
        reason: outcome === "rejected_client" ? "Valid input was blocked in the browser" : "Valid input was rejected by the server",
      };
    default:
      if (e.consoleErrors.length > 0) {
        return { status: "unexpected", reason: `${e.consoleErrors.length} console error(s) during the test` };
      }
      return { status: "pass", reason: `Observed: ${outcome.replace("_", " ")}` };
  }
}
