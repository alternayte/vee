// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import { aimFor, type PrescribedItem, type Prescription, type ProgressState, sessionSteps } from "../src";
import { catalogue } from "./helpers";

const item = (over: Partial<PrescribedItem>): PrescribedItem => ({
  order: 0,
  family: "row",
  exerciseId: "row-single-arm-db",
  role: "main",
  sets: 2,
  target: { unit: "reps", low: 8, high: 12 },
  restS: 90,
  reasons: {
    exercise: { ruleId: "x", inputs: {}, text: "x" },
    sets: [],
    target: { ruleId: "x", inputs: {}, text: "x" },
  },
  ...over,
});

const rx = (items: PrescribedItem[]): Prescription => ({
  kind: "main",
  readinessMode: "full",
  deload: false,
  engineVersion: "t",
  warmup: [],
  items,
  estimatedMinutes: 30,
  reasons: [],
});

describe("aimFor", () => {
  const state = (best?: number): ProgressState => ({
    family: "row",
    rung: 1,
    ...(best === undefined ? {} : { best }),
  });

  test("no history aims at the bottom of the range", () => {
    expect(aimFor(item({}), undefined)).toBe(8);
  });

  test("inside the range it aims one past the best set, at most the top", () => {
    expect(aimFor(item({}), state(9))).toBe(10);
    expect(aimFor(item({}), state(12))).toBe(12);
    expect(aimFor(item({}), state(5))).toBe(8);
  });

  test("a hold aims at its target seconds", () => {
    expect(aimFor(item({ target: { unit: "seconds", low: 20, high: 20 } }), state(15))).toBe(20);
  });
});

describe("sessionSteps", () => {
  test("a single-arm exercise logs each side, with a side switch and no rest between", () => {
    const steps = sessionSteps(rx([item({ sets: 2 })]), catalogue);
    expect(steps.map((s) => [s.item, s.set, s.side, s.restS])).toEqual([
      [0, 1, "left", 0],
      [0, 1, "right", 90],
      [0, 2, "left", 0],
      [0, 2, "right", 0],
    ]);
  });

  test("a pair alternates set by set, then the next exercise follows", () => {
    const steps = sessionSteps(
      rx([
        item({ exerciseId: "goblet-squat", family: "squat", sets: 2, pairGroup: 1, restS: 60 }),
        item({ exerciseId: "dead-bug", family: "core", role: "accessory", sets: 2, pairGroup: 1, restS: 60 }),
        item({ exerciseId: "glute-bridge", family: "hinge", role: "accessory", sets: 1, restS: 60 }),
      ]),
      catalogue,
    );
    expect(steps.map((s) => [s.item, s.set])).toEqual([
      [0, 1],
      [1, 1],
      [0, 2],
      [1, 2],
      [2, 1],
    ]);
    expect(steps.at(-1)?.restS).toBe(0);
  });
});
