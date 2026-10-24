// SPDX-License-Identifier: AGPL-3.0-or-later
// Weekly hard sets per muscle group.
import type { Catalogue, Exercise } from "@vee/catalogue";
import { MUSCLE_GROUPS, type MuscleGroup } from "./goals";
import type { SessionTemplate } from "./types";

/** A set counts toward a group only when the group's muscle weight is at least this. */
export const HARD_SET_WEIGHT = 0.5;

type Cat = Pick<Catalogue, "exercises">;

export function exerciseById(catalogue: Cat, id: string): Exercise {
  const e = catalogue.exercises.find((x) => x.id === id);
  if (!e) throw new Error(`exercise not in catalogue: ${id}`);
  return e;
}

/** How much one set of the exercise counts toward the group: the top muscle weight, or 0. */
export function contribution(e: Exercise, group: MuscleGroup): number {
  if (e.pattern === "mobility") return 0;
  const w = Math.max(0, ...MUSCLE_GROUPS[group].map((m) => e.muscles[m] ?? 0));
  return w >= HARD_SET_WEIGHT ? w : 0;
}

const groups = () => Object.keys(MUSCLE_GROUPS) as MuscleGroup[];

export function weeklyVolume(templates: SessionTemplate[], catalogue: Cat): Record<MuscleGroup, number> {
  const out = Object.fromEntries(groups().map((g) => [g, 0])) as Record<MuscleGroup, number>;
  for (const i of templates.flatMap((t) => t.items)) {
    const e = exerciseById(catalogue, i.exerciseId);
    for (const g of groups()) out[g] += i.sets * contribution(e, g);
  }
  return out;
}

/** Number of days in the week that train each group. */
export function exposures(templates: SessionTemplate[], catalogue: Cat): Record<MuscleGroup, number> {
  const out = Object.fromEntries(groups().map((g) => [g, 0])) as Record<MuscleGroup, number>;
  for (const t of templates) {
    for (const g of groups()) {
      if (t.items.some((i) => i.sets > 0 && contribution(exerciseById(catalogue, i.exerciseId), g) > 0))
        out[g]++;
    }
  }
  return out;
}
