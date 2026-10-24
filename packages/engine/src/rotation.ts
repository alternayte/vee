// SPDX-License-Identifier: AGPL-3.0-or-later
// Rotation, micro days and climbing (SDD "Rotation, micro days and climbing").
import { addDays, daysBetween, isoWeek } from "./dates";
import { checkAllowed } from "./kit";
import { rankCandidates } from "./plan";
import { reason } from "./reasons";
import { estimateMinutes } from "./time";
import type { EngineInput, PrescribedItem, Prescription, Reason, SessionTemplate } from "./types";

export const MICRO_PER_WEEK = 2;
export const MICRO_SHARE = { low: 0.5, high: 0.6 } as const;
/** Climbing counts toward the week as this many pulling and grip sets. */
export const CLIMB_SETS = { pull: 6, grip: 4 } as const;
export const CLIMB_WINDOW_DAYS = 2;

const doneSessions = (input: EngineInput) =>
  input.history.sessions.filter((s) => s.status === "done").sort((a, b) => a.date.localeCompare(b.date));

/** The first day type in the rotation not done since the last full cycle. A skipped session stays next. */
export function nextSession(input: EngineInput): { template: SessionTemplate; reason: Reason } {
  const p = input.programme;
  if (!p) throw new Error("nextSession needs a programme");
  let cycle = new Set<string>();
  for (const s of doneSessions(input)) {
    if (s.kind !== "main" || s.dayType === undefined) continue;
    cycle.add(s.dayType);
    if (p.rotation.every((d) => cycle.has(d))) cycle = new Set();
  }
  const day = p.rotation.find((d) => !cycle.has(d)) ?? p.rotation[0];
  const template = p.templates.find((t) => t.dayType === day);
  if (!template) throw new Error(`programme has no template for day ${day}`);
  return { template, reason: reason("ROTATION_NEXT", { day: template.dayType, name: template.name }) };
}

export function climbedRecently(input: EngineInput): boolean {
  return doneSessions(input).some((s) => {
    const d = daysBetween(s.date, input.today);
    return s.kind === "climb" && d >= 0 && d <= CLIMB_WINDOW_DAYS;
  });
}

function bestValue(input: EngineInput, exerciseId: string, test: "pullups" | "hang"): number {
  const fromSets = input.history.sets
    .filter((x) => x.exerciseId === exerciseId && x.deletedAt === undefined)
    .map((x) => (test === "hang" ? (x.seconds ?? 0) : (x.reps ?? 0)));
  const fromTests = input.history.tests.filter((t) => t.item === test).map((t) => t.value);
  return Math.max(0, ...fromSets, ...fromTests);
}

function microItem(
  input: EngineInput,
  exerciseId: string,
  sets: number,
  target: PrescribedItem["target"],
  r: Reason,
): PrescribedItem | undefined {
  const e = input.catalogue.exercises.find((x) => x.id === exerciseId);
  if (!e || !checkAllowed(e, input.kit, input.flags, input.today).ok) return undefined;
  return {
    order: 0,
    family: e.family,
    exerciseId: e.id,
    role: "accessory",
    sets,
    target,
    restS: 0,
    reasons: { exercise: r, sets: [r], target: r },
  };
}

/**
 * A 10-minute micro session, offered on the day after a main session, at most
 * 2 per week: sub-maximal hangs or pull-up singles, plus mobility.
 */
export function microSession(input: EngineInput): Prescription | undefined {
  const done = doneSessions(input);
  const yesterday = addDays(input.today, -1);
  if (!done.some((s) => s.kind === "main" && s.date === yesterday)) return undefined;
  if (done.some((s) => s.date === input.today && s.kind !== "micro")) return undefined;
  const week = isoWeek(input.today);
  if (done.filter((s) => s.kind === "micro" && isoWeek(s.date) === week).length >= MICRO_PER_WEEK)
    return undefined;

  const items: PrescribedItem[] = [];
  const vp = input.history.progress.find((p) => p.family === "vertical-pull");
  const strict = bestValue(input, "pullup-strict", "pullups");
  if ((vp?.rung ?? 1) >= 5 && strict >= 2) {
    const low = Math.max(1, Math.round(strict * MICRO_SHARE.low));
    const high = Math.max(low, Math.round(strict * MICRO_SHARE.high));
    const r = reason("MICRO_SINGLES", { best: strict, low, high });
    const it = microItem(input, "pullup-strict", 5, { unit: "reps", low, high }, r);
    if (it) items.push(it);
  } else {
    const hang = bestValue(input, "dead-hang", "hang") || 10;
    const low = Math.max(5, Math.round(hang * MICRO_SHARE.low));
    const high = Math.max(low, Math.round(hang * MICRO_SHARE.high));
    const r = reason("MICRO_HANGS", { best: hang, low, high });
    const it = microItem(input, "dead-hang", 4, { unit: "seconds", low, high }, r);
    if (it) items.push(it);
  }

  const mobility = rankCandidates(
    input.catalogue.exercises.filter(
      (e) => e.family === "mobility" && checkAllowed(e, input.kit, input.flags, input.today).ok,
    ),
  ).sort((a, b) => a.id.localeCompare(b.id));
  const drills = items.length > 0 ? 2 : 3;
  for (const e of mobility.slice(0, drills)) {
    const range = e.default.reps ?? e.default.seconds ?? [1, 1];
    const unit = e.default.reps ? "reps" : "seconds";
    const r = reason("MICRO_MOBILITY", {});
    const it = microItem(input, e.id, 1, { unit, low: range[0], high: range[1] }, r);
    if (it) items.push(it);
  }
  const ordered = items.map((x, n) => ({ ...x, order: n + 1 }));
  return {
    kind: "micro",
    readinessMode: "full",
    deload: false,
    engineVersion: input.engineVersion,
    warmup: [],
    items: ordered,
    estimatedMinutes: Math.min(10, estimateMinutes(ordered, input.catalogue)),
    reasons: [reason("MICRO_OFFER", { max: MICRO_PER_WEEK })],
  };
}
