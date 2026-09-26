export const PROTOCOL_VERSION = 1;
export const DEFAULT_WS_URL = "ws://127.0.0.1:7777/ws";
export const HELPER_HTTP_ORIGIN = "http://127.0.0.1:7777";
export const ASSETS_PATH = "/assets/";
export const REDACTED = "[redacted]";
export const BODY_LIMIT_CHARS = 65536;
export const AUTH_FAILED = "auth_failed";

/** In-band marker appended to a cut body (§2 has no `truncated` flag). */
export const truncatedMarker = (bytes: number): string => `…[truncated: ${bytes} bytes]`;

export const isTruncated = (value: unknown): boolean =>
  typeof value === "string" && /…\[truncated: \d+ bytes\]$/.test(value);
