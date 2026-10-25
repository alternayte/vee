// SPDX-License-Identifier: AGPL-3.0-or-later
// Food numbers for the weekly review: how many days have logs, and how much
// of each daily target the logged days reach.
import { dailyTotal, type Moment, PORTIONS, type Portion, type Portions, sumPortions } from "@vee/nutrition";

export type FoodWeek = {
  daysLogged: number;
  days: number;
  /** Logged portions as a whole percent of the daily target, over the logged days. */
  percentOfTarget: Record<Portion, number>;
};

export function foodWeek(
  logs: { date: string; portions: Portions }[],
  perMoment: Record<Moment, Portions> | undefined,
  days: string[],
): FoodWeek {
  const inWeek = logs.filter((l) => days.includes(l.date));
  const logged = [...new Set(inWeek.map((l) => l.date))];
  const target = perMoment ? dailyTotal(perMoment) : undefined;
  const total = sumPortions(inWeek.map((l) => l.portions));
  const percentOfTarget = Object.fromEntries(
    PORTIONS.map((p) => {
      const want = (target?.[p] ?? 0) * logged.length;
      return [p, want > 0 ? Math.round((total[p] / want) * 100) : 0];
    }),
  ) as Record<Portion, number>;
  return { daysLogged: logged.length, days: days.length, percentOfTarget };
}
