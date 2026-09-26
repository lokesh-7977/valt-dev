import "./jitless.js";
import { z } from "zod";
import type {
  Activity,
  Bug,
  BugAction,
  BugFound,
  BugUpdated,
  CapturedRequest,
  CapturedSubmit,
  ContractRes,
  ContractRow,
  Envelope,
  ErrorMsg,
  FixPrompt,
  Hello,
  RunStats,
  RunSweep,
  SetMode,
  SetRole,
  Welcome,
} from "./index.js";

const bugStatus = z.enum(["open", "ignored", "expected", "fixed"]);
const mode = z.enum(["live", "paused"]);

const envelope = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ type: z.literal(type), id: z.string(), ts: z.number(), payload });

// ---------- Shared shapes ----------
export const CapturedRequestSchema = z.object({
  reqId: z.string(),
  method: z.string(),
  url: z.string(),
  status: z.number(),
  reqHeaders: z.record(z.string(), z.string()),
  reqBody: z.unknown(),
  resBody: z.unknown(),
  durationMs: z.number(),
  initiator: z.enum(["fetch", "xhr"]),
});

export const BugSchema = z.object({
  bugId: z.string(),
  fingerprint: z.string(),
  title: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  layer: z.enum(["ui", "api", "ui_api", "rule", "health"]),
  checkCode: z.string().optional(),
  pageUrl: z.string(),
  route: z.string(),
  anchor: z.object({ selector: z.string(), fallbackText: z.string().optional() }),
  steps: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  evidence: z.object({
    screenshotUrl: z.string().optional(),
    request: z.unknown().optional(),
    response: z.unknown().optional(),
    highlightKeys: z.array(z.string()).optional(),
  }),
  likelyCause: z
    .object({ file: z.string(), line: z.number().optional(), reason: z.string() })
    .optional(),
  env: z.enum(["localhost", "dev"]),
  status: bugStatus,
  ticketUrl: z.string().optional(),
});

export const ContractRowSchema = z.object({
  field: z.string(),
  uiValue: z.string(),
  requestValue: z.string(),
  responseValue: z.string(),
  ok: z.boolean(),
  code: z.string().optional(),
});

export const CapturedSubmitPayloadSchema = z.object({
  submitId: z.string(),
  pageUrl: z.string(),
  route: z.string(),
  form: z.object({
    selector: z.string(),
    fields: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.string(),
        value: z.string(),
        selector: z.string(),
      }),
    ),
  }),
  requests: z.array(CapturedRequestSchema),
  uiAfter: z.object({
    toasts: z.array(z.string()),
    fieldErrors: z.array(z.object({ selector: z.string(), text: z.string() })),
    url: z.string(),
  }),
});

// ---------- Extension → Helper ----------
export const HelloSchema = envelope(
  "hello",
  z.object({ token: z.string(), extVersion: z.string(), v: z.literal(1) }),
);
export const SetModeSchema = envelope("set_mode", z.object({ mode }));
export const RunSweepSchema = envelope(
  "run_sweep",
  z.object({ target: z.enum(["localhost", "dev"]), role: z.string().optional() }),
);
export const SetRoleSchema = envelope("set_role", z.object({ role: z.string() }));
export const BugActionSchema = envelope(
  "bug_action",
  z.object({
    bugId: z.string(),
    action: z.enum(["ignore", "expected", "file_ticket", "copy_fix_prompt", "reopen"]),
  }),
);
export const CapturedSubmitSchema = envelope("captured_submit", CapturedSubmitPayloadSchema);

// ---------- Helper → Extension ----------
export const WelcomeSchema = envelope(
  "welcome",
  z.object({
    helperVersion: z.string(),
    project: z.string(),
    roles: z.array(z.string()),
    mode,
    v: z.literal(1),
  }),
);
export const ActivitySchema = envelope(
  "activity",
  z.object({
    agent: z.string(),
    message: z.string(),
    progress: z.object({ done: z.number(), total: z.number() }).optional(),
  }),
);
export const BugFoundSchema = envelope("bug_found", BugSchema);
export const BugUpdatedSchema = envelope(
  "bug_updated",
  z.object({ bugId: z.string(), status: bugStatus, ticketUrl: z.string().optional() }),
);
export const ContractResSchema = envelope(
  "contract_result",
  z.object({
    submitId: z.string(),
    route: z.string(),
    rows: z.array(ContractRowSchema),
    bugIds: z.array(z.string()),
  }),
);
export const RunStatsSchema = envelope(
  "run_stats",
  z.object({
    checks: z.number(),
    agents: z.number(),
    durationMs: z.number(),
    trigger: z.enum(["save", "sweep", "deploy", "manual_submit"]),
  }),
);
export const FixPromptSchema = envelope(
  "fix_prompt",
  z.object({ bugId: z.string(), text: z.string() }),
);
export const ErrorMsgSchema = envelope(
  "error",
  z.object({ code: z.string(), message: z.string() }),
);

export const ExtensionToHelperSchema = z.discriminatedUnion("type", [
  HelloSchema,
  SetModeSchema,
  RunSweepSchema,
  SetRoleSchema,
  BugActionSchema,
  CapturedSubmitSchema,
]);

export const HelperToExtensionSchema = z.discriminatedUnion("type", [
  WelcomeSchema,
  ActivitySchema,
  BugFoundSchema,
  BugUpdatedSchema,
  ContractResSchema,
  RunStatsSchema,
  FixPromptSchema,
  ErrorMsgSchema,
]);

export const EXTENSION_TO_HELPER_TYPES: readonly string[] = ExtensionToHelperSchema.options.map(
  (s) => s.shape.type.value,
);
export const HELPER_TO_EXTENSION_TYPES: readonly string[] = HelperToExtensionSchema.options.map(
  (s) => s.shape.type.value,
);

// ---------- Drift assertions: tsc fails if a schema diverges from the verbatim §2 types ----------
type Simplify<T> = { [K in keyof T]: T[K] } & {};
type Equal<A, B> =
  (<X>() => X extends Simplify<A> ? 1 : 2) extends <X>() => X extends Simplify<B> ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

export type ProtocolDriftCheck = [
  Assert<Equal<z.infer<typeof HelloSchema>, Envelope<Hello>>>,
  Assert<Equal<z.infer<typeof SetModeSchema>, Envelope<SetMode>>>,
  Assert<Equal<z.infer<typeof RunSweepSchema>, Envelope<RunSweep>>>,
  Assert<Equal<z.infer<typeof SetRoleSchema>, Envelope<SetRole>>>,
  Assert<Equal<z.infer<typeof BugActionSchema>, Envelope<BugAction>>>,
  Assert<Equal<z.infer<typeof CapturedSubmitSchema>, Envelope<CapturedSubmit>>>,
  Assert<Equal<z.infer<typeof CapturedRequestSchema>, CapturedRequest>>,
  Assert<Equal<z.infer<typeof WelcomeSchema>, Envelope<Welcome>>>,
  Assert<Equal<z.infer<typeof ActivitySchema>, Envelope<Activity>>>,
  Assert<Equal<z.infer<typeof BugFoundSchema>, Envelope<BugFound>>>,
  Assert<Equal<z.infer<typeof BugSchema>, Bug>>,
  Assert<Equal<z.infer<typeof BugUpdatedSchema>, Envelope<BugUpdated>>>,
  Assert<Equal<z.infer<typeof ContractResSchema>, Envelope<ContractRes>>>,
  Assert<Equal<z.infer<typeof ContractRowSchema>, ContractRow>>,
  Assert<Equal<z.infer<typeof RunStatsSchema>, Envelope<RunStats>>>,
  Assert<Equal<z.infer<typeof FixPromptSchema>, Envelope<FixPrompt>>>,
  Assert<Equal<z.infer<typeof ErrorMsgSchema>, Envelope<ErrorMsg>>>,
];
