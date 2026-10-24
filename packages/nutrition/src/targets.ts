// SPDX-License-Identifier: AGPL-3.0-or-later
// Portion targets and the weekly adjust rule N1 (SDD "Portion targets").
import { zeroPortions } from "./portions";
import { reason } from "./reasons";
import { MOMENTS, type Moment, PORTIONS, type Portions, type Reason } from "./types";

export type FoodGoal = "lean-gain";
export type Sex = "male" | "female";

/** Standard hand portions per main meal. The snack gets half. */
const GOAL_TABLE: Record<FoodGoal, Record<Sex, number>> = {
  "lean-gain": { male: 2, female: 1 },
};

const GOAL_NAMES: Record<FoodGoal, string> = { "lean-gain": "a lean gain" };

export type FoodTargets = {
  perMoment: Record<Moment, Portions>;
  adjustedAt?: string;
  reason: Reason;
};

const same = (n: number): Portions => ({ palm: n, fist: n, cupped: n, thumb: n });

export function startTargets(p: { goal: FoodGoal; sex: Sex }): FoodTargets {
  const main = GOAL_TABLE[p.goal][p.sex];
  const snack = main / 2;
  const perMoment = { breakfast: same(main), lunch: same(main), dinner: same(main), snack: same(snack) };
  return { perMoment, reason: reason("FOOD_START", { goal: GOAL_NAMES[p.goal], main, snack }) };
}

export function dailyTotal(perMoment: Record<Moment, Portions>): Portions {
  const out = zeroPortions();
  for (const m of MOMENTS) for (const p of PORTIONS) out[p] += perMoment[m][p];
  return out;
}

export type WeighIn = { date: string; kg: number };

export const EMA_DAYS = 7;
export const WINDOW_DAYS = 21;
export const MIN_WEIGH_INS = 8;
export const ADD_BELOW = 0.05;
export const REMOVE_ABOVE = 0.25;
export const MIN_DAYS_BETWEEN = 14;

const dayNumber = (d: string) =>
  Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;

const byDate = (a: WeighIn, b: WeighIn) => a.date.localeCompare(b.date);

/** The 7-day exponential moving average, one point per weigh-in. The app shows this trend. */
export function emaSeries(weighIns: WeighIn[]): WeighIn[] {
  const alpha = 2 / (EMA_DAYS + 1);
  let ema: number | undefined;
  return [...weighIns].sort(byDate).map((w) => {
    ema = ema === undefined ? w.kg : alpha * w.kg + (1 - alpha) * ema;
    return { date: w.date, kg: ema };
  });
}

/** Least-squares slope of the weigh-ins, in kg per week. */
export function weeklySlope(weighIns: WeighIn[]): number {
  const pts = weighIns.map((w) => ({ x: dayNumber(w.date), y: w.kg }));
  const n = pts.length;
  if (n < 2) return 0;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return sxx === 0 ? 0 : (sxy / sxx) * 7;
}

export type Adjustment = { targets: FoodTargets; changed: boolean; reason: Reason };

/** Carbs come off or on at dinner first, then lunch, breakfast and the snack. */
const CARB_ORDER: Moment[] = ["dinner", "lunch", "breakfast", "snack"];

/** N1: one cupped hand of carbs a day more when the 3-week trend is flat, one fewer when it is fast. */
export function adjustTargets(current: FoodTargets, weighIns: WeighIn[], today: string): Adjustment {
  const t = dayNumber(today);
  const hold = (r: Reason): Adjustment => ({ targets: current, changed: false, reason: r });

  if (current.adjustedAt !== undefined) {
    const days = t - dayNumber(current.adjustedAt);
    if (days < MIN_DAYS_BETWEEN) return hold(reason("N1_WAIT", { days }));
  }
  const window = weighIns.filter((w) => {
    const age = t - dayNumber(w.date);
    return age >= 0 && age < WINDOW_DAYS;
  });
  if (window.length < MIN_WEIGH_INS) return hold(reason("N1_GAPS", { count: window.length }));

  const slope = weeklySlope(window);
  const shown = Math.round(slope * 100) / 100;
  const perMoment = structuredClone(current.perMoment);
  if (slope < ADD_BELOW) {
    perMoment.dinner.cupped += 1;
    const r = reason("N1_ADD", { slope: shown });
    return { targets: { perMoment, adjustedAt: today, reason: r }, changed: true, reason: r };
  }
  if (slope > REMOVE_ABOVE) {
    const from = CARB_ORDER.find((m) => perMoment[m].cupped >= 1);
    if (!from) return hold(reason("N1_FLOOR", {}));
    perMoment[from].cupped -= 1;
    const r = reason("N1_REMOVE", { slope: shown });
    return { targets: { perMoment, adjustedAt: today, reason: r }, changed: true, reason: r };
  }
  return hold(reason("N1_HOLD", { slope: shown }));
}
