// SPDX-License-Identifier: AGPL-3.0-or-later
// Body and progress (PRD "Body and progress"): the muscle map, the ladder map,
// consistency, best sets, the monthly test and the gaps to destinations. All
// numbers come from the logged history; nothing here guesses.
import { rebuildProgress } from "./close";
import { addDays, daysBetween } from "./dates";
import { GOAL_TEMPLATES, MUSCLE_GROUPS, type MuscleGroup } from "./goals";
import type { EngineInput, LocalDate, TestItem, TestResult } from "./types";
import { contribution, exerciseById } from "./volume";

/** A group counts as recovering for this long after a session with at least RECOVER_SETS hard sets for it. */
export const RECOVER_HOURS = 48;
export const RECOVER_SETS = 3;

const groups = () => Object.keys(MUSCLE_GROUPS) as MuscleGroup[];
const zero = () => Object.fromEntries(groups().map((g) => [g, 0])) as Record<MuscleGroup, number>;

/** Logged sets per group, a side counting half. */
function setsByGroup(input: EngineInput, sessionIds: Set<string>): Record<MuscleGroup, number> {
  const out = zero();
  for (const s of input.history.sets) {
    if (s.deletedAt || !sessionIds.has(s.sessionId)) continue;
    const e = input.catalogue.exercises.find((x) => x.id === s.exerciseId);
    if (!e) continue;
    for (const g of groups()) out[g] += (s.side ? 0.5 : 1) * contribution(e, g);
  }
  return out;
}

export type MuscleWeek = {
  /** Hard sets per group in the 7 days that end on `to`. */
  sets: Record<MuscleGroup, number>;
  /** The goal's week-4 target per group, for the scale of the map. */
  target: Record<MuscleGroup, number>;
  recovering: MuscleGroup[];
  untrained: MuscleGroup[];
};

/** The three muscle-map modes: where the volume went, what is still recovering, what has gone untrained. */
export function muscleWeek(input: EngineInput, to: LocalDate = input.today): MuscleWeek {
  const from = addDays(to, -6);
  const done = input.history.sessions.filter((s) => s.status === "done" && s.date >= from && s.date <= to);
  const sets = setsByGroup(input, new Set(done.map((s) => s.id)));
  const goal = GOAL_TEMPLATES[input.profile.goalTemplate];
  const target = zero();
  for (const g of groups()) target[g] = goal?.weeklySets[g]?.end ?? 0;
  const recent = done.filter((s) => daysBetween(s.date, to) * 24 < RECOVER_HOURS);
  const recentSets = setsByGroup(input, new Set(recent.map((s) => s.id)));
  return {
    sets,
    target,
    recovering: groups().filter((g) => recentSets[g] >= RECOVER_SETS),
    untrained: groups().filter((g) => sets[g] === 0 && target[g] > 0),
  };
}

export type RungStep = { date: LocalDate; rung: number; exerciseId?: string };

/**
 * Each family's rung over time: the first state and every change, replayed
 * from tests and finished sessions (PRD "Ladder map").
 */
export function rungHistory(input: EngineInput): Record<string, RungStep[]> {
  const h = input.history;
  const dates = [
    ...new Set([
      ...h.tests.map((t) => t.date),
      ...h.sessions.filter((s) => s.status === "done").map((s) => s.date),
    ]),
  ].sort();
  const out: Record<string, RungStep[]> = {};
  for (const date of dates) {
    const state = rebuildProgress({
      ...input,
      history: {
        ...h,
        sessions: h.sessions.filter((s) => s.date <= date),
        tests: h.tests.filter((t) => t.date <= date),
      },
    });
    for (const s of state) {
      const steps = out[s.family] ?? [];
      out[s.family] = steps;
      const last = steps.at(-1);
      if (!last || last.rung !== s.rung || last.exerciseId !== s.exerciseId)
        steps.push({ date, rung: s.rung, ...(s.exerciseId ? { exerciseId: s.exerciseId } : {}) });
    }
  }
  return out;
}

export type Consistency = { from: LocalDate; to: LocalDate; done: number; planned: number };

/**
 * Main sessions done against the rotation, per 4-week window, oldest first.
 * Windows start at the plan or the first session, whichever is earlier.
 */
export function consistency(input: EngineInput, windows = 6): Consistency[] {
  const perWeek = input.programme?.rotation.length ?? 0;
  const firstSession = input.history.sessions.map((s) => s.date).sort()[0];
  const start = [input.programme?.blockStart, firstSession]
    .filter((d): d is string => d !== undefined)
    .sort()[0];
  const span = start ? Math.floor(daysBetween(start, input.today) / 28) + 1 : 1;
  const out: Consistency[] = [];
  for (let n = Math.min(windows, span) - 1; n >= 0; n--) {
    const to = addDays(input.today, -28 * n);
    const from = addDays(to, -27);
    const done = input.history.sessions.filter(
      (s) =>
        s.status === "done" && (s.kind === "main" || s.kind === "recovery") && s.date >= from && s.date <= to,
    ).length;
    out.push({ from, to, done, planned: perWeek * 4 });
  }
  return out;
}

export type BestSet = { date: LocalDate; value: number; unit: "reps" | "s"; kg?: number };

/** The best set of one exercise per session: most reps or seconds, then the heaviest load. */
export function bestSets(input: EngineInput, exerciseId: string): BestSet[] {
  const e = exerciseById(input.catalogue, exerciseId);
  const dates = new Map(input.history.sessions.filter((s) => s.status === "done").map((s) => [s.id, s.date]));
  const best = new Map<string, BestSet>();
  for (const s of input.history.sets) {
    const date = dates.get(s.sessionId);
    if (s.deletedAt || s.exerciseId !== exerciseId || !date) continue;
    const unit = e.default.seconds && !e.default.reps ? "s" : "reps";
    const value = (unit === "s" ? s.seconds : s.reps) ?? 0;
    const cur = best.get(date);
    const better =
      !cur || (s.loadKg ?? 0) > (cur.kg ?? 0) || ((s.loadKg ?? 0) === (cur.kg ?? 0) && value > cur.value);
    if (better) best.set(date, { date, value, unit, ...(s.loadKg !== undefined ? { kg: s.loadKg } : {}) });
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The monthly capability test is due when no test is logged in this calendar month. */
export function testDue(input: EngineInput): boolean {
  const month = input.today.slice(0, 7);
  return !input.history.tests.some((t) => t.date.slice(0, 7) === month);
}

/** One criterion of a destination, for example a 60 s dead hang. */
export type Criterion = { item: TestItem; value: number };

export type Gap = { item: TestItem; want: number; have?: number; met: boolean };

/** The gap from the latest test result of each item to the destination (PRD "Destinations"). */
export function destinationGap(criteria: Criterion[], tests: TestResult[]): Gap[] {
  return criteria.map((c) => {
    const latest = tests
      .filter((t) => t.item === c.item)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);
    return {
      item: c.item,
      want: c.value,
      ...(latest ? { have: latest.value } : {}),
      met: latest !== undefined && latest.value >= c.value,
    };
  });
}

/** The examples from the PRD; the user can add their own. */
export const DESTINATIONS: { name: string; criteria: Criterion[] }[] = [
  {
    name: "Climbing ready",
    criteria: [
      { item: "hang", value: 60 },
      { item: "pullups", value: 5 },
    ],
  },
  { name: "Carry my child up the hill", criteria: [{ item: "carry", value: 60 }] },
];
