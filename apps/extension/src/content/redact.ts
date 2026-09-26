// Redaction runs in the isolated content script, before anything leaves the tab (PRD story 4).
import { BODY_LIMIT_CHARS, REDACTED, truncatedMarker, type CapturedSubmit } from "@valt/protocol";
import type { BodySnapshot } from "../shared/bridge";

type Field = CapturedSubmit["payload"]["form"]["fields"][number];

const SECRET_HEADERS = new Set(["authorization", "cookie", "x-api-key"]);
/** Body/field/query keys whose values never leave the tab. */
export const SECRET_KEY = /pass|token|secret|otp|cvv|card/i;

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

/** Recursively replace values under secret-looking keys. */
export function redactBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBody);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? REDACTED : redactBody(v);
    return out;
  }
  return value;
}

/** Redact secret query params in a URL; unparseable URLs are returned unchanged. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) {
        u.searchParams.set(key, REDACTED);
        changed = true;
      }
    }
    return changed ? u.href : url;
  } catch {
    return url;
  }
}

export function redactField(field: Field): Field {
  const secret = field.type === "password" || SECRET_KEY.test(field.name) || SECRET_KEY.test(field.label);
  return secret ? { ...field, value: REDACTED } : field;
}

const JSON_PAIR = /"([^"\\]*)"(\s*:\s*)("(?:[^"\\]|\\.)*"?|[^,}\]\s]+)/g;
const FORM_PAIR = /(^|[&?])([^=&?]+)=([^&]*)/g;

/** Regex redaction for raw text we can't parse (cut JSON prefixes, urlencoded strings). */
export function redactRaw(text: string): string {
  return text
    .replace(JSON_PAIR, (m, key: string, sep: string) => (SECRET_KEY.test(key) ? `"${key}"${sep}"${REDACTED}"` : m))
    .replace(FORM_PAIR, (m, pre: string, key: string) =>
      SECRET_KEY.test(decodeURIComponent(key)) ? `${pre}${key}=${encodeURIComponent(REDACTED)}` : m,
    );
}

/**
 * Turn a hook body snapshot into the §2 `reqBody`/`resBody` value: parsed and redacted JSON when
 * possible, otherwise redacted text. A cut body becomes a string ending with the protocol's
 * truncation marker (§2 has no flag field).
 */
export function toBody(snapshot: BodySnapshot | null): unknown {
  if (!snapshot) return null;
  if (snapshot.kind === "form") return redactBody(snapshot.fields);
  if (snapshot.cut) {
    return redactRaw(snapshot.text).slice(0, BODY_LIMIT_CHARS) + truncatedMarker(snapshot.bytes);
  }
  if (snapshot.text === "") return null;
  try {
    return redactBody(JSON.parse(snapshot.text));
  } catch {
    return redactRaw(snapshot.text);
  }
}
