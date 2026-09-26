/**
 * ALT Phase 1 contract — what the Autonomous Website Explorer observes and emits.
 *
 * Producers: apps/extension (Phase 1). Consumers: Phase 2 (UI ↔ API intelligence) and Phase 3
 * (verification + developer experience). Types only — no runtime values — so the extension can
 * `import type` it under Node's type stripping.
 *
 * Rules: changes are additive; breaking changes bump `SessionExport.contractVersion`.
 * `FieldSemantic`, `FormCategory`, `AltFormDescriptor` and `AltFormPlan` mirror
 * apps/api/src/valt_api/prompts/alt_explorer.py by hand — change both together.
 */

// ---- Gemini form plan (task `alt_form_plan`, POST /api/v1/process) ----

export type FieldSemantic =
  | "email"
  | "phone"
  | "url"
  | "password"
  | "person_name"
  | "first_name"
  | "last_name"
  | "company"
  | "address"
  | "city"
  | "state"
  | "postal_code"
  | "country"
  | "date"
  | "datetime"
  | "time"
  | "birth_date"
  | "quantity"
  | "integer"
  | "currency_amount"
  | "percentage"
  | "number"
  | "gstin"
  | "pan"
  | "ifsc"
  | "identifier"
  | "username"
  | "search"
  | "description"
  | "text"
  | "otp"
  | "card_number"
  | "select_entity"
  | "boolean"
  | "color"
  | "file"
  | "unknown";

export type FormCategory =
  | "create"
  | "edit"
  | "search"
  | "filter"
  | "login"
  | "signup"
  | "settings"
  | "payment"
  | "contact"
  | "invite"
  | "other";

export interface AltDescriptorField {
  key: string;
  label: string;
  name: string | null;
  type: string;
  required: boolean;
  min: string | null;
  max: string | null;
  step: string | null;
  maxlength: number | null;
  pattern: string | null;
  options: string[] | null;
  placeholder: string | null;
  context: string | null;
}

/** Input sent as `text` (JSON) to `alt_form_plan`. */
export interface AltFormDescriptor {
  page: { url: string; title: string; headings: string[]; nav: string[] };
  form: { id: string; submit_label: string | null; fields: AltDescriptorField[] };
}

export interface AltFieldValue {
  key: string;
  value: string;
}

export interface AltFormPlan {
  purpose: string;
  category: FormCategory;
  destructive: boolean;
  fields: Array<{ key: string; semantic: FieldSemantic; happy_value: string; unique: boolean }>;
  context_cases: Array<{
    title: string;
    rationale: string;
    expect: "accept" | "reject";
    field_key: string | null;
    overrides: AltFieldValue[];
  }>;
}

// ---- Discovery ----

/** Normalised logical route, e.g. `/invoices/:id`. */
export type RouteKey = string;

export type DiscoverySource = "start" | "link" | "action" | "developer";

export interface DiscoveredLink {
  href: string;
  text: string;
  routeKey: RouteKey | null;
  crawlable: boolean;
  inNav: boolean;
  destructive: boolean;
}

export interface DiscoveredTable {
  selector: string;
  caption: string | null;
  headers: string[];
  rowCount: number;
}

export type ActionKind = "navigate" | "open_modal" | "submit" | "button";

export interface DiscoveredAction {
  id: string;
  routeKey: RouteKey;
  selector: string;
  label: string;
  kind: ActionKind;
  destructive: boolean;
  destructiveReason: string | null;
  /** Filled in once ALT has safely clicked it. */
  effect?: { type: "navigated"; toRouteKey: RouteKey } | { type: "revealed_form"; formId: string } | { type: "none" };
}

export interface ReachStep {
  kind: "click";
  selector: string;
  label: string;
}

export type LabelSource =
  | "label-for"
  | "label-wrap"
  | "aria-labelledby"
  | "aria-label"
  | "placeholder"
  | "title"
  | "text"
  | "name"
  | "none";

export interface FieldOption {
  value: string;
  label: string;
}

export interface DiscoveredField {
  key: string;
  selector: string;
  tag: "input" | "select" | "textarea";
  type: string;
  name: string | null;
  label: string;
  labelSource: LabelSource;
  placeholder: string | null;
  autocomplete: string | null;
  inputMode: string | null;
  required: boolean;
  readOnly: boolean;
  min: string | null;
  max: string | null;
  step: string | null;
  minLength: number | null;
  maxLength: number | null;
  pattern: string | null;
  options: FieldOption[] | null;
  context: string | null;
  semantic: FieldSemantic;
  semanticSource: "heuristic" | "gemini";
  unique: boolean;
}

export interface DiscoveredForm {
  /** Stable signature: hash(routeKey, sorted field keys, submit label). */
  id: string;
  routeKey: RouteKey;
  pageUrl: string;
  selector: string;
  name: string;
  fields: DiscoveredField[];
  submit: { selector: string; label: string } | null;
  method: string | null;
  action: string | null;
  novalidate: boolean;
  inModal: boolean;
  /** Steps that reveal the form from a fresh page load (e.g. click "New customer"). */
  reach: ReachStep[];
  category: FormCategory;
  purpose: string;
  isLogin: boolean;
  destructive: boolean;
  destructiveReason: string | null;
  enrichment: "heuristic" | "gemini";
}

export interface DiscoveredPage {
  url: string;
  routeKey: RouteKey;
  title: string;
  headings: string[];
  nav: string[];
  links: DiscoveredLink[];
  tables: DiscoveredTable[];
  lists: number;
  modals: number;
  formIds: string[];
  actionIds: string[];
  isLogin: boolean;
  depth: number;
  source: DiscoverySource;
  discoveredAt: number;
  loadMs: number | null;
}

// ---- Tests ----

export type TestCaseKind =
  | "happy"
  | "required_empty"
  | "whitespace"
  | "max_length"
  | "over_max_length"
  | "very_long"
  | "negative"
  | "zero"
  | "below_min"
  | "at_min"
  | "at_max"
  | "above_max"
  | "decimal_for_integer"
  | "wrong_type"
  | "invalid_format"
  | "invalid_date"
  | "unicode"
  | "emoji"
  | "rtl"
  | "html_injection"
  | "sql_injection"
  | "duplicate"
  | "context"
  | "double_submit"
  | "back_after_submit"
  | "reload_after_fill"
  | "keyboard_navigation";

export type TestCategory =
  | "happy"
  | "required"
  | "length"
  | "numeric"
  | "format"
  | "special"
  | "business"
  | "interaction";

export type Expectation = "accept" | "reject" | "observe";

export interface TestCase {
  id: string;
  formId: string;
  routeKey: RouteKey;
  kind: TestCaseKind;
  category: TestCategory;
  title: string;
  /** Field under test; null for whole-form cases. */
  fieldKey: string | null;
  /** Complete values to fill (happy path + this case's mutation), keyed by field key. */
  values: Record<string, string>;
  expectation: Expectation;
  source: "heuristic" | "gemini";
  priority: number;
  rationale: string | null;
}

export interface InteractionEvent {
  ts: number;
  type: "navigate" | "reach" | "fill" | "click" | "submit" | "back" | "reload" | "observe" | "keyboard";
  selector?: string;
  fieldKey?: string;
  /** Requested value (fill). */
  value?: string;
  /** Value the page actually holds after filling (differs when the browser sanitises). */
  applied?: string;
  ok: boolean;
  detail?: string;
}

export interface NavigationEvent {
  ts: number;
  source: "worker" | "developer";
  tabId: number;
  url: string;
  routeKey: RouteKey;
  kind: "load" | "spa";
}

export interface NetworkEvent {
  requestId: string;
  tabId: number;
  ts: number;
  url: string;
  method: string;
  /** chrome.webRequest resource type: main_frame, xmlhttprequest, image, ... */
  type: string;
  /** 0 when the request failed without a response. */
  status: number;
  durationMs: number;
  error: string | null;
  fromCache: boolean;
  /** Reserved for Phase 2 evidence capture — Phase 1 never fills these. */
  requestBody?: string;
  responseBody?: string;
}

export interface ConsoleEvent {
  ts: number;
  tabId: number;
  kind: "console_error" | "unhandled_rejection" | "error" | "dialog";
  message: string;
  stack: string | null;
  url: string;
}

export interface FieldMessage {
  fieldKey: string | null;
  message: string;
  source: "native" | "aria-invalid" | "text";
}

export interface PageMessage {
  text: string;
  tone: "success" | "error" | "neutral";
}

export interface ExecutionEvidence {
  urlBefore: string;
  urlAfter: string;
  clientInvalid: boolean;
  validationMessages: FieldMessage[];
  messages: PageMessage[];
  formReset: boolean;
  network: NetworkEvent[];
  /** Mutating (non-GET) requests within the case window — the subset Phase 2 compares. */
  mutatingRequests: NetworkEvent[];
  consoleErrors: ConsoleEvent[];
  /** Field values after the case (for reload/back checks). */
  fieldValuesAfter: Record<string, string> | null;
  notes: string[];
}

export type TestOutcome =
  | "accepted"
  | "navigated"
  | "rejected_client"
  | "rejected_server"
  | "server_error"
  | "no_response"
  | "blocked_unsafe";

/**
 * `unexpected` = what ALT observed differs from what the case expected. It is an observation
 * for Phase 2 to analyse and Phase 3 to verify — NOT a confirmed bug.
 */
export type TestStatus = "pass" | "unexpected" | "inconclusive" | "skipped" | "error";

export interface TestResult {
  status: TestStatus;
  reason: string;
}

export interface TestExecution {
  id: string;
  caseId: string;
  formId: string;
  routeKey: RouteKey;
  kind: TestCaseKind;
  title: string;
  fieldKey: string | null;
  values: Record<string, string>;
  expectation: Expectation;
  startedAt: number;
  finishedAt: number;
  steps: InteractionEvent[];
  evidence: ExecutionEvidence;
  outcome: TestOutcome;
  result: TestResult;
}

// ---- Page health ----

export type HealthKind =
  | "console_error"
  | "unhandled_rejection"
  | "failed_request"
  | "broken_link"
  | "broken_image"
  | "slow_page"
  | "slow_request"
  | "horizontal_overflow"
  | "overlapping_elements"
  | "cut_off_text"
  | "missing_label"
  | "unclear_button"
  | "missing_alt"
  | "missing_lang"
  | "missing_title"
  | "duplicate_id"
  | "keyboard_order";

export interface PageHealthObservation {
  /** Dedup key: hash(kind, routeKey, selector|url|message). */
  id: string;
  kind: HealthKind;
  severity: "high" | "medium" | "low";
  routeKey: RouteKey;
  url: string;
  message: string;
  selector: string | null;
  evidence: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  count: number;
}

// ---- Session ----

export interface AltSettings {
  enabledOrigins: string[];
  /** Default false: ALT never deletes, pays, sends or logs out unless the developer opts in. */
  allowDestructive: boolean;
  maxDepth: number;
  maxPages: number;
  maxCasesPerForm: number;
  maxActionsPerPage: number;
  slowPageMs: number;
  slowRequestMs: number;
  apiBaseUrl: string;
  useGemini: boolean;
  paceMs: number;
}

export type SessionStatus = "idle" | "live" | "paused" | "watching" | "stopped";

export interface ActivityEntry {
  id: string;
  ts: number;
  level: "info" | "success" | "working" | "warn";
  text: string;
  ref?: { type: "page" | "form" | "case" | "health"; id: string };
}

export interface SessionStats {
  pages: number;
  forms: number;
  fields: number;
  actions: number;
  casesPlanned: number;
  casesRun: number;
  passed: number;
  unexpected: number;
  inconclusive: number;
  skipped: number;
  health: number;
  requests: number;
}

export interface NowState {
  phase: "discovering" | "exploring" | "planning" | "testing" | "watching" | "idle";
  label: string;
  formId: string | null;
  caseIndex: number | null;
  caseTotal: number | null;
  detail: string | null;
}

export interface AiStatus {
  state: "online" | "offline" | "disabled" | "unknown";
  lastLatencyMs: number | null;
  lastErrorCode: string | null;
  calls: number;
}

export interface SessionSnapshot {
  sessionId: string;
  origin: string | null;
  status: SessionStatus;
  startedAt: number | null;
  workerTabId: number | null;
  now: NowState;
  stats: SessionStats;
  ai: AiStatus;
  pages: DiscoveredPage[];
  forms: DiscoveredForm[];
  actions: DiscoveredAction[];
  cases: TestCase[];
  executions: TestExecution[];
  health: PageHealthObservation[];
  activity: ActivityEntry[];
}

// ---- Events (the Phase 1 → Phase 2/3 stream) ----

export interface AltEventPayloads {
  "session.started": { origin: string; settings: AltSettings };
  "session.status": { status: SessionStatus };
  "session.stopped": { reason: string };
  "page.discovered": { page: DiscoveredPage };
  navigation: { navigation: NavigationEvent };
  "form.discovered": { form: DiscoveredForm };
  "form.enriched": { form: DiscoveredForm; plan: AltFormPlan };
  "action.discovered": { action: DiscoveredAction };
  "cases.planned": { formId: string; cases: TestCase[] };
  "test.started": { testCase: TestCase; index: number; total: number };
  /** The primary Phase 2 input: one complete, self-describing test run with its evidence. */
  "test.executed": { execution: TestExecution };
  "health.observed": { observation: PageHealthObservation };
  activity: { entry: ActivityEntry };
}

export type AltEventType = keyof AltEventPayloads;

export type AltEventOf<T extends AltEventType> = {
  id: string;
  ts: number;
  sessionId: string;
  type: T;
  payload: AltEventPayloads[T];
};

export type AltEvent = { [K in AltEventType]: AltEventOf<K> }[AltEventType];

/** File produced by "Export session" in the side panel. */
export interface SessionExport {
  contractVersion: 1;
  exportedAt: number;
  settings: AltSettings;
  snapshot: SessionSnapshot;
  events: AltEvent[];
}
