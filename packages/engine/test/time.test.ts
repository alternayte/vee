// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  DIAL_CHANGE_S,
  dialChanges,
  estimateSeconds,
  orderForDial,
  PAIR_REST_S,
  REP_S,
  type TemplateItem,
  TRANSITION_S,
  timeCut,
  WARMUP_S,
} from "../src";
import { catalogue, ex } from "./helpers";

const noReason = { ruleId: "TEST", inputs: {}, text: "Test." };

function item(exerciseId: string, over: Partial<TemplateItem> = {}): TemplateItem {
  const e = ex(exerciseId);
  const range = e.default.reps ?? e.default.seconds ?? [1, 1];
  return {
    order: 0,
    family: e.family,
    exerciseId,
    role: "accessory",
    sets: 2,
    target: { unit: e.default.reps ? "reps" : "seconds", low: range[0], high: range[1] },
    reasons: { exercise: noReason, sets: [noReason], target: noReason },
    ...over,
  };
}

describe("time model", () => {
  test("constants match the SDD", () => {
    expect([REP_S, DIAL_CHANGE_S, PAIR_REST_S]).toEqual([3.5, 8, 45]);
  });

  test("sets × (work + rest) + transitions + dial changes + warm-up", () => {
    const items = [
      item("goblet-squat", { role: "main", sets: 3, loadKg: 10 }),
      item("split-squat", { sets: 2, loadKg: 12 }),
    ];
    // goblet: 3 × (10 reps × 3.5 + 120); split squat is unilateral: 2 × (2 × 35 + 120).
    const expected = WARMUP_S + 3 * (35 + 120) + 2 * (70 + 120) + 2 * TRANSITION_S + 1 * DIAL_CHANGE_S;
    expect(estimateSeconds(items, catalogue)).toBe(expected);
  });

  test("timed work uses the middle of the seconds range", () => {
    const items = [item("plank", { sets: 3 })]; // 20–60 s → 40 s, rest 60
    expect(estimateSeconds(items, catalogue)).toBe(WARMUP_S + 3 * (40 + 60) + TRANSITION_S);
  });

  test("paired items rest 45 s", () => {
    const items = [
      item("curl-db", { pairGroup: 1, loadKg: 8 }), // unilateral, 10 reps → 70 s
      item("triceps-pushdown-band", { pairGroup: 1 }), // 16 reps → 56 s
    ];
    expect(estimateSeconds(items, catalogue)).toBe(
      WARMUP_S + 2 * (70 + 45) + 2 * (56 + 45) + 2 * TRANSITION_S,
    );
  });
});

describe("dial changes", () => {
  test("a pair of dumbbell items at two loads changes the dial on every set", () => {
    const items = [
      item("curl-db", { pairGroup: 1, loadKg: 8 }),
      item("triceps-overhead-db", { pairGroup: 1, loadKg: 6 }),
    ];
    expect(dialChanges(items, catalogue)).toBe(3);
  });

  test("band work between dumbbell sets does not change the dial", () => {
    const items = [
      item("curl-db", { pairGroup: 1, loadKg: 8 }),
      item("triceps-pushdown-band", { pairGroup: 1 }),
    ];
    expect(dialChanges(items, catalogue)).toBe(0);
  });

  test("ordering groups equal loads and keeps mains first", () => {
    const items = [
      item("row-single-arm-db", { role: "main", order: 1, sets: 3, loadKg: 12 }),
      item("curl-db", { order: 2, loadKg: 8 }),
      item("lateral-raise-db", { order: 3, loadKg: 4 }),
      item("rear-delt-raise-db", { order: 4, loadKg: 8 }),
    ];
    const ordered = orderForDial(items, catalogue);
    expect(ordered[0]?.exerciseId).toBe("row-single-arm-db");
    expect(dialChanges(ordered, catalogue)).toBe(2);
    expect(dialChanges(items, catalogue)).toBe(3);
    expect(ordered.map((i) => i.order)).toEqual([1, 2, 3, 4]);
  });
});

describe("time cut", () => {
  const day = () => [
    item("dip-full", { role: "main", sets: 4 }),
    item("pushup-floor", { role: "main", sets: 4 }),
    item("press-half-kneeling-db", { sets: 3, loadKg: 6 }),
    item("lateral-raise-db", { sets: 3, loadKg: 4 }),
    item("triceps-pushdown-band", { sets: 3 }),
    item("split-squat", { sets: 3, loadKg: 10 }),
  ];

  test("no change when the session fits", () => {
    const r = timeCut(day(), 120, catalogue);
    expect(r.items.map((i) => i.exerciseId)).toEqual(day().map((i) => i.exerciseId));
    expect(r.reasons).toEqual([]);
  });

  test("cuts in the SDD order: drop, pair, accessory sets, main sets", () => {
    const r = timeCut(day(), 25, catalogue);
    const ids = r.reasons.map((x) => x.ruleId);
    expect(ids.slice(0, 4)).toEqual([
      "TIME_CUT_DROP",
      "TIME_CUT_PAIR",
      "TIME_CUT_ACCESSORY_SETS",
      "TIME_CUT_MAIN_SETS",
    ]);
    expect(r.reasons[0]?.inputs.exercise).toBe("split-squat");
    expect(estimateSeconds(r.items, catalogue)).toBeLessThanOrEqual(25 * 60);
  });

  test("the drop step removes only the last accessory", () => {
    const r = timeCut(day(), 33, catalogue);
    expect(r.reasons.map((x) => x.ruleId)[0]).toBe("TIME_CUT_DROP");
    expect(r.items.map((i) => i.exerciseId)).not.toContain("split-squat");
    expect(r.items.map((i) => i.exerciseId)).toContain("triceps-pushdown-band");
  });

  test("the first main movement is never removed", () => {
    const r = timeCut(day(), 5, catalogue);
    expect(r.items[0]?.exerciseId).toBe("dip-full");
    expect(r.items[0]?.sets).toBeGreaterThanOrEqual(1);
  });

  test("each changed item carries the cut reason", () => {
    const r = timeCut(day(), 25, catalogue);
    const dip = r.items.find((i) => i.exerciseId === "dip-full");
    expect(dip?.reasons.sets.map((x) => x.ruleId)).toContain("TIME_CUT_MAIN_SETS");
  });

  test("15 minutes always fits", () => {
    const r = timeCut(day(), 15, catalogue);
    expect(estimateSeconds(r.items, catalogue)).toBeLessThanOrEqual(15 * 60);
  });
});
