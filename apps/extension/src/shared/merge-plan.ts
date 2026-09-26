import type {
  AltFormDescriptor,
  AltFormPlan,
  AltSettings,
  DiscoveredField,
  DiscoveredForm,
  DiscoveredPage,
  FieldSemantic,
  TestCase,
} from "@valt/shared";
import { NON_SUBMITTING, PRIORITY } from "./datagen.ts";
import { stableId } from "./hash.ts";

/**
 * Gemini is advisory. Its plan may improve semantics, happy values and add context cases, but it
 * can never clear a destructive flag, add navigation/clicks, or inject values that break the
 * field's own constraints. Everything it sends is treated as untrusted.
 */

const cut = (s: string | null | undefined, n: number): string | null => (s == null ? null : s.slice(0, n));

const DESCRIPTOR_BUDGET = 16_000;

/** Compact, untrusted-data descriptor of a form. Shrinks detail until it fits ~16 KB. */
export function buildDescriptor(
  page: Pick<DiscoveredPage, "url" | "title" | "headings" | "nav">,
  form: DiscoveredForm,
): AltFormDescriptor {
  const levels = [
    { label: 120, context: 200, options: 50 },
    { label: 80, context: 80, options: 20 },
    { label: 60, context: 0, options: 10 },
    { label: 40, context: 0, options: 5 },
    { label: 30, context: 0, options: 0 },
  ];
  let out: AltFormDescriptor | null = null;
  for (const lv of levels) {
    out = {
      page: {
        url: page.url.slice(0, 300),
        title: page.title.slice(0, 120),
        headings: page.headings.slice(0, 10).map((h) => h.slice(0, 120)),
        nav: page.nav.slice(0, 20).map((n) => n.slice(0, 60)),
      },
      form: {
        id: form.id,
        submit_label: cut(form.submit?.label, 80),
        fields: form.fields.slice(0, 60).map((f) => ({
          key: f.key,
          label: f.label.slice(0, lv.label),
          name: cut(f.name, 80),
          type: f.type,
          required: f.required,
          min: f.min,
          max: f.max,
          step: f.step,
          maxlength: f.maxLength,
          pattern: cut(f.pattern, 200),
          options: f.options && lv.options > 0
            ? f.options.slice(0, lv.options).map((o) => (o.value === o.label ? o.value : `${o.value}=${o.label}`).slice(0, 60))
            : null,
          placeholder: cut(f.placeholder, 80),
          context: lv.context > 0 ? cut(f.context, lv.context) : null,
        })),
      },
    };
    if (JSON.stringify(out).length < DESCRIPTOR_BUDGET) break;
  }
  return out!;
}

const SEMANTICS: ReadonlySet<string> = new Set<FieldSemantic>([
  "email", "phone", "url", "password", "person_name", "first_name", "last_name", "company", "address",
  "city", "state", "postal_code", "country", "date", "datetime", "time", "birth_date", "quantity",
  "integer", "currency_amount", "percentage", "number", "gstin", "pan", "ifsc", "identifier",
  "username", "search", "description", "text", "otp", "card_number", "select_entity", "boolean",
  "color", "file", "unknown",
]);

/** Runtime shape check — the API response is untrusted JSON. */
export function isFormPlan(x: unknown): x is AltFormPlan {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    Array.isArray(p.fields) &&
    p.fields.every((f) => typeof f === "object" && f !== null && typeof (f as { key?: unknown }).key === "string") &&
    (p.context_cases === undefined || Array.isArray(p.context_cases))
  );
}

/** Would the browser/app consider this a structurally valid value for the field? */
export function satisfiesConstraints(f: DiscoveredField, v: string): boolean {
  if (f.options && f.options.length > 0) return f.options.some((o) => o.value === v);
  if (f.maxLength != null && v.length > f.maxLength) return false;
  if (f.minLength != null && v.length < f.minLength) return false;
  if (f.type === "number" || f.type === "range") {
    const n = Number(v);
    if (v.trim() === "" || !Number.isFinite(n)) return false;
    if (f.min != null && f.min !== "" && n < Number(f.min)) return false;
    if (f.max != null && f.max !== "" && n > Number(f.max)) return false;
  }
  if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return false;
  if (f.pattern) {
    try {
      if (!new RegExp(`^(?:${f.pattern})$`, "u").test(v)) return false;
    } catch {
      // unparseable pattern: browser ignores it too
    }
  }
  return true;
}

export interface MergeResult {
  form: DiscoveredForm;
  cases: TestCase[];
  /** Happy values the model supplied and ALT accepted, by field key. */
  acceptedValues: Record<string, string>;
}

export function mergePlan(
  form: DiscoveredForm,
  cases: TestCase[],
  plan: AltFormPlan,
  settings: Pick<AltSettings, "allowDestructive" | "maxCasesPerForm">,
  executed: ReadonlySet<string> = new Set(),
): MergeResult {
  const byKey = new Map(form.fields.map((f) => [f.key, f]));
  const acceptedValues: Record<string, string> = {};
  const fields = form.fields.map((f) => ({ ...f }));
  for (const pf of plan.fields ?? []) {
    const f = fields.find((x) => x.key === pf.key);
    if (!f) continue;
    if (typeof pf.semantic === "string" && SEMANTICS.has(pf.semantic)) {
      f.semantic = pf.semantic;
      f.semanticSource = "gemini";
    }
    if (typeof pf.unique === "boolean") f.unique = f.unique || pf.unique;
    if (typeof pf.happy_value === "string" && pf.happy_value !== "" && satisfiesConstraints(f, pf.happy_value)) {
      acceptedValues[f.key] = pf.happy_value;
    }
  }

  const destructive = form.destructive || plan.destructive === true;
  const merged: DiscoveredForm = {
    ...form,
    fields,
    purpose: typeof plan.purpose === "string" && plan.purpose.trim() ? plan.purpose.trim().slice(0, 80) : form.purpose,
    category: typeof plan.category === "string" ? plan.category : form.category,
    destructive,
    destructiveReason: form.destructiveReason ?? (plan.destructive ? "Gemini: submitting looks irreversible" : null),
    enrichment: "gemini",
  };

  // Better happy data flows into the happy path of cases that haven't run. Unique fields keep
  // ALT's per-case values so cases don't collide as duplicates.
  const uniqueKeys = new Set(fields.filter((f) => f.unique).map((f) => f.key));
  let next = cases.map((c) => {
    if (executed.has(c.id)) return c;
    const values = { ...c.values };
    for (const [k, v] of Object.entries(acceptedValues)) {
      if (k === c.fieldKey || uniqueKeys.has(k)) continue;
      // Leave context-case overrides alone.
      if (c.kind === "context") continue;
      values[k] = v;
    }
    return { ...c, values, title: c.kind === "happy" ? `${merged.purpose}: valid data (happy path)` : c.title };
  });

  const happy = next.find((c) => c.kind === "happy");
  for (const cc of (plan.context_cases ?? []).slice(0, 5)) {
    if (!cc || typeof cc.title !== "string") continue;
    const overrides: Record<string, string> = {};
    for (const o of cc.overrides ?? []) {
      if (o && typeof o.key === "string" && typeof o.value === "string" && byKey.has(o.key)) overrides[o.key] = o.value.slice(0, 5000);
    }
    if (Object.keys(overrides).length === 0) continue;
    const fieldKey = cc.field_key && byKey.has(cc.field_key) ? cc.field_key : null;
    const id = stableId(form.id, "context", cc.title);
    if (next.some((c) => c.id === id)) continue;
    next.push({
      id,
      formId: form.id,
      routeKey: form.routeKey,
      kind: "context",
      category: "business",
      title: cc.title.slice(0, 120),
      fieldKey,
      values: { ...(happy?.values ?? {}), ...overrides },
      expectation: cc.expect === "accept" ? "accept" : "reject",
      source: "gemini",
      priority: PRIORITY.context,
      rationale: typeof cc.rationale === "string" ? cc.rationale.slice(0, 300) : null,
    });
  }

  if (destructive && !settings.allowDestructive) next = next.filter((c) => NON_SUBMITTING.has(c.kind));
  next.sort((a, b) => a.priority - b.priority);
  // Keep every already-executed case; cap the rest.
  const done = next.filter((c) => executed.has(c.id));
  const pending = next.filter((c) => !executed.has(c.id)).slice(0, Math.max(0, settings.maxCasesPerForm - done.length));
  return { form: merged, cases: [...done, ...pending].sort((a, b) => a.priority - b.priority), acceptedValues };
}
