// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import { adjustTargets, dailyTotal, emaSeries, startTargets, type WeighIn, weeklySlope } from "../src";

describe("startTargets", () => {
  test("lean gain, male: 2 of each per main meal, half at the snack", () => {
    const t = startTargets({ goal: "lean-gain", sex: "male" });
    expect(t.perMoment.dinner).toEqual({ palm: 2, fist: 2, cupped: 2, thumb: 2 });
    expect(t.perMoment.snack).toEqual({ palm: 1, fist: 1, cupped: 1, thumb: 1 });
    expect(dailyTotal(t.perMoment)).toEqual({ palm: 7, fist: 7, cupped: 7, thumb: 7 });
    expect(t.reason.ruleId).toBe("FOOD_START");
  });

  test("lean gain, female: 1 of each per main meal", () => {
    expect(startTargets({ goal: "lean-gain", sex: "female" }).perMoment.lunch).toEqual({
      palm: 1,
      fist: 1,
      cupped: 1,
      thumb: 1,
    });
  });
});

const series = (from: string, days: number, start: number, perWeek: number, every = 1): WeighIn[] => {
  const out: WeighIn[] = [];
  const d0 = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  for (let i = 0; i < days; i += every) {
    out.push({
      date: new Date(d0 + i * 86_400_000).toISOString().slice(0, 10),
      kg: start + (perWeek * i) / 7,
    });
  }
  return out;
};

describe("weight trend", () => {
  test("the EMA of a flat series is flat", () => {
    const e = emaSeries(series("2026-10-01", 21, 71, 0));
    expect(e.every((x) => Math.abs(x.kg - 71) < 1e-9)).toBe(true);
  });

  test("the slope of a steady gain is the gain per week", () => {
    expect(weeklySlope(series("2026-10-01", 21, 70, 0.3))).toBeCloseTo(0.3, 1);
  });
});

describe("N1 adjust", () => {
  const start = startTargets({ goal: "lean-gain", sex: "male" });
  const today = "2026-10-22";

  test("a flat trend for 3 weeks adds 1 cupped hand a day at dinner", () => {
    const r = adjustTargets(start, series("2026-10-01", 21, 71, 0), today);
    expect(r.changed).toBe(true);
    expect(r.targets.perMoment.dinner.cupped).toBe(3);
    expect(dailyTotal(r.targets.perMoment).cupped).toBe(8);
    expect(r.reason.ruleId).toBe("N1_ADD");
    expect(r.targets.adjustedAt).toBe(today);
  });

  test("a gain above 0.25 kg a week removes 1 cupped hand a day", () => {
    const r = adjustTargets(start, series("2026-10-01", 21, 70, 0.5), today);
    expect(r.targets.perMoment.dinner.cupped).toBe(1);
    expect(r.reason.ruleId).toBe("N1_REMOVE");
  });

  test("a gain inside the band changes nothing", () => {
    const r = adjustTargets(start, series("2026-10-01", 21, 70, 0.15), today);
    expect(r.changed).toBe(false);
    expect(r.reason.ruleId).toBe("N1_HOLD");
  });

  test("fewer than 8 weigh-ins in 21 days: N1 does not run and says why", () => {
    const r = adjustTargets(start, series("2026-10-01", 21, 71, 0, 3), today);
    expect(r.changed).toBe(false);
    expect(r.reason.ruleId).toBe("N1_GAPS");
  });

  test("at most one change in 14 days", () => {
    const first = adjustTargets(start, series("2026-10-01", 21, 71, 0), today);
    const again = adjustTargets(first.targets, series("2026-10-01", 28, 71, 0), "2026-10-29");
    expect(again.changed).toBe(false);
    expect(again.reason.ruleId).toBe("N1_WAIT");
    const later = adjustTargets(first.targets, series("2026-10-01", 35, 71, 0), "2026-11-05");
    expect(later.changed).toBe(true);
  });

  test("only weigh-ins in the last 21 days count", () => {
    const old = series("2026-09-01", 21, 68, 1);
    const r = adjustTargets(start, [...old, ...series("2026-10-01", 21, 71, 0)], today);
    expect(r.reason.ruleId).toBe("N1_ADD");
  });

  test("cupped hands never go below 0", () => {
    let t = start;
    let day = Date.UTC(2026, 9, 22);
    for (let i = 0; i < 6; i++) {
      const iso = new Date(day).toISOString().slice(0, 10);
      t = adjustTargets(
        t,
        series(new Date(day - 20 * 86_400_000).toISOString().slice(0, 10), 21, 70, 0.6),
        iso,
      ).targets;
      day += 15 * 86_400_000;
    }
    expect(t.perMoment.dinner.cupped).toBeGreaterThanOrEqual(0);
  });
});
