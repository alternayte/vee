// SPDX-License-Identifier: AGPL-3.0-or-later
// V3: engine properties, 1,000 runs each.
import fc from "fast-check";
import { describe, test } from "vitest";
import { checkAllowed, estimateSeconds, generatePlan, loadOptions, V_TAPER_LEAN_GAIN } from "../../src";
import { catalogue, ex } from "../helpers";
import { engineInput, RUNS } from "./arbitraries";

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
