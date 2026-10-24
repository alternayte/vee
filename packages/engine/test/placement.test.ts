// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import { applyPlacements, emptyHistory, type ProgressState, placeFromTest, type TestResult } from "../src";
import { input } from "./helpers";

const t = (item: TestResult["item"], value: number, extra: Partial<TestResult> = {}): TestResult => ({
  date: "2026-11-02",
  item,
  value,
  ...extra,
});

const rungOf = (placements: ReturnType<typeof placeFromTest>, family: string) =>
  placements.find((p) => p.family === family);

describe("placeFromTest: vertical pull", () => {
  test.each([
    [0, 5, 1],
    [0, 15, 2],
    [0, 20, 3],
    [4, 30, 5],
    [6, 30, 6],
    [12, 60, 6],
  ])("%i pull-ups and a %i s hang → rung %i", (pullups, hang, rung) => {
    const p = placeFromTest(input(), [t("pullups", pullups), t("hang", hang)]);
    expect(rungOf(p, "vertical-pull")?.rung).toBe(rung);
  });

  test("1 to 3 pull-ups → strict pull-up at 1 to 3 reps", () => {
    const p = rungOf(placeFromTest(input(), [t("pullups", 2), t("hang", 30)]), "vertical-pull");
    expect(p).toMatchObject({ rung: 5, repOverride: { low: 1, high: 3 } });
  });

  test("the chin-up ladder follows the pull-up result", () => {
    expect(rungOf(placeFromTest(input(), [t("pullups", 0), t("hang", 25)]), "chin-up")?.rung).toBe(2);
    expect(rungOf(placeFromTest(input(), [t("pullups", 5)]), "chin-up")?.rung).toBe(4);
  });
});

describe("placeFromTest: other ladders", () => {
  test.each([
    ["pushups", 3, "push-up", 1],
    ["pushups", 12, "push-up", 2],
    ["pushups", 25, "push-up", 3],
    ["pushups", 35, "push-up", 4],
    ["dip_hold", 10, "dip", 1],
    ["dip_hold", 30, "dip", 2],
    ["dip_hold", 50, "dip", 3],
    ["plank", 30, "core", 1],
    ["plank", 60, "core", 2],
    ["carry", 20, "carry", 1],
    ["carry", 40, "carry", 2],
  ] as const)("%s %i → %s rung %i", (item, value, family, rung) => {
    expect(rungOf(placeFromTest(input(), [t(item, value)]), family)?.rung).toBe(rung);
  });

  test("goblet squat: 15 or more reps → split squat; fewer keeps the goblet squat and sets the load", () => {
    expect(rungOf(placeFromTest(input(), [t("goblet_squat", 15, { loadKg: 12 })]), "squat")?.rung).toBe(2);
    expect(rungOf(placeFromTest(input(), [t("goblet_squat", 10, { loadKg: 12 })]), "squat")).toMatchObject({
      rung: 1,
      loadKg: 12,
    });
    expect(rungOf(placeFromTest(input(), [t("goblet_squat", 5, { loadKg: 12 })]), "squat")?.loadKg).toBe(10);
  });

  test("burpees and waist place nothing", () => {
    expect(placeFromTest(input(), [t("burpees", 40), t("waist", 82)])).toEqual([]);
  });
});

describe("placement limits", () => {
  const withState = (s: ProgressState) => input({ history: { ...emptyHistory(), progress: [s] } });

  test("a test moves a rung up by at most 2", () => {
    const p = rungOf(
      placeFromTest(withState({ family: "vertical-pull", rung: 1 }), [t("pullups", 8)]),
      "vertical-pull",
    );
    expect(p?.rung).toBe(3);
    expect(p?.reason.ruleId).toBe("PLACE_LIMIT");
  });

  test("a test never moves a rung down", () => {
    const p = placeFromTest(withState({ family: "push-up", rung: 3 }), [t("pushups", 3)]);
    expect(rungOf(p, "push-up")).toBeUndefined();
  });

  test("with no state, the table applies in full", () => {
    expect(rungOf(placeFromTest(input(), [t("pullups", 8)]), "vertical-pull")?.rung).toBe(6);
  });
});

describe("applyPlacements", () => {
  test("enters the placed rung with its starting load, band or hold", () => {
    const placed = placeFromTest(input(), [
      t("pullups", 0),
      t("hang", 12),
      t("dip_hold", 30),
      t("pushups", 12),
    ]);
    const progress = applyPlacements(input(), [], placed);
    expect(progress.find((p) => p.family === "vertical-pull")).toMatchObject({
      rung: 2,
      exerciseId: "scapular-pull",
    });
    expect(progress.find((p) => p.family === "dip")).toMatchObject({ rung: 2, exerciseId: "dip-negative" });
  });

  test("a placed rung the kit rules out falls to the nearest allowed rung below", () => {
    const noBand = input().kit.filter((k) => k.kind !== "band");
    const i = input({ kit: noBand });
    const placed = placeFromTest(i, [t("dip_hold", 50)]);
    const progress = applyPlacements(i, [], placed);
    expect(progress.find((p) => p.family === "dip")).toMatchObject({ rung: 2, exerciseId: "dip-negative" });
  });
});
