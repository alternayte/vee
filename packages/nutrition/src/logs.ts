// SPDX-License-Identifier: AGPL-3.0-or-later
import { zeroPortions } from "./portions";
import { MOMENTS, type Moment, PORTIONS, type Portions } from "./types";

export function sumPortions(logs: Portions[]): Portions {
  const out = zeroPortions();
  for (const l of logs) for (const p of PORTIONS) out[p] += l[p];
  return out;
}

/** Reads `food_targets.per_moment`. Anything that is not a full, numeric table is rejected. */
export function parseTargets(raw: string): Record<Moment, Portions> | undefined {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof v !== "object" || v === null) return undefined;
  const table = v as Record<string, unknown>;
  for (const m of MOMENTS) {
    const row = table[m];
    if (typeof row !== "object" || row === null) return undefined;
    for (const p of PORTIONS) {
      const n = (row as Record<string, unknown>)[p];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return undefined;
    }
  }
  return table as Record<Moment, Portions>;
}
