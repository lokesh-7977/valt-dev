import type { Bug } from "@valt/protocol";

export type Severity = Bug["severity"];

/** Severity is never shown by colour alone: each level has a letter and a name (ADR 0015). */
export const SEVERITY: Record<Severity, { label: string; name: string; rank: number; cssVar: string }> = {
  critical: { label: "C", name: "Critical", rank: 0, cssVar: "--sev-critical" },
  high: { label: "H", name: "High", rank: 1, cssVar: "--sev-high" },
  medium: { label: "M", name: "Medium", rank: 2, cssVar: "--sev-medium" },
  low: { label: "L", name: "Low", rank: 3, cssVar: "--sev-low" },
};

export const bySeverity = (a: { severity: Severity }, b: { severity: Severity }) =>
  SEVERITY[a.severity].rank - SEVERITY[b.severity].rank;

export const highestSeverity = (bugs: Array<{ severity: Severity }>): Severity =>
  [...bugs].sort(bySeverity)[0]?.severity ?? "low";
