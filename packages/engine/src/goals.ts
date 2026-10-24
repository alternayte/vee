// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Muscle } from "@vee/catalogue";
import type { DayType, Role } from "./types";

/** Muscle groups that goal templates set weekly hard-set targets for. */
export const MUSCLE_GROUPS = {
  "lats-upper-back": ["lats", "upper-back"],
  "side-delts": ["side-delts"],
  "rear-delts": ["rear-delts"],
  chest: ["chest"],
  triceps: ["triceps"],
  biceps: ["biceps"],
  quads: ["quads"],
  "hamstrings-glutes": ["hamstrings", "glutes"],
  core: ["abs", "obliques"],
} as const satisfies Record<string, readonly Muscle[]>;

export type MuscleGroup = keyof typeof MUSCLE_GROUPS;

export const GROUP_NAMES: Record<MuscleGroup, string> = {
  "lats-upper-back": "lats and upper back",
  "side-delts": "side delts",
  "rear-delts": "rear delts",
  chest: "chest",
  triceps: "triceps",
  biceps: "biceps",
  quads: "quads",
  "hamstrings-glutes": "hamstrings and glutes",
  core: "core",
};

/** `sets` overrides the base sets for the role. */
export type Slot = { family: string; role: Role; sets?: number };

export type GoalTemplate = {
  id: string;
  name: string;
  /** Build weeks per block. The deload week follows them. */
  buildWeeks: number;
  weeklySets: Record<MuscleGroup, { start: number; end: number }>;
  /** Slots in priority order: main movements first. */
  days: { dayType: DayType; name: string; slots: Slot[] }[];
};

const main = (family: string): Slot => ({ family, role: "main" });
const acc = (family: string, sets?: number): Slot =>
  sets === undefined ? { family, role: "accessory" } : { family, role: "accessory", sets };

export const V_TAPER_LEAN_GAIN: GoalTemplate = {
  id: "v-taper-lean-gain",
  name: "V-taper, lean gain",
  buildWeeks: 4,
  weeklySets: {
    "lats-upper-back": { start: 12, end: 18 },
    "side-delts": { start: 10, end: 16 },
    "rear-delts": { start: 4, end: 8 },
    chest: { start: 6, end: 10 },
    triceps: { start: 4, end: 8 },
    biceps: { start: 4, end: 8 },
    quads: { start: 6, end: 10 },
    "hamstrings-glutes": { start: 4, end: 8 },
    core: { start: 4, end: 6 },
  },
  // Lateral raises start at 3 sets: side delts and back make the V. Inside a
  // day, accessories that give a group its second exposure come before the
  // ones the time cut can drop with less loss.
  days: [
    {
      dayType: "A",
      name: "Pull and side delts",
      slots: [main("vertical-pull"), main("row"), acc("lateral-raise", 3), acc("rear-delt"), acc("core")],
    },
    {
      dayType: "B",
      name: "Legs and core",
      slots: [
        main("squat"),
        main("hinge"),
        acc("lateral-raise", 3),
        acc("floor-press"),
        acc("core-hold"),
        acc("carry"),
      ],
    },
    {
      dayType: "C",
      name: "Push and delts",
      slots: [
        main("dip"),
        main("push-up"),
        acc("lateral-raise", 3),
        acc("squat"),
        acc("overhead-press"),
        acc("triceps"),
      ],
    },
    {
      dayType: "D",
      name: "Pull and arms",
      slots: [main("chin-up"), main("row"), acc("rear-delt"), acc("hinge"), acc("curl"), acc("core")],
    },
  ],
};

export const GOAL_TEMPLATES: Record<string, GoalTemplate> = { [V_TAPER_LEAN_GAIN.id]: V_TAPER_LEAN_GAIN };

/** Weekly hard-set targets for a build week, linear from start to end. */
export function weeklyTargets(goal: GoalTemplate, week: number): Record<MuscleGroup, number> {
  const t =
    goal.buildWeeks > 1 ? (Math.min(Math.max(week, 1), goal.buildWeeks) - 1) / (goal.buildWeeks - 1) : 0;
  const out = {} as Record<MuscleGroup, number>;
  for (const g of Object.keys(goal.weeklySets) as MuscleGroup[]) {
    const { start, end } = goal.weeklySets[g];
    out[g] = Math.round(start + (end - start) * t);
  }
  return out;
}
