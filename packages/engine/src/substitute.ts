// SPDX-License-Identifier: AGPL-3.0-or-later
// Substitution (SDD "Substitution"): ranked swaps that respect kit and flags (I6).
import type { Exercise } from "@vee/catalogue";
import { checkAllowed } from "./kit";
import { reason } from "./reasons";
import type { EngineInput, Reason } from "./types";

export type Candidate = { exerciseId: string; score: number; reason: Reason };

function primary(e: Exercise): string | undefined {
  return Object.entries(e.muscles).find(([, w]) => w === 1)?.[0];
}

/** 1 when the muscle weights match, 0 when they share nothing. */
function similarity(a: Exercise, b: Exercise): number {
  const keys = new Set([...Object.keys(a.muscles), ...Object.keys(b.muscles)]);
  let diff = 0;
  let sum = 0;
  for (const k of keys) {
    const x = a.muscles[k as keyof Exercise["muscles"]] ?? 0;
    const y = b.muscles[k as keyof Exercise["muscles"]] ?? 0;
    diff += Math.abs(x - y);
    sum += x + y;
  }
  return sum === 0 ? 0 : 1 - diff / sum;
}

export function substitute(input: EngineInput, exerciseId: string): Candidate[] {
  const e = input.catalogue.exercises.find((x) => x.id === exerciseId);
  if (!e) throw new Error(`exercise not in catalogue: ${exerciseId}`);
  const out: Candidate[] = [];
  for (const c of input.catalogue.exercises) {
    if (c.id === e.id || c.pattern === "mobility") continue;
    if (!checkAllowed(c, input.kit, input.flags, input.today).ok) continue;
    let tier = 0;
    let ruleId = "";
    if (c.family === e.family && c.rung === e.rung) [tier, ruleId] = [3, "SWAP_SAME_RUNG"];
    else if (c.family === e.family && Math.abs(c.rung - e.rung) === 1) [tier, ruleId] = [2, "SWAP_NEAR_RUNG"];
    else if (c.pattern === e.pattern && primary(c) === primary(e)) [tier, ruleId] = [1, "SWAP_PATTERN"];
    if (tier === 0) continue;
    const sim = similarity(e, c);
    out.push({
      exerciseId: c.id,
      score: Math.round((tier + sim) * 1000) / 1000,
      reason: reason(ruleId, {
        exercise: c.names.en.toLowerCase(),
        rung: c.rung,
        match: Math.round(sim * 100),
      }),
    });
  }
  return out.sort((a, b) => b.score - a.score || a.exerciseId.localeCompare(b.exerciseId));
}
