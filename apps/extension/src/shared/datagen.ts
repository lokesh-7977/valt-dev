import type {
  AltSettings,
  DiscoveredField,
  DiscoveredForm,
  Expectation,
  TestCase,
  TestCaseKind,
  TestCategory,
} from "@valt/shared";
import { fnv1a, stableId } from "./hash.ts";

/**
 * Autonomous test data. `happyValue` produces realistic valid data from what ALT understood about
 * a field; `planCases` turns a form into prioritised happy / negative / boundary / special /
 * interaction cases. Pure and deterministic — no model call on the hot path.
 */

export interface GenContext {
  /** Local date, yyyy-mm-dd. */
  today: string;
  /** Stable per form (and per session run) so unique values don't collide across runs. */
  seed: string;
  /** Distinguishes unique values between cases of the same form. */
  seq: number;
  locale?: "IN" | "generic";
}

type FieldLike = Pick<
  DiscoveredField,
  | "key"
  | "type"
  | "tag"
  | "label"
  | "name"
  | "semantic"
  | "unique"
  | "required"
  | "min"
  | "max"
  | "step"
  | "minLength"
  | "maxLength"
  | "pattern"
  | "options"
  | "placeholder"
>;

// ---------- small helpers ----------

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function num(s: string | null | undefined): number | null {
  if (s == null || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function decimals(step: string | null | undefined): number {
  if (!step || step === "any") return 0;
  const i = step.indexOf(".");
  return i < 0 ? 0 : step.length - i - 1;
}

function isIntegerField(f: FieldLike): boolean {
  const step = num(f.step);
  if (f.step === "any") return false;
  if (step !== null) return Number.isInteger(step);
  return f.semantic === "quantity" || f.semantic === "integer" || (f.type === "number" && f.semantic !== "currency_amount" && f.semantic !== "percentage");
}

function uniqueDigits(ctx: GenContext, n: number): string {
  const h = parseInt(fnv1a(`${ctx.seed}:${ctx.seq}`), 16);
  return String(h % 10 ** n).padStart(n, "0");
}

function matchesPattern(value: string, pattern: string | null | undefined): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(`^(?:${pattern})$`, "u").test(value);
  } catch {
    try {
      return new RegExp(`^(?:${pattern})$`).test(value);
    } catch {
      return true; // unparseable pattern: the browser ignores it too
    }
  }
}

/**
 * Tiny generator for common HTML `pattern`s: literals, \d \w \s, [classes], (?:groups) are not
 * supported; quantifiers {n} {n,m} ? + *. Returns null when the pattern is out of scope.
 */
export function sampleFromPattern(pattern: string, seed = 0): string | null {
  let out = "";
  let i = 0;
  let rnd = seed || 7;
  const pick = (chars: string): string => {
    rnd = (rnd * 1103515245 + 12345) % 2147483648;
    return chars[rnd % chars.length] ?? chars[0] ?? "";
  };
  const DIGIT = "0123456789";
  const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const LOWER = "abcdefghjkmnpqrstuvwxyz";
  while (i < pattern.length) {
    let chars: string;
    const c = pattern[i]!;
    if (c === "\\") {
      const e = pattern[i + 1];
      chars = e === "d" ? DIGIT : e === "w" ? LOWER : e === "s" ? " " : (e ?? "");
      i += 2;
    } else if (c === "[") {
      const end = pattern.indexOf("]", i);
      if (end < 0) return null;
      const body = pattern.slice(i + 1, end);
      if (body.startsWith("^")) return null;
      chars = "";
      for (let j = 0; j < body.length; j++) {
        const a = body[j]!;
        if (a === "\\") {
          const e = body[j + 1];
          chars += e === "d" ? DIGIT : e === "w" ? LOWER : (e ?? "");
          j++;
        } else if (body[j + 1] === "-" && body[j + 2]) {
          const from = a.charCodeAt(0);
          const to = body[j + 2]!.charCodeAt(0);
          const range: string[] = [];
          for (let k = from; k <= to; k++) {
            const ch = String.fromCharCode(k);
            if (!"IOio".includes(ch) || to - from < 10) range.push(ch);
          }
          chars += range.join("");
          j += 2;
        } else {
          chars += a;
        }
      }
      i = end + 1;
    } else if ("()|^$.".includes(c)) {
      return null;
    } else {
      chars = c;
      i += 1;
    }
    let count = 1;
    const q = pattern[i];
    if (q === "{") {
      const end = pattern.indexOf("}", i);
      const [a, b] = pattern.slice(i + 1, end).split(",");
      const lo = Number(a);
      const hi = b === undefined ? lo : b === "" ? lo + 2 : Number(b);
      count = Math.max(lo, Math.min(hi, lo || 1));
      i = end + 1;
    } else if (q === "+") {
      count = 2;
      i++;
    } else if (q === "*" || q === "?") {
      count = 1;
      i++;
    }
    if (!chars) return null;
    for (let k = 0; k < count; k++) out += chars === UPPER + LOWER ? pick(UPPER) : pick(chars);
  }
  return out;
}

function words(f: FieldLike): string {
  return `${f.label} ${f.name ?? ""} ${f.key}`.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function firstOption(f: FieldLike): string {
  const opts = f.options ?? [];
  const real = opts.find(
    (o) => o.value.trim() !== "" && !/^(select|choose|pick|--|please)/i.test(o.label.trim()),
  );
  return real?.value ?? opts[0]?.value ?? "";
}

function identifier(f: FieldLike, ctx: GenContext): string {
  const ph = f.placeholder ?? "";
  const m = ph.match(/^([A-Za-z]{1,6})([-_/]?)(\d{2,})$/);
  if (m) return `${m[1]}${m[2]}${uniqueDigits(ctx, Math.max(4, m[3]!.length))}`;
  const w = words(f);
  const prefix = /invoice/.test(w) ? "INV" : /order/.test(w) ? "ORD" : /sku|product/.test(w) ? "SKU" : "ALT";
  return `${prefix}-${uniqueDigits(ctx, 4)}`;
}

function numeric(f: FieldLike, preferred: number): string {
  const min = num(f.min);
  const max = num(f.max);
  let v = preferred;
  if (min !== null && v < min) v = min;
  if (max !== null && v > max) v = max;
  if (isIntegerField(f)) v = Math.round(v);
  const dp = decimals(f.step);
  return dp > 0 ? v.toFixed(dp) : String(v);
}

function dateFor(f: FieldLike, ctx: GenContext): string {
  const w = words(f);
  if (/\b(due|expir|end|until|deadline|valid|to date|checkout)/.test(w)) return addDays(ctx.today, 30);
  return ctx.today;
}

const PATTERN_CANDIDATES: Record<string, string[]> = {
  phone: ["9876543210", "+919876543210", "98765 43210", "+1 415 555 0100", "4155550100"],
  postal_code: ["560038", "94107", "SW1A 1AA"],
  gstin: ["29ABCDE1234F1Z5", "27AAPFU0939F1ZV"],
  pan: ["ABCDE1234F"],
  ifsc: ["HDFC0001234"],
};

function raw(f: FieldLike, ctx: GenContext): string {
  const inIndia = ctx.locale !== "generic";
  switch (f.semantic) {
    case "email":
      return f.unique ? `alt.qa+${uniqueDigits(ctx, 6)}@example.com` : "alt.qa@example.com";
    case "phone":
      return inIndia ? "9876543210" : "4155550100";
    case "url":
      return "https://example.com";
    case "password":
      return "Test@12345";
    case "person_name":
      return "Priya Sharma";
    case "first_name":
      return "Priya";
    case "last_name":
      return "Sharma";
    case "company":
      return "Acme Technologies Pvt Ltd";
    case "address":
      return "221B MG Road, Indiranagar";
    case "city":
      return inIndia ? "Bengaluru" : "Springfield";
    case "state":
      return f.options?.length ? firstOption(f) : inIndia ? "Karnataka" : "California";
    case "postal_code":
      return inIndia ? "560038" : "94107";
    case "country":
      return f.options?.length ? firstOption(f) : inIndia ? "India" : "United States";
    case "date":
      return dateFor(f, ctx);
    case "datetime":
      return `${dateFor(f, ctx)}T10:30`;
    case "time":
      return "10:30";
    case "birth_date":
      return "1990-05-17";
    case "quantity":
      return numeric(f, 5);
    case "integer":
      return numeric(f, 10);
    case "currency_amount":
      return numeric(f, 1250);
    case "percentage":
      return numeric(f, 10);
    case "number":
      return numeric(f, 42);
    case "gstin":
      return "29ABCDE1234F1Z5";
    case "pan":
      return "ABCDE1234F";
    case "ifsc":
      return "HDFC0001234";
    case "identifier":
      return identifier(f, ctx);
    case "username":
      return `alt_qa_${uniqueDigits(ctx, 5)}`;
    case "search":
      return "invoice";
    case "description":
      return "Created by ALT autonomous QA test.";
    case "otp":
      return "123456";
    case "card_number":
      return "4111111111111111";
    case "select_entity":
      return firstOption(f);
    case "boolean":
      return "true";
    case "color":
      return "#0071e3";
    case "file":
      return "";
    case "text":
      return f.options?.length ? firstOption(f) : "ALT test value";
    default:
      return f.options?.length ? firstOption(f) : "test";
  }
}

/** A realistic valid value for the field, honouring its constraints. */
export function happyValue(f: FieldLike, ctx: GenContext): string {
  if (f.type === "radio" || f.tag === "select") {
    if (f.options?.length) return firstOption(f);
  }
  if (f.type === "number" || f.type === "range") {
    if (!["quantity", "integer", "currency_amount", "percentage", "number"].includes(f.semantic)) {
      return numeric(f, 5);
    }
  }
  let v = raw(f, ctx);
  if (f.type === "checkbox") return "true";
  if (f.pattern && !matchesPattern(v, f.pattern)) {
    const candidates = PATTERN_CANDIDATES[f.semantic] ?? [];
    const hit = candidates.find((c) => matchesPattern(c, f.pattern));
    if (hit) v = hit;
    else {
      const gen = sampleFromPattern(f.pattern, parseInt(fnv1a(`${ctx.seed}:${ctx.seq}:${f.key}`), 16));
      if (gen && matchesPattern(gen, f.pattern)) v = gen;
    }
  }
  if (f.maxLength != null && f.maxLength >= 0 && v.length > f.maxLength) v = v.slice(0, f.maxLength);
  if (f.minLength != null && v.length < f.minLength && f.type !== "number") v = v.padEnd(f.minLength, "x");
  return v;
}

// ---------- case planning ----------

const TEXTUAL_TYPES = new Set(["text", "email", "tel", "url", "search", "password", "textarea", ""]);
const NUMERIC_SEMANTICS = new Set(["quantity", "integer", "currency_amount", "percentage", "number"]);
const FREE_TEXT = new Set(["person_name", "first_name", "last_name", "company", "description", "text", "address", "city"]);

const INVALID_FORMAT: Partial<Record<string, string>> = {
  email: "not-an-email",
  phone: "12ab-phone",
  url: "not a url",
  gstin: "22AAAAA0000A1Z",
  pan: "ABCDE12345",
  ifsc: "HDFC123",
  postal_code: "12AB",
};

const SPECIALS: Array<[TestCaseKind, string, Expectation]> = [
  ["unicode", "Zoë Łukasz 名前 Ñandú", "accept"],
  ["emoji", "ALT test 🚀✨ order", "accept"],
  ["rtl", "اختبار טקסט", "accept"],
  ["html_injection", '<script>alert("alt")</script><b>x</b>', "observe"],
  ["sql_injection", "' OR '1'='1'; --", "observe"],
];

const CATEGORY: Record<TestCaseKind, TestCategory> = {
  happy: "happy",
  required_empty: "required",
  whitespace: "required",
  max_length: "length",
  over_max_length: "length",
  very_long: "length",
  negative: "numeric",
  zero: "numeric",
  below_min: "numeric",
  at_min: "numeric",
  at_max: "numeric",
  above_max: "numeric",
  decimal_for_integer: "numeric",
  wrong_type: "format",
  invalid_format: "format",
  invalid_date: "format",
  unicode: "special",
  emoji: "special",
  rtl: "special",
  html_injection: "special",
  sql_injection: "special",
  duplicate: "business",
  context: "business",
  double_submit: "interaction",
  back_after_submit: "interaction",
  reload_after_fill: "interaction",
  keyboard_navigation: "interaction",
};

export const PRIORITY: Record<TestCaseKind, number> = {
  happy: 0,
  negative: 10,
  invalid_format: 20,
  required_empty: 30,
  below_min: 40,
  above_max: 40,
  over_max_length: 40,
  zero: 50,
  decimal_for_integer: 50,
  invalid_date: 55,
  context: 55,
  duplicate: 60,
  double_submit: 70,
  back_after_submit: 72,
  reload_after_fill: 74,
  keyboard_navigation: 76,
  wrong_type: 80,
  whitespace: 80,
  very_long: 82,
  at_min: 85,
  at_max: 85,
  max_length: 86,
  unicode: 90,
  emoji: 91,
  rtl: 92,
  html_injection: 93,
  sql_injection: 94,
};

/** Cases that never submit the form (safe even on destructive forms). */
export const NON_SUBMITTING: ReadonlySet<TestCaseKind> = new Set(["reload_after_fill", "keyboard_navigation"]);

export interface PlanContext {
  today: string;
  /** Changes per session so unique values (invoice numbers, emails) don't collide across runs. */
  runSeed: string;
  locale?: "IN" | "generic";
}

function fmt(n: number, f: FieldLike): string {
  const dp = decimals(f.step);
  return dp > 0 && !Number.isInteger(n) ? n.toFixed(dp) : String(n);
}

export function planCases(form: DiscoveredForm, settings: AltSettings, pctx: PlanContext): TestCase[] {
  const fields = form.fields.filter((f) => !f.readOnly && f.type !== "file");
  const seed = `${pctx.runSeed}:${form.id}`;
  let seq = 0;
  const baseCtx = (): GenContext => ({ today: pctx.today, seed, seq: seq++, locale: pctx.locale });

  const happyCtx = baseCtx();
  const happy: Record<string, string> = {};
  for (const f of fields) happy[f.key] = happyValue(f, happyCtx);

  /** Fresh unique values for every submitting case so they don't fail as accidental duplicates. */
  const freshValues = (): Record<string, string> => {
    const ctx = baseCtx();
    const values = { ...happy };
    for (const f of fields) if (f.unique) values[f.key] = happyValue(f, ctx);
    return values;
  };

  const out: TestCase[] = [];
  const seen = new Set<string>();
  const seenValues = new Set<string>();
  const soft = form.category === "search" || form.category === "filter" || form.isLogin;
  const add = (
    kind: TestCaseKind,
    field: FieldLike | null,
    overrides: Record<string, string>,
    expectation: Expectation,
    title: string,
    opts: { values?: Record<string, string>; fieldIndex?: number } = {},
  ): void => {
    const id = stableId(form.id, kind, field?.key ?? "");
    if (seen.has(id)) return;
    // The same single-field value twice (e.g. "0" as both below_min and zero) is one test.
    const valueKey = field && field.key in overrides ? `${field.key}=${overrides[field.key]}` : null;
    if (valueKey && seenValues.has(valueKey)) return;
    seen.add(id);
    if (valueKey) seenValues.add(valueKey);
    const values = { ...(opts.values ?? freshValues()), ...overrides };
    out.push({
      id,
      formId: form.id,
      routeKey: form.routeKey,
      kind,
      category: CATEGORY[kind],
      title,
      fieldKey: field?.key ?? null,
      values,
      expectation: soft && expectation === "reject" ? "observe" : expectation,
      source: "heuristic",
      priority: PRIORITY[kind] + (opts.fieldIndex ?? 0) / 100,
      rationale: null,
    });
  };

  const formLabel = form.purpose || form.name || "form";
  add("happy", null, {}, form.isLogin ? "observe" : "accept", `${formLabel}: valid data (happy path)`, {
    values: happy,
  });

  let specialFields = 0;
  fields.forEach((f, i) => {
    const L = f.label || f.key;
    const isText = TEXTUAL_TYPES.has(f.type) || f.tag === "textarea";
    const isNumeric = f.type === "number" || NUMERIC_SEMANTICS.has(f.semantic);
    const min = num(f.min);
    const max = num(f.max);
    const o = { fieldIndex: i };

    if (f.required) {
      add("required_empty", f, { [f.key]: "" }, "reject", `${L}: left empty (required)`, o);
      if (isText && f.tag !== "select") add("whitespace", f, { [f.key]: "   " }, "reject", `${L}: whitespace only`, o);
    }

    if (isText && f.tag !== "select" && !["email", "url", "date", "gstin", "pan", "ifsc"].includes(f.semantic)) {
      if (f.maxLength != null && f.maxLength > 0 && f.maxLength < 10_000) {
        add("max_length", f, { [f.key]: "A".repeat(f.maxLength) }, "accept", `${L}: exactly ${f.maxLength} chars (max)`, o);
        add("over_max_length", f, { [f.key]: "A".repeat(f.maxLength + 1) }, "reject", `${L}: ${f.maxLength + 1} chars (over max)`, o);
      } else if (FREE_TEXT.has(f.semantic) || f.semantic === "identifier") {
        add("very_long", f, { [f.key]: "Lorem ipsum ".repeat(420).slice(0, 5000) }, "observe", `${L}: 5,000 characters`, o);
      }
    }

    if (isNumeric && f.tag !== "select") {
      const mustBePositive =
        (min !== null && min >= 0) || ["quantity", "currency_amount", "percentage", "integer"].includes(f.semantic);
      if (mustBePositive && (min === null || min >= 0)) {
        const neg = f.semantic === "currency_amount" ? "-100" : "-5";
        add("negative", f, { [f.key]: neg }, "reject", `${L} = ${neg} (negative)`, o);
      }
      if (min === null || min > 0 || min === 0) {
        const zeroExp: Expectation = min !== null ? (0 < min ? "reject" : "accept") : f.semantic === "quantity" ? "reject" : "observe";
        if (!(min === 0 && max === null && f.semantic !== "quantity")) add("zero", f, { [f.key]: "0" }, zeroExp, `${L} = 0`, o);
      }
      const step = num(f.step) ?? 1;
      if (min !== null) {
        add("below_min", f, { [f.key]: fmt(min - step, f) }, "reject", `${L} = ${fmt(min - step, f)} (below min ${f.min})`, o);
        add("at_min", f, { [f.key]: fmt(min, f) }, "accept", `${L} = ${fmt(min, f)} (min)`, o);
      }
      if (max !== null) {
        add("at_max", f, { [f.key]: fmt(max, f) }, "accept", `${L} = ${fmt(max, f)} (max)`, o);
        add("above_max", f, { [f.key]: fmt(max + step, f) }, "reject", `${L} = ${fmt(max + step, f)} (above max ${f.max})`, o);
      } else if (f.semantic === "percentage") {
        add("above_max", f, { [f.key]: "150" }, "reject", `${L} = 150 (over 100%)`, o);
      }
      if (isIntegerField(f)) add("decimal_for_integer", f, { [f.key]: "2.5" }, "reject", `${L} = 2.5 (decimal for integer)`, o);
      if (f.type !== "number" && f.type !== "range") add("wrong_type", f, { [f.key]: "abc" }, "reject", `${L} = "abc" (not a number)`, o);
    }

    const bad = INVALID_FORMAT[f.semantic];
    if (bad !== undefined && f.tag !== "select") add("invalid_format", f, { [f.key]: bad }, "reject", `${L} = "${bad}" (invalid format)`, o);

    if ((f.semantic === "date" || f.semantic === "birth_date") && f.type !== "date" && isText) {
      add("invalid_date", f, { [f.key]: "2026-02-31" }, "reject", `${L} = 2026-02-31 (impossible date)`, o);
    }
    if (f.semantic === "birth_date") {
      add("invalid_date", f, { [f.key]: addDays(pctx.today, 365) }, "reject", `${L} in the future`, o);
    }

    if (f.unique) {
      // Re-submits the happy path's value; must run after the happy case (priority 60 > 0).
      add("duplicate", f, {}, "reject", `${L}: duplicate of an existing value`, { values: happy, fieldIndex: i });
    }

    if (FREE_TEXT.has(f.semantic) && f.tag !== "select" && specialFields < 2) {
      specialFields++;
      for (const [kind, value, exp] of SPECIALS) {
        const v = f.maxLength != null ? value.slice(0, f.maxLength) : value;
        add(kind, f, { [f.key]: v }, exp, `${L}: ${kind.replace("_", " ")} input`, o);
      }
    }
  });

  // Cross-field date relation: an end/due date before the start/invoice date.
  const dates = fields.filter((f) => f.semantic === "date");
  const endDate = dates.find((f) => /\b(due|end|until|expir|to)\b/.test(words(f)));
  const startDate = dates.find((f) => f !== endDate);
  if (endDate && startDate) {
    add(
      "invalid_date",
      endDate,
      { [startDate.key]: pctx.today, [endDate.key]: addDays(pctx.today, -5) },
      "reject",
      `${endDate.label || endDate.key} before ${startDate.label || startDate.key}`,
    );
  }

  if (!form.isLogin && form.category !== "search" && form.category !== "filter") {
    add("double_submit", null, {}, "observe", `${formLabel}: double-click submit`);
    add("back_after_submit", null, {}, "observe", `${formLabel}: browser Back after submit`);
  }
  add("reload_after_fill", null, {}, "observe", `${formLabel}: reload after filling`);
  add("keyboard_navigation", null, {}, "observe", `${formLabel}: keyboard (Tab) order`);

  let cases = out;
  if (form.destructive && !settings.allowDestructive) cases = cases.filter((c) => NON_SUBMITTING.has(c.kind));
  cases.sort((a, b) => a.priority - b.priority);
  return cases.slice(0, Math.max(1, settings.maxCasesPerForm));
}
