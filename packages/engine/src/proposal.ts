// SPDX-License-Identifier: AGPL-3.0-or-later
// Plan changes from the AI or a coach (invariant I4). The engine checks each
// change against kit, flags, rungs, time and volume limits, and returns the
// changed programme. Nothing applies until the user accepts it. Each change
// also needs evidence in the data: a stalled movement or low check-ins.

import { GOAL_TEMPLATES, GROUP_NAMES, MUSCLE_GROUPS, type MuscleGroup } from "./goals";
import { checkAllowed } from "./kit";
import { familyName, MAX_SETS, planItem } from "./plan";
import { blockWeek, DELOAD_WEEK, readinessMode, readinessScore, STALL_SESSIONS } from "./readiness";
import { reason } from "./reasons";
import { substitute } from "./substitute";
import { estimateMinutes, orderForDial } from "./time";
import type { DayType, EngineInput, Programme, Reason, SessionTemplate } from "./types";
import { weeklyVolume } from "./volume";

export type PlanChange =
  | { kind: "swap"; dayType: DayType; family: string; to: string }
  | { kind: "sets"; dayType: DayType; exerciseId: string; sets: number }
  | { kind: "deload" };

export type RefusalCode =
  | "not-in-plan"
  | "unknown"
  | "family"
  | "rung"
  | "kit"
  | "sets"
  | "time"
  | "volume"
  | "deload"
  | "evidence";

export type ValidationResult =
  | { ok: true; programme: Programme; reasons: Reason[] }
  | { ok: false; code: RefusalCode; reason: Reason };

const refuse = (code: RefusalCode, r: Reason): ValidationResult => ({ ok: false, code, reason: r });

const exerciseName = (input: EngineInput, id: string) =>
  input.catalogue.exercises.find((e) => e.id === id)?.names.en ?? id;

const stallOf = (input: EngineInput, family: string) =>
  input.history.progress.find((s) => s.family === family)?.streaks?.stall ?? 0;

/** A swap or more sets needs the movement to be stalled (P5). */
function notStalled(input: EngineInput, family: string, exerciseId: string): ValidationResult | undefined {
  const sessions = stallOf(input, family);
  if (sessions >= STALL_SESSIONS) return undefined;
  return refuse(
    "evidence",
    reason("PROPOSAL_NOT_STALLED", {
      exercise: exerciseName(input, exerciseId),
      sessions,
      needed: STALL_SESSIONS,
    }),
  );
}

function replaceDay(p: Programme, day: SessionTemplate): Programme {
  return { ...p, templates: p.templates.map((t) => (t.dayType === day.dayType ? day : t)) };
}

/** Checks the day against the user's minutes and the goal's week-4 volume. */
function checkDay(
  input: EngineInput,
  programme: Programme,
  day: SessionTemplate,
  changed: { exerciseId: string; sets: number; grew: boolean },
): ValidationResult | undefined {
  const minutes = input.profile.minutesPerSession;
  const needed = estimateMinutes(day.items, input.catalogue);
  if (needed > minutes) {
    return refuse("time", reason("PROPOSAL_TIME", { sets: changed.sets, day: day.dayType, needed, minutes }));
  }
  if (!changed.grew) return undefined;
  const goal = GOAL_TEMPLATES[input.profile.goalTemplate];
  if (!goal) return undefined;
  const volume = weeklyVolume(replaceDay(programme, day).templates, input.catalogue);
  for (const g of Object.keys(MUSCLE_GROUPS) as MuscleGroup[]) {
    const limit = goal.weeklySets[g]?.end ?? 0;
    const before = weeklyVolume(programme.templates, input.catalogue)[g];
    if (volume[g] > limit && volume[g] > before) {
      return refuse(
        "volume",
        reason("PROPOSAL_VOLUME", {
          sets: changed.sets,
          group: GROUP_NAMES[g],
          volume: Math.round(volume[g] * 10) / 10,
          limit,
        }),
      );
    }
  }
  return undefined;
}

export function validateProposal(input: EngineInput, change: PlanChange): ValidationResult {
  const p = input.programme;
  if (!p) throw new Error("validateProposal needs a programme");

  if (change.kind === "deload") {
    const week = blockWeek(p, input.today);
    if (p.earlyDeloadFrom !== undefined || week >= DELOAD_WEEK) {
      return refuse("deload", reason("PROPOSAL_DELOAD_RUNNING", {}));
    }
    // An early deload needs a reason in the data: stalls or low readiness.
    const stalled = input.history.progress.filter((s) => (s.streaks?.stall ?? 0) >= STALL_SESSIONS).length;
    const recent = input.history.checkins
      .filter((c) => c.date >= p.blockStart)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-4);
    const low = recent.filter((c) => readinessMode(readinessScore(c)) !== "full").length;
    if (stalled < 2 && low < 2) {
      return refuse(
        "evidence",
        reason("PROPOSAL_DELOAD_NOT_NEEDED", { stalled, low, of: recent.length, needed: STALL_SESSIONS }),
      );
    }
    return {
      ok: true,
      programme: { ...p, earlyDeloadFrom: input.today },
      reasons: [reason("PROPOSAL_DELOAD", { date: input.today })],
    };
  }

  const day = p.templates.find((t) => t.dayType === change.dayType);

  if (change.kind === "swap") {
    const at = day?.items.findIndex((i) => i.family === change.family) ?? -1;
    const item = day?.items[at];
    if (!day || !item) {
      const what = `${familyName(input, change.family)} movement`;
      return refuse("not-in-plan", reason("PROPOSAL_NOT_IN_PLAN", { what, day: change.dayType }));
    }
    const e = input.catalogue.exercises.find((x) => x.id === change.to);
    if (!e) return refuse("unknown", reason("PROPOSAL_UNKNOWN", { exercise: change.to }));
    if (e.family !== change.family) {
      return refuse(
        "family",
        reason("PROPOSAL_FAMILY", { exercise: e.names.en, familyName: familyName(input, change.family) }),
      );
    }
    const current = input.catalogue.exercises.find((x) => x.id === item.exerciseId);
    const owned = Math.max(
      input.history.progress.find((s) => s.family === e.family)?.rung ?? 0,
      current?.rung ?? 0,
    );
    if (e.rung > owned) {
      return refuse("rung", reason("PROPOSAL_RUNG", { exercise: e.names.en, rung: e.rung, owned }));
    }
    if (!checkAllowed(e, input.kit, input.flags, input.today).ok) {
      return refuse("kit", reason("PROPOSAL_KIT", { exercise: e.names.en }));
    }
    const idle = notStalled(input, item.family, item.exerciseId);
    if (idle) return idle;
    const r = reason("PROPOSAL_SWAP", {
      exercise: e.names.en,
      was: exerciseName(input, item.exerciseId),
      day: day.dayType,
      rung: e.rung,
    });
    const next = planItem(
      input,
      { family: e.family, role: item.role, sets: item.sets },
      { exercise: e, reason: r },
    );
    if (item.pairGroup !== undefined) next.pairGroup = item.pairGroup;
    const items = day.items.map((x, n) => (n === at ? next : x));
    const ordered = orderForDial(items, input.catalogue);
    const newDay = { ...day, items: ordered, estimatedMinutes: estimateMinutes(ordered, input.catalogue) };
    const bad = checkDay(input, p, newDay, { exerciseId: e.id, sets: item.sets, grew: false });
    return bad ?? { ok: true, programme: replaceDay(p, newDay), reasons: [r] };
  }

  const at = day?.items.findIndex((i) => i.exerciseId === change.exerciseId) ?? -1;
  const item = day?.items[at];
  if (!day || !item) {
    const what = exerciseName(input, change.exerciseId);
    return refuse("not-in-plan", reason("PROPOSAL_NOT_IN_PLAN", { what, day: change.dayType }));
  }
  const max = MAX_SETS[item.role];
  if (!Number.isInteger(change.sets) || change.sets < 1 || change.sets > max) {
    return refuse("sets", reason("PROPOSAL_SETS_RANGE", { role: item.role, max }));
  }
  if (change.sets > item.sets) {
    if (change.sets > item.sets + 1) return refuse("sets", reason("PROPOSAL_SETS_STEP", { from: item.sets }));
    const idle = notStalled(input, item.family, item.exerciseId);
    if (idle) return idle;
  }
  const r = reason("PROPOSAL_SETS", {
    exercise: exerciseName(input, item.exerciseId),
    day: day.dayType,
    from: item.sets,
    to: change.sets,
    minutes: input.profile.minutesPerSession,
  });
  const items = day.items.map((x, n) =>
    n === at ? { ...x, sets: change.sets, reasons: { ...x.reasons, sets: [...x.reasons.sets, r] } } : x,
  );
  const newDay = { ...day, items, estimatedMinutes: estimateMinutes(items, input.catalogue) };
  const bad = checkDay(input, p, newDay, {
    exerciseId: item.exerciseId,
    sets: change.sets,
    grew: change.sets > item.sets,
  });
  return bad ?? { ok: true, programme: replaceDay(p, newDay), reasons: [r] };
}

/**
 * The user's own swap (PRD "Swap"): any candidate `substitute` ranks for the
 * movement, on the same ladder or with the same pattern. It needs no stall,
 * because the user chose it; kit, flags (in the ranking) and time still apply.
 */
export function swapByUser(
  input: EngineInput,
  dayType: DayType,
  exerciseId: string,
  to: string,
): ValidationResult {
  const p = input.programme;
  if (!p) throw new Error("swapByUser needs a programme");
  const day = p.templates.find((t) => t.dayType === dayType);
  const at = day?.items.findIndex((i) => i.exerciseId === exerciseId) ?? -1;
  const item = day?.items[at];
  if (!day || !item) {
    return refuse(
      "not-in-plan",
      reason("PROPOSAL_NOT_IN_PLAN", { what: exerciseName(input, exerciseId), day: dayType }),
    );
  }
  const pick = substitute(input, exerciseId).find((c) => c.exerciseId === to);
  const e = input.catalogue.exercises.find((x) => x.id === to);
  if (!pick || !e) return refuse("kit", reason("PROPOSAL_KIT", { exercise: e?.names.en ?? to }));
  const next = planItem(
    input,
    { family: e.family, role: item.role, sets: item.sets },
    { exercise: e, reason: pick.reason },
  );
  if (item.pairGroup !== undefined) next.pairGroup = item.pairGroup;
  const items = orderForDial(
    day.items.map((x, n) => (n === at ? next : x)),
    input.catalogue,
  );
  const newDay = { ...day, items, estimatedMinutes: estimateMinutes(items, input.catalogue) };
  const bad = checkDay(input, p, newDay, { exerciseId: e.id, sets: item.sets, grew: false });
  return bad ?? { ok: true, programme: replaceDay(p, newDay), reasons: [pick.reason] };
}
