// SPDX-License-Identifier: AGPL-3.0-or-later
// V3: engine properties, 1,000 runs each.
import { JOINTS, SEVERITIES } from "@vee/catalogue";
import fc from "fast-check";
import { describe, test } from "vitest";
import {
  checkAllowed,
  type EngineInput,
  estimateSeconds,
  type Flag,
  generatePlan,
  type KitItem,
  loadOptions,
  type ProgressState,
  V_TAPER_LEAN_GAIN,
} from "../../src";
import { catalogue, ex, input } from "../helpers";

const RUNS = { numRuns: 1000 };

const dialDb = fc
  .record({
    min: fc.integer({ min: 1, max: 10 }),
    step: fc.constantFrom(0.5, 1, 1.25, 2, 2.5, 5),
    steps: fc.integer({ min: 1, max: 20 }),
    count: fc.constantFrom(1 as const, 2 as const),
  })
  .map(
    ({ min, step, steps, count }): KitItem => ({
      id: "dial",
      kind: "dial_db",
      count,
      params: { min, max: min + step * steps, step },
    }),
  );

const weights = fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 6 });

const fixedDb = fc
  .record({ weights, count: fc.constantFrom(1 as const, 2 as const) })
  .map(({ weights, count }): KitItem => ({ id: "fixed", kind: "fixed_db", count, params: { weights } }));

const kettlebell = weights.map(
  (w): KitItem => ({ id: "kb", kind: "kettlebell", count: 1, params: { weights: w } }),
);

const band = (id: string) =>
  fc
    .integer({ min: 5, max: 40 })
    .map((estKg): KitItem => ({ id, kind: "band", count: 1, params: { colour: "any", estKg } }));

const station = fc.record({ neutral: fc.boolean(), dipHandles: fc.boolean() }).map(
  ({ neutral, dipHandles }): KitItem => ({
    id: "station",
    kind: "pullup_station",
    count: 1,
    params: { grips: neutral ? ["straight", "neutral"] : ["straight"], dipHandles },
  }),
);

const kit = fc
  .tuple(
    fc.option(dialDb, { nil: undefined }),
    fc.option(fixedDb, { nil: undefined }),
    fc.option(kettlebell, { nil: undefined }),
    fc.option(band("band-1"), { nil: undefined }),
    fc.option(band("band-2"), { nil: undefined }),
    fc.option(station, { nil: undefined }),
  )
  .map((items) => items.filter((i): i is KitItem => i !== undefined));

const flags = fc.uniqueArray(
  fc.record({
    joint: fc.constantFrom(...JOINTS),
    severity: fc.constantFrom(...SEVERITIES),
    activeFrom: fc.constantFrom("2026-01-01", "2026-12-01"),
  }),
  { maxLength: 3, selector: (f) => f.joint },
);

const progress = fc
  .array(
    fc.constantFrom(...catalogue.families).chain((f) =>
      fc.record({
        family: fc.constant(f.id),
        rung: fc.integer({ min: 1, max: f.rungs }),
        loadKg: fc.option(fc.integer({ min: 1, max: 60 }), { nil: undefined }),
      }),
    ),
    { maxLength: 8 },
  )
  .map((rows) =>
    rows.map((r): ProgressState => {
      const pick = catalogue.exercises.find((e) => e.family === r.family && e.rung === r.rung);
      return r.loadKg === undefined || !pick
        ? { family: r.family, rung: r.rung }
        : { family: r.family, rung: r.rung, exerciseId: pick.id, loadKg: r.loadKg };
    }),
  );

const engineInput = fc
  .record({
    kit,
    flags,
    progress,
    minutes: fc.integer({ min: 15, max: 90 }),
    week: fc.integer({ min: 1, max: 4 }),
  })
  .map(({ kit, flags, progress, minutes, week }) => ({
    input: input({
      kit,
      flags: flags as Flag[],
      history: { progress },
      profile: { ...input().profile, minutesPerSession: minutes },
    }) as EngineInput,
    week,
  }));

describe("plan properties", () => {
  test("I2: the same input gives the same plan", () => {
    fc.assert(
      fc.property(engineInput, ({ input, week }) => {
        const a = generatePlan(input, V_TAPER_LEAN_GAIN, week);
        const b = generatePlan(structuredClone(input), V_TAPER_LEAN_GAIN, week);
        return JSON.stringify(a) === JSON.stringify(b);
      }),
      RUNS,
    );
  });

  test("I6: no exercise that the kit or flags rule out", () => {
    fc.assert(
      fc.property(engineInput, ({ input, week }) =>
        generatePlan(input, V_TAPER_LEAN_GAIN, week)
          .templates.flatMap((t) => t.items)
          .every((i) => checkAllowed(ex(i.exerciseId), input.kit, input.flags, input.today).ok),
      ),
      RUNS,
    );
  });

  test("no load outside loadOptions, and loaded work always has a load", () => {
    fc.assert(
      fc.property(engineInput, ({ input, week }) =>
        generatePlan(input, V_TAPER_LEAN_GAIN, week)
          .templates.flatMap((t) => t.items)
          .every((i) => {
            const options = loadOptions(ex(i.exerciseId), input.kit);
            return i.loadKg === undefined ? options.length === 0 : options.includes(i.loadKg);
          }),
      ),
      RUNS,
    );
  });

  test("the time model is never above the planned minutes", () => {
    fc.assert(
      fc.property(engineInput, ({ input, week }) =>
        generatePlan(input, V_TAPER_LEAN_GAIN, week).templates.every(
          (t) =>
            t.estimatedMinutes <= input.profile.minutesPerSession &&
            estimateSeconds(t.items, catalogue) <= input.profile.minutesPerSession * 60,
        ),
      ),
      RUNS,
    );
  });

  test("a day that has a main movement starts with one", () => {
    fc.assert(
      fc.property(engineInput, ({ input, week }) =>
        generatePlan(input, V_TAPER_LEAN_GAIN, week).templates.every(
          (t) => !t.items.some((i) => i.role === "main") || t.items[0]?.role === "main",
        ),
      ),
      RUNS,
    );
  });
});
