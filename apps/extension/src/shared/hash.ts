/** 32-bit FNV-1a over UTF-16 code units, as 8 hex chars. Stable across runs and contexts. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic id from parts (joined with NUL so ["a","bc"] != ["ab","c"]). */
export function stableId(...parts: Array<string | number | null | undefined>): string {
  return fnv1a(parts.map((p) => (p == null ? "" : String(p))).join("\u0000"));
}
