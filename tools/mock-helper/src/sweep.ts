import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Bug } from "@valt/protocol";

type Planted = { expect: { testid: string | null }; sweep: boolean; bug: Bug };

/** The 10 planted demo-erp bugs (apps/demo-erp/fixtures/bugs.json). */
export const plantedBugs: Planted[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../apps/demo-erp/fixtures/bugs.json", import.meta.url)),
    "utf8",
  ),
) as Planted[];

export const sweepBugs = (): Bug[] => plantedBugs.filter((p) => p.sweep).map((p) => p.bug);

export const SWEEP_INTERVAL_MS = 800;
