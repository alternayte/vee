// SPDX-License-Identifier: AGPL-3.0-or-later
// Time model, dial-change ordering and the time cut (SDD "Plan generation").
import type { Catalogue, Pattern } from "@vee/catalogue";
import { reason } from "./reasons";
import type { Reason, TemplateItem } from "./types";
import { exerciseById } from "./volume";

export const REP_S = 3.5;
export const TRANSITION_S = 30;
export const DIAL_CHANGE_S = 8;
export const WARMUP_S = 210;
export const PAIR_REST_S = 45;

type Cat = Pick<Catalogue, "exercises">;

function workSeconds(i: TemplateItem, cat: Cat): number {
  const mid = (i.target.low + i.target.high) / 2;
  const once = i.target.unit === "reps" ? mid * REP_S : mid;
  return exerciseById(cat, i.exerciseId).unilateral ? once * 2 : once;
}

function restSeconds(i: TemplateItem, cat: Cat): number {
  return i.pairGroup === undefined ? exerciseById(cat, i.exerciseId).default.rest_s : PAIR_REST_S;
}

/** The items in the order their sets happen. Paired items alternate set by set. */
function setSequence(items: TemplateItem[]): TemplateItem[] {
  const out: TemplateItem[] = [];
  const done = new Set<number>();
  for (const i of items) {
    if (i.pairGroup === undefined) {
      for (let s = 0; s < i.sets; s++) out.push(i);
      continue;
    }
    if (done.has(i.pairGroup)) continue;
    done.add(i.pairGroup);
    const pair = items.filter((x) => x.pairGroup === i.pairGroup);
    const most = Math.max(...pair.map((x) => x.sets));
    for (let s = 0; s < most; s++) for (const x of pair) if (s < x.sets) out.push(x);
  }
  return out;
}

export function dialChanges(items: TemplateItem[], _cat: Cat): number {
  let last: number | undefined;
  let changes = 0;
  for (const i of setSequence(items)) {
    if (i.loadKg === undefined) continue;
    if (last !== undefined && last !== i.loadKg) changes++;
    last = i.loadKg;
  }
  return changes;
}

/** Seconds for the session as ordered: Σ sets × (work + rest) + transitions + dial changes + warm-up. */
export function estimateSeconds(items: TemplateItem[], cat: Cat): number {
  const sets = items.reduce((s, i) => s + i.sets * (workSeconds(i, cat) + restSeconds(i, cat)), 0);
  return WARMUP_S + sets + TRANSITION_S * items.length + DIAL_CHANGE_S * dialChanges(items, cat);
}

export function estimateMinutes(items: TemplateItem[], cat: Cat): number {
  return Math.ceil(estimateSeconds(items, cat) / 60);
}

/**
 * Keeps main movements first, in order. Sorts accessory units (single items or
 * pairs) by load so that equal dial settings sit next to each other.
 */
export function orderForDial(items: TemplateItem[], _cat: Cat): TemplateItem[] {
  const mains = items.filter((i) => i.role === "main");
  const units: TemplateItem[][] = [];
  const seen = new Set<number>();
  for (const i of items.filter((x) => x.role === "accessory")) {
    if (i.pairGroup === undefined) units.push([i]);
    else if (!seen.has(i.pairGroup)) {
      seen.add(i.pairGroup);
      units.push(items.filter((x) => x.pairGroup === i.pairGroup));
    }
  }
  const key = (u: TemplateItem[]) => Math.min(...u.map((i) => i.loadKg ?? Number.NEGATIVE_INFINITY));
  const sorted = units
    .map((u, idx) => ({ u, idx }))
    .sort((a, b) => key(a.u) - key(b.u) || a.idx - b.idx)
    .flatMap((x) => x.u);
  return [...mains, ...sorted].map((i, n) => ({ ...i, order: n + 1 }));
}

const ANTAGONISTS: [Pattern, Pattern][] = [
  ["horizontal-pull", "horizontal-push"],
  ["vertical-pull", "vertical-push"],
  ["vertical-pull", "dip"],
  ["elbow-flexion", "elbow-extension"],
  ["squat", "hinge"],
  ["lunge", "hinge"],
  ["lateral-raise", "rear-delt"],
];

function antagonist(a: Pattern, b: Pattern): boolean {
  return ANTAGONISTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** Pairs unpaired accessories two by two. Prefers antagonists and pairs that do not change the dial. */
function pairAccessories(items: TemplateItem[], cat: Cat): boolean {
  const free = items.filter((i) => i.role === "accessory" && i.pairGroup === undefined);
  if (free.length < 2) return false;
  let group = Math.max(0, ...items.map((i) => i.pairGroup ?? 0));
  const taken = new Set<TemplateItem>();
  for (let a = 0; a < free.length; a++) {
    const x = free[a];
    if (!x || taken.has(x)) continue;
    let best: TemplateItem | undefined;
    let bestScore = -1;
    for (let b = a + 1; b < free.length; b++) {
      const y = free[b];
      if (!y || taken.has(y)) continue;
      const anta = antagonist(
        exerciseById(cat, x.exerciseId).pattern,
        exerciseById(cat, y.exerciseId).pattern,
      );
      const dialClash = x.loadKg !== undefined && y.loadKg !== undefined && x.loadKg !== y.loadKg;
      const score = (anta ? 2 : 0) + (dialClash ? 0 : 1);
      if (score > bestScore) {
        best = y;
        bestScore = score;
      }
    }
    if (!best) continue;
    group++;
    x.pairGroup = group;
    best.pairGroup = group;
    taken.add(x);
    taken.add(best);
  }
  return true;
}

export type CutResult = { items: TemplateItem[]; reasons: Reason[] };

/**
 * Cuts a session to fit `minutes`, in the SDD order: drop the last accessory,
 * pair the remaining accessories, cut accessory sets to 2, cut main sets by 1.
 * If it still does not fit, it drops more accessories, then later main
 * movements, then sets on the first main movement. The first main movement
 * stays. Items are in priority order; the result keeps that order.
 */
export function timeCut(input: TemplateItem[], minutes: number, cat: Cat): CutResult {
  const items = input.map((i) => ({ ...i, reasons: { ...i.reasons, sets: [...i.reasons.sets] } }));
  const reasons: Reason[] = [];
  const limit = minutes * 60;
  const fits = () => estimateSeconds(orderForDial(items, cat), cat) <= limit;
  const last = (role: TemplateItem["role"]) => items.findLastIndex((i) => i.role === role);

  // Never drops the first item: it is the first main movement, or the only work left.
  const dropLast = (role: TemplateItem["role"]): boolean => {
    const at = last(role);
    if (at <= 0) return false;
    const [gone] = items.splice(at, 1);
    if (gone?.pairGroup !== undefined) {
      for (const i of items) if (i.pairGroup === gone.pairGroup) delete i.pairGroup;
    }
    reasons.push(reason("TIME_CUT_DROP", { exercise: gone?.exerciseId ?? "", minutes }));
    return true;
  };

  const cutSets = (
    pick: (i: TemplateItem, idx: number) => boolean,
    to: (s: number) => number,
    ruleId: string,
  ) => {
    const r = reason(ruleId, { minutes });
    let changed = false;
    items.forEach((i, idx) => {
      const next = to(i.sets);
      if (pick(i, idx) && next < i.sets) {
        i.sets = next;
        i.reasons.sets.push(r);
        changed = true;
      }
    });
    if (changed) reasons.push(r);
    return changed;
  };

  const once: (() => boolean)[] = [
    () => dropLast("accessory"),
    () => {
      const changed = pairAccessories(items, cat);
      if (changed) reasons.push(reason("TIME_CUT_PAIR", { minutes }));
      return changed;
    },
    () =>
      cutSets(
        (i) => i.role === "accessory",
        (s) => Math.min(s, 2),
        "TIME_CUT_ACCESSORY_SETS",
      ),
    () =>
      cutSets(
        (i) => i.role === "main",
        (s) => Math.max(2, s - 1),
        "TIME_CUT_MAIN_SETS",
      ),
  ];
  for (const step of once) {
    if (fits()) break;
    step();
  }
  while (!fits() && dropLast("accessory")) {}
  while (!fits() && dropLast("main")) {}
  while (
    !fits() &&
    cutSets(
      (_i, idx) => idx === 0,
      (s) => Math.max(1, s - 1),
      "TIME_CUT_FIRST_MAIN_SETS",
    )
  ) {}

  return { items, reasons };
}
