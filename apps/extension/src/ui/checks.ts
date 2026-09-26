// Check titles from docs/plans/PHASE_2_UI_API_INTELLIGENCE_ENGINE.md (C1–C12).
export const CHECK_TITLES: Record<string, string> = {
  C1: "Missing field",
  C2: "Value changed in transit",
  C3: "Unexpected field",
  C4: "API status vs UI message mismatch",
  C5: "Silent failure",
  C6: "Response not reflected in UI",
  C7: "Stale UI",
  C8: "Client/server validation gap",
  C9: "Wrong endpoint or method",
  C10: "Error leakage",
  C11: "Slow or duplicate calls",
  C12: "Authentication/role gap",
};

/** "C2" → "C2 Value changed in transit"; unknown codes come back unchanged. */
export function checkLabel(code?: string): string {
  if (!code) return "";
  const title = CHECK_TITLES[code];
  return title ? `${code} ${title}` : code;
}
