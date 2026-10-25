// SPDX-License-Identifier: AGPL-3.0-or-later
// The order of work in a session and the number each set aims at (PRD
// "Session flow"). The runner on the phone walks these steps; the engine
// decides them, so pairs, sides and rests follow one rule everywhere.
import type { Catalogue } from "@vee/catalogue";
import type { PrescribedItem, Prescription, ProgressState } from "./types";

export type Step = {
  /** Index into `prescription.items`. */
  item: number;
  /** 1-based set number. */
  set: number;
  side?: "left" | "right";
  /** Rest after this step; 0 before a side switch and after the last step. */
  restS: number;
};

/**
 * The reps or seconds one tap logs: one past the best set at this step, inside
 * the target range, or the bottom of the range with no history (P3).
 */
export function aimFor(item: PrescribedItem, state: ProgressState | undefined): number {
  const { low, high } = item.target;
  if (state?.best === undefined) return low;
  return Math.min(high, Math.max(low, state.best + 1));
}

/** Every set in order: a pair alternates set by set; single-arm work does each side. */
export function sessionSteps(p: Prescription, catalogue: Pick<Catalogue, "exercises">): Step[] {
  const unilateral = (i: PrescribedItem) =>
    catalogue.exercises.find((e) => e.id === i.exerciseId)?.unilateral ?? false;
  const blocks: number[][] = [];
  p.items.forEach((it, n) => {
    const last = blocks.at(-1);
    const prev = last ? p.items[last[0] ?? -1] : undefined;
    if (last && it.pairGroup !== undefined && prev?.pairGroup === it.pairGroup) last.push(n);
    else blocks.push([n]);
  });
  const steps: Step[] = [];
  for (const block of blocks) {
    const rounds = Math.max(...block.map((n) => p.items[n]?.sets ?? 0));
    for (let set = 1; set <= rounds; set++) {
      for (const n of block) {
        const it = p.items[n];
        if (!it || set > it.sets) continue;
        if (unilateral(it)) {
          steps.push({ item: n, set, side: "left", restS: 0 });
          steps.push({ item: n, set, side: "right", restS: it.restS });
        } else steps.push({ item: n, set, restS: it.restS });
      }
    }
  }
  const last = steps.at(-1);
  if (last) last.restS = 0;
  return steps;
}
