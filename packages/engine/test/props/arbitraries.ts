// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared fast-check arbitraries for the engine properties.
import { JOINTS, SEVERITIES } from "@vee/catalogue";
import fc from "fast-check";
import { type EngineInput, emptyHistory, type Flag, type KitItem, type ProgressState } from "../../src";
import { catalogue, input } from "../helpers";

export const RUNS = { numRuns: 1000 };

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

export const kit = fc
  .tuple(
    fc.option(dialDb, { nil: undefined }),
    fc.option(fixedDb, { nil: undefined }),
    fc.option(kettlebell, { nil: undefined }),
    fc.option(band("band-1"), { nil: undefined }),
    fc.option(band("band-2"), { nil: undefined }),
    fc.option(station, { nil: undefined }),
  )
  .map((items) => items.filter((i): i is KitItem => i !== undefined));

export const flags = fc.uniqueArray(
  fc.record({
    joint: fc.constantFrom(...JOINTS),
    severity: fc.constantFrom(...SEVERITIES),
    activeFrom: fc.constantFrom("2026-01-01", "2026-12-01"),
  }),
  { maxLength: 3, selector: (f) => f.joint },
);

export const progress = fc
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

export const engineInput = fc
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
      history: { ...emptyHistory(), progress },
      profile: { ...input().profile, minutesPerSession: minutes },
    }) as EngineInput,
    week,
  }));
