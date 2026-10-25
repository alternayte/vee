// SPDX-License-Identifier: AGPL-3.0-or-later
// Plan generation (SDD "Plan generation"): pick an exercise per slot, cut each
// day to the user's minutes, then add sets toward the weekly targets.
import type { Exercise } from "@vee/catalogue";
import { snapLoad } from "./dial";
import {
  type GoalTemplate,
  GROUP_NAMES,
  MUSCLE_GROUPS,
  type MuscleGroup,
  type Slot,
  weeklyTargets,
} from "./goals";
import { checkAllowed, loadOptions } from "./kit";
import { reason } from "./reasons";
import { estimateMinutes, estimateSeconds, orderForDial, timeCut } from "./time";
import type { EngineInput, Programme, Reason, SessionTemplate, TemplateItem } from "./types";
import { contribution, weeklyVolume } from "./volume";

export const BASE_SETS = { main: 3, accessory: 2 } as const;
export const MAX_SETS = { main: 5, accessory: 5 } as const;

const LOAD_RANK: Record<Exercise["load"], number> = {
  dial: 3,
  fixed: 3,
  "band-assist": 2,
  "band-resist": 2,
  timed: 1,
  bodyweight: 0,
};

export type Picked = { exercise: Exercise; reason: Reason };

/**
 * The highest rung the user owns that kit and flags allow. On a rung with
 * alternatives: the exercise in progress state first, then loaded work, then
 * the exercise that uses more of the kit.
 */
/**
 * Orders exercises on the same ladder: highest rung first; on one rung, the
 * exercise in progress state, then loaded work, then the exercise that uses
 * more of the kit, then id.
 */
export function rankCandidates(candidates: Exercise[], preferId?: string): Exercise[] {
  const score = (e: Exercise) => [e.rung, e.id === preferId ? 1 : 0, LOAD_RANK[e.load], e.requires.length];
  return [...candidates].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let k = 0; k < sa.length; k++) {
      const d = (sb[k] ?? 0) - (sa[k] ?? 0);
      if (d !== 0) return d;
    }
    return a.id.localeCompare(b.id);
  });
}

export function familyName(input: Pick<EngineInput, "catalogue">, family: string): string {
  return input.catalogue.families.find((f) => f.id === family)?.names.en.toLowerCase() ?? family;
}

/**
 * The highest rung the user owns that kit and flags allow. A ladder with no
 * progress state starts at the lowest rung that kit and flags allow.
 */
export function pickExercise(input: EngineInput, family: string): Picked | undefined {
  const state = input.history.progress.find((p) => p.family === family);
  const allowed = input.catalogue.exercises.filter(
    (e) => e.family === family && checkAllowed(e, input.kit, input.flags, input.today).ok,
  );
  const name = familyName(input, family);
  if (!state) {
    const lowest = Math.min(...allowed.map((e) => e.rung));
    const best = rankCandidates(allowed.filter((e) => e.rung === lowest))[0];
    if (!best) return undefined;
    const ruleId = best.rung === 1 ? "PLAN_PICK" : "PLAN_PICK_START";
    return {
      exercise: best,
      reason: reason(ruleId, { family, familyName: name, rung: best.rung, owned: 1 }),
    };
  }
  const best = rankCandidates(
    allowed.filter((e) => e.rung <= state.rung),
    state.exerciseId,
  )[0];
  if (!best) return undefined;
  const ruleId = best.rung === state.rung ? "PLAN_PICK" : "PLAN_PICK_LOWER";
  return {
    exercise: best,
    reason: reason(ruleId, { family, familyName: name, rung: best.rung, owned: state.rung }),
  };
}

export function chooseLoad(input: EngineInput, e: Exercise): { loadKg: number; reason: Reason } | undefined {
  const options = loadOptions(e, input.kit);
  if (options.length === 0) return undefined;
  const state = input.history.progress.find((p) => p.family === e.family && p.exerciseId === e.id);
  if (state?.loadKg === undefined) {
    const load = options[0] as number;
    return { loadKg: load, reason: reason("LOAD_START", { load }) };
  }
  if (options.includes(state.loadKg))
    return { loadKg: state.loadKg, reason: reason("LOAD_STATE", { load: state.loadKg }) };
  const load = snapLoad(options, state.loadKg) as number;
  return { loadKg: load, reason: reason("LOAD_SNAP", { was: state.loadKg, load }) };
}

function buildItem(input: EngineInput, slot: Slot, pick: Picked): TemplateItem {
  const e = pick.exercise;
  const sets = slot.sets ?? BASE_SETS[slot.role];
  const range = e.default.reps ?? e.default.seconds;
  if (!range) throw new Error(`exercise ${e.id} has no reps or seconds`);
  const unit = e.default.reps ? "reps" : "seconds";
  const load = chooseLoad(input, e);
  // Timed work plans the hold the prescription will ask for, so the time
  // model counts the real hold, not the middle of the catalogue range.
  const state = input.history.progress.find((p) => p.family === e.family && p.exerciseId === e.id);
  const hold = e.load === "timed" && e.default.seconds ? (state?.holdS ?? e.default.seconds[0]) : undefined;
  const item: TemplateItem = {
    order: 0,
    family: e.family,
    exerciseId: e.id,
    role: slot.role,
    sets,
    target: hold === undefined ? { unit, low: range[0], high: range[1] } : { unit, low: hold, high: hold },
    reasons: {
      exercise: pick.reason,
      sets: [reason("SETS_BASE", { role: slot.role, sets })],
      target:
        hold === undefined
          ? reason("TARGET_DEFAULT", { low: range[0], high: range[1], unit })
          : reason(state?.holdS !== undefined ? "HOLD_STATE" : "HOLD_START", { hold }),
    },
  };
  if (load) {
    item.loadKg = load.loadKg;
    item.reasons.load = load.reason;
  }
  return item;
}

type Day = { dayType: SessionTemplate["dayType"]; name: string; items: TemplateItem[]; reasons: Reason[] };

function buildDay(input: EngineInput, day: GoalTemplate["days"][number]): Day {
  const items: TemplateItem[] = [];
  const reasons: Reason[] = [];
  for (const slot of day.slots) {
    const pick = pickExercise(input, slot.family);
    if (!pick) {
      const name =
        input.catalogue.families.find((f) => f.id === slot.family)?.names.en.toLowerCase() ?? slot.family;
      reasons.push(reason("PLAN_NO_OPTION", { family: slot.family, familyName: name }));
      continue;
    }
    items.push(buildItem(input, slot, pick));
  }
  // The first main movement leads the day, even when an earlier main slot is empty.
  items.sort((a, b) => (a.role === b.role ? 0 : a.role === "main" ? -1 : 1));
  const cut = timeCut(items, input.profile.minutesPerSession, input.catalogue);
  return { dayType: day.dayType, name: day.name, items: cut.items, reasons: [...reasons, ...cut.reasons] };
}

/** Adds one set at a time to the group furthest below its target, while each day still fits. */
function fillSets(input: EngineInput, days: Day[], targets: Record<MuscleGroup, number>, week: number): void {
  const limit = input.profile.minutesPerSession * 60;
  const groups = Object.keys(MUSCLE_GROUPS) as MuscleGroup[];
  const blocked = new Set<MuscleGroup>();
  const added = new Map<TemplateItem, Map<MuscleGroup, number>>();
  const exercise = (i: TemplateItem) =>
    input.catalogue.exercises.find((e) => e.id === i.exerciseId) as Exercise;
  const templates = () => days.map((d) => ({ ...d, estimatedMinutes: 0 }));

  for (;;) {
    const volume = weeklyVolume(templates(), input.catalogue);
    const short = groups
      .filter((g) => !blocked.has(g) && targets[g] > 0 && volume[g] < targets[g])
      .sort((a, b) => (targets[b] - volume[b]) / targets[b] - (targets[a] - volume[a]) / targets[a]);
    const g = short[0];
    if (g === undefined) break;

    let best: { day: Day; item: TemplateItem; c: number } | undefined;
    for (const day of days) {
      for (const item of day.items) {
        const c = contribution(exercise(item), g);
        if (c === 0 || item.sets >= MAX_SETS[item.role]) continue;
        item.sets++;
        const fits = estimateSeconds(orderForDial(day.items, input.catalogue), input.catalogue) <= limit;
        item.sets--;
        if (!fits) continue;
        if (!best || c > best.c || (c === best.c && item.sets < best.item.sets)) best = { day, item, c };
      }
    }
    if (!best) {
      blocked.add(g);
      continue;
    }
    best.item.sets++;
    const perGroup = added.get(best.item) ?? new Map<MuscleGroup, number>();
    perGroup.set(g, (perGroup.get(g) ?? 0) + 1);
    added.set(best.item, perGroup);
  }

  for (const [item, perGroup] of added) {
    for (const [g, n] of perGroup) {
      item.reasons.sets.push(
        reason("SETS_FILL", { group: GROUP_NAMES[g], target: targets[g], week, added: n }),
      );
    }
  }
}

/** A new block: session templates for build week `week` (1 to the goal's build weeks). */
export function generatePlan(input: EngineInput, goal: GoalTemplate, week = 1): Programme {
  const targets = weeklyTargets(goal, week);
  const days = goal.days.map((d) => buildDay(input, d));
  fillSets(input, days, targets, week);
  const templates: SessionTemplate[] = days.map((d) => {
    const items = orderForDial(d.items, input.catalogue);
    return {
      dayType: d.dayType,
      name: d.name,
      items,
      estimatedMinutes: estimateMinutes(items, input.catalogue),
      reasons: d.reasons,
    };
  });
  return {
    goalTemplate: goal.id,
    engineVersion: input.engineVersion,
    rotation: goal.days.map((d) => d.dayType),
    blockStart: input.today,
    blockWeek: week,
    templates,
  };
}
