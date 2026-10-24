// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  addDays,
  blockWeek,
  type Checkin,
  daysBetween,
  deloadStatus,
  emptyHistory,
  generatePlan,
  isoWeek,
  type ProgressState,
  readinessMode,
  readinessScore,
  V_TAPER_LEAN_GAIN,
} from "../src";
import { input } from "./helpers";

const checkin = (over: Partial<Checkin> = {}): Checkin => ({
  sessionId: "s",
  date: "2026-11-02",
  energy: 3,
  soreness: 3,
  sleep: "ok",
  ...over,
});

describe("dates", () => {
  test("addDays and daysBetween cross month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });

  test("isoWeek uses Monday as the first day", () => {
    expect(isoWeek("2026-11-02")).toBe("2026-W45");
    expect(isoWeek("2026-11-08")).toBe("2026-W45");
    expect(isoWeek("2026-11-09")).toBe("2026-W46");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
  });
});

describe("readiness", () => {
  test("score is energy + (6 − soreness) + sleep", () => {
    expect(readinessScore(checkin({ energy: 5, soreness: 1, sleep: "good" }))).toBe(15);
    expect(readinessScore(checkin({ energy: 1, soreness: 5, sleep: "bad" }))).toBe(3);
    expect(readinessScore(checkin({ energy: 3, soreness: 3, sleep: "ok" }))).toBe(9);
  });

  test("Health Connect sleep under 6 h counts as bad", () => {
    expect(readinessScore(checkin({ energy: 5, soreness: 1, sleep: "good", hcSleepMin: 359 }))).toBe(11);
    expect(readinessScore(checkin({ energy: 5, soreness: 1, sleep: "good", hcSleepMin: 360 }))).toBe(15);
  });

  test("modes: 11 or more full, 7 to 10 trimmed, 6 or less recovery", () => {
    expect(readinessMode(11)).toBe("full");
    expect(readinessMode(10)).toBe("trimmed");
    expect(readinessMode(7)).toBe("trimmed");
    expect(readinessMode(6)).toBe("recovery");
  });
});

describe("blocks and deload", () => {
  const programme = generatePlan(input(), V_TAPER_LEAN_GAIN);

  test("block week counts 7-day weeks from the block start", () => {
    expect(blockWeek(programme, "2026-11-02")).toBe(1);
    expect(blockWeek(programme, "2026-11-08")).toBe(1);
    expect(blockWeek(programme, "2026-11-09")).toBe(2);
    expect(blockWeek(programme, "2026-11-30")).toBe(5);
    expect(blockWeek(programme, "2026-12-07")).toBe(6);
  });

  test("an early deload is week 5 for 7 days, then the block ends", () => {
    const early = { ...programme, earlyDeloadFrom: "2026-11-12" };
    expect(blockWeek(early, "2026-11-11")).toBe(2);
    expect(blockWeek(early, "2026-11-12")).toBe(5);
    expect(blockWeek(early, "2026-11-18")).toBe(5);
    expect(blockWeek(early, "2026-11-19")).toBe(6);
  });

  test("week 5 is the planned deload", () => {
    const s = deloadStatus(input({ programme, today: "2026-11-30" }));
    expect(s).toMatchObject({ deload: true, kind: "planned", startEarly: false });
  });

  test("4 of the last 7 check-ins at Trimmed or worse start an early deload", () => {
    const low = (d: number, energy: number) =>
      checkin({ date: addDays("2026-11-02", d), energy, soreness: 4, sleep: "ok" });
    // energy 1 → 1 + 2 + 3 = 6 (recovery); energy 5 → 5 + 2 + 3 = 10 (trimmed); energy 5 with good sleep → full.
    const four = [low(0, 1), low(1, 5), low(2, 1), low(3, 5)];
    const s = deloadStatus(
      input({ programme, today: "2026-11-06", history: { ...emptyHistory(), checkins: four } }),
    );
    expect(s).toMatchObject({ deload: false, startEarly: true });
    expect(s.reasons[0]?.ruleId).toBe("DELOAD_EARLY_READINESS");

    const three = four.slice(1);
    expect(
      deloadStatus(input({ programme, history: { ...emptyHistory(), checkins: three } })).startEarly,
    ).toBe(false);
  });

  test("check-ins from before the block start do not count", () => {
    const low = (d: number) =>
      checkin({ date: addDays("2026-10-28", d), energy: 1, soreness: 5, sleep: "bad" });
    const rows = [low(0), low(1), low(2), low(3)]; // 28 to 31 October, before the block
    expect(
      deloadStatus(input({ programme, history: { ...emptyHistory(), checkins: rows } })).startEarly,
    ).toBe(false);
  });

  test("only the last 7 check-ins count", () => {
    const low = (d: number) =>
      checkin({ date: addDays("2026-11-02", d), energy: 1, soreness: 5, sleep: "bad" });
    const ok = (d: number) =>
      checkin({ date: addDays("2026-11-02", d), energy: 5, soreness: 1, sleep: "good" });
    const rows = [low(0), low(1), low(2), low(3), ok(4), ok(5), ok(6), ok(7)];
    expect(
      deloadStatus(input({ programme, history: { ...emptyHistory(), checkins: rows } })).startEarly,
    ).toBe(false);
  });

  test("2 families in P5 at once start an early deload; 1 does not", () => {
    const stalled = (family: string): ProgressState => ({
      family,
      rung: 1,
      streaks: { top: 0, miss: 0, stall: 3, hold: 0 },
    });
    const two = { ...emptyHistory(), progress: [stalled("row"), stalled("squat")] };
    const s = deloadStatus(input({ programme, history: two }));
    expect(s.startEarly).toBe(true);
    expect(s.reasons[0]?.ruleId).toBe("DELOAD_EARLY_STALL");
    const one = { ...emptyHistory(), progress: [stalled("row")] };
    expect(deloadStatus(input({ programme, history: one })).startEarly).toBe(false);
  });

  test("no early start while a deload runs", () => {
    const stalled = (family: string): ProgressState => ({
      family,
      rung: 1,
      streaks: { top: 0, miss: 0, stall: 3, hold: 0 },
    });
    const h = { ...emptyHistory(), progress: [stalled("row"), stalled("squat")] };
    expect(deloadStatus(input({ programme, history: h, today: "2026-11-30" })).startEarly).toBe(false);
  });
});
