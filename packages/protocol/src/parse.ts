import type { z } from "zod";
import type { Envelope, ExtensionToHelper, HelperToExtension } from "./index.js";
import {
  EXTENSION_TO_HELPER_TYPES,
  ExtensionToHelperSchema,
  HELPER_TO_EXTENSION_TYPES,
  HelperToExtensionSchema,
} from "./schemas.js";

export type ParseResult<T> =
  | { ok: true; msg: T }
  | { ok: false; reason: "json" | "unknown_type" | "invalid"; type?: string };

function parseWith<T>(raw: string, known: readonly string[], schema: z.ZodType): ParseResult<T> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "json" };
  }
  const type =
    typeof data === "object" && data !== null && "type" in data && typeof data.type === "string"
      ? data.type
      : undefined;
  if (type === undefined) return { ok: false, reason: "invalid" };
  if (!known.includes(type)) return { ok: false, reason: "unknown_type", type };
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, msg: result.data as T }
    : { ok: false, reason: "invalid", type };
}

/** Parse a frame received by the extension. Never throws. */
export const parseHelperMessage = (raw: string): ParseResult<Envelope<HelperToExtension>> =>
  parseWith(raw, HELPER_TO_EXTENSION_TYPES, HelperToExtensionSchema);

/** Parse a frame received by the helper. Never throws. */
export const parseExtensionMessage = (raw: string): ParseResult<Envelope<ExtensionToHelper>> =>
  parseWith(raw, EXTENSION_TO_HELPER_TYPES, ExtensionToHelperSchema);
