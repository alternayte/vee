// SPDX-License-Identifier: AGPL-3.0-or-later
// Plan changes from the AI or a coach (invariant I4). The engine checks each
// change against kit, flags, rungs, time and volume limits, and returns the
// changed programme. Nothing applies until the user accepts it.

import { GOAL_TEMPLATES, GROUP_NAMES, MUSCLE_GROUPS, type MuscleGroup } from "./goals";
import { checkAllowed } from "./kit";
import { familyName, MAX_SETS, planItem } from "./plan";
import { blockWeek, DELOAD_WEEK } from "./readiness";
import { reason } from "./reasons";
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
  | "deload";

export type ValidationResult =
  | { ok: true; programme: Programme; reasons: Reason[] }
  | { ok: false; code: RefusalCode; reason: Reason };

const refuse = (code: RefusalCode, r: Reason): ValidationResult => ({ ok: false, code, reason: r });

const exerciseName = (input: EngineInput, id: string) =>
  input.catalogue.exercises.find((e) => e.id === id)?.names.en ?? id;

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
