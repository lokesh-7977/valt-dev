import type { FieldSemantic } from "@valt/shared";

/**
 * Deterministic field understanding: what does this field mean? Runs on every discovered field
 * in <1 ms so ALT can start testing immediately; Gemini refines it later (merge-plan.ts).
 */

export interface FieldSignals {
  label?: string | null;
  name?: string | null;
  id?: string | null;
  placeholder?: string | null;
  autocomplete?: string | null;
  type?: string | null;
  tag?: string | null;
  inputMode?: string | null;
  options?: Array<{ value: string; label: string }> | null;
  context?: string | null;
}

export interface FieldVerdict {
  semantic: FieldSemantic;
  unique: boolean;
  confidence: number;
}

const AUTOCOMPLETE: Record<string, FieldSemantic> = {
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  url: "url",
  "current-password": "password",
  "new-password": "password",
  name: "person_name",
  "given-name": "first_name",
  "family-name": "last_name",
  organization: "company",
  "street-address": "address",
  "address-line1": "address",
  "address-line2": "address",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "postal_code",
  country: "country",
  "country-name": "country",
  bday: "birth_date",
  username: "username",
  "one-time-code": "otp",
  "cc-number": "card_number",
};

const INPUT_TYPE: Record<string, FieldSemantic> = {
  email: "email",
  tel: "phone",
  url: "url",
  password: "password",
  date: "date",
  "datetime-local": "datetime",
  time: "time",
  month: "date",
  week: "date",
  search: "search",
  checkbox: "boolean",
  color: "color",
  file: "file",
};

// Ordered: first match wins. Patterns run over a normalised "label name id placeholder" string.
const KEYWORDS: Array<[RegExp, FieldSemantic]> = [
  [/\bgst ?in\b|\bgst (no|number)\b|\bgstin\b/, "gstin"],
  [/\bpan( card)?( no| number)?\b/, "pan"],
  [/\bifsc\b/, "ifsc"],
  [/\b(otp|one time (code|password)|verification code)\b/, "otp"],
  [/\b(card number|card no|credit card|debit card|cc number)\b/, "card_number"],
  [/\be ?mail\b/, "email"],
  [/\b(phone|mobile|tel|telephone|contact number|whatsapp)\b/, "phone"],
  [/\b(website|url|homepage|link)\b/, "url"],
  [/\b(password|passcode|pwd)\b/, "password"],
  [/\b(user ?name|login id|handle)\b/, "username"],
  [/\b(dob|date of birth|birth ?date|birthday)\b/, "birth_date"],
  [/\b(due|expiry|expiration|valid until|start|end|invoice|issue|order|delivery)? ?date\b/, "date"],
  [/\btime\b/, "time"],
  [/\b(discount|tax rate|gst rate|percentage|percent|rate %|%)/, "percentage"],
  [/\b(qty|quantity|units|no of items|count)\b/, "quantity"],
  [/\b(price|amount|total|cost|fee|salary|balance|subtotal|rate|mrp|₹|inr|usd|\$)/, "currency_amount"],
  [/\b(pin ?code|zip|postal|postcode|pin)\b/, "postal_code"],
  [/\b(invoice|order|receipt|bill|po|reference|ref|sku|serial|code|slug|identifier|id) ?(no|number|num|#|code)?\b/, "identifier"],
  [/\b(first ?name|given name|fname)\b/, "first_name"],
  [/\b(last ?name|surname|family name|lname)\b/, "last_name"],
  [/\b(company|organi[sz]ation|business|firm|employer|vendor|supplier)( name)?\b/, "company"],
  [/\b(full name|your name|contact name|name)\b/, "person_name"],
  [/\b(address|street|line 1|line 2|locality)\b/, "address"],
  [/\b(city|town)\b/, "city"],
  [/\b(state|province|region)\b/, "state"],
  [/\bcountry\b/, "country"],
  [/\b(search|find|filter|query)\b/, "search"],
  [/\b(description|notes?|comments?|message|remarks|details|about|bio|summary)\b/, "description"],
  [/\b(age|year|years|stock|inventory|number of|no of)\b/, "integer"],
];

/** camelCase / snake_case / kebab-case → spaced lowercase words. */
export function normaliseWords(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.[\]:()*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function classifyField(f: FieldSignals): FieldVerdict {
  const type = (f.type ?? "").toLowerCase();
  const tag = (f.tag ?? "").toLowerCase();
  const text = [f.label, f.name, f.id, f.placeholder].map(normaliseWords).filter(Boolean).join(" ");
  const context = normaliseWords(f.context);
  const signup = /\b(sign ?up|register|create account)\b/.test(context);
  const isUnique = (s: FieldSemantic): boolean =>
    s === "identifier" || s === "username" || (signup && s === "email");

  const ac = (f.autocomplete ?? "").toLowerCase().split(/\s+/).pop() ?? "";
  const byAc = AUTOCOMPLETE[ac];
  if (byAc) return { semantic: byAc, unique: isUnique(byAc), confidence: 0.95 };

  if (tag === "select" || (f.options && f.options.length > 0 && type !== "radio")) {
    if (/\b(country)\b/.test(text)) return { semantic: "country", unique: false, confidence: 0.8 };
    if (/\b(state|province)\b/.test(text)) return { semantic: "state", unique: false, confidence: 0.8 };
    return { semantic: "select_entity", unique: false, confidence: 0.8 };
  }

  const byType = INPUT_TYPE[type];
  if (byType && byType !== "date") return { semantic: byType, unique: isUnique(byType), confidence: 0.9 };

  for (const [re, semantic] of KEYWORDS) {
    if (!re.test(text)) continue;
    // Date words only count for date-capable inputs.
    if (semantic === "date" && type && type !== "date" && type !== "text") continue;
    if (type === "date" && semantic === "birth_date") return { semantic, unique: false, confidence: 0.9 };
    if (type === "date" && semantic !== "date") break;
    if (type === "number" && !["quantity", "currency_amount", "percentage", "integer"].includes(semantic)) {
      break;
    }
    return { semantic, unique: isUnique(semantic), confidence: 0.75 };
  }

  if (type === "date") return { semantic: "date", unique: false, confidence: 0.9 };
  if (type === "number" || type === "range") return { semantic: "number", unique: false, confidence: 0.6 };
  if (f.inputMode === "numeric" || f.inputMode === "decimal") return { semantic: "number", unique: false, confidence: 0.5 };
  if (tag === "textarea") return { semantic: "description", unique: false, confidence: 0.6 };
  if (type === "radio") return { semantic: "select_entity", unique: false, confidence: 0.5 };
  return { semantic: text ? "text" : "unknown", unique: false, confidence: 0.3 };
}
