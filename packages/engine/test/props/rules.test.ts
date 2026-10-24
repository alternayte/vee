// SPDX-License-Identifier: AGPL-3.0-or-later
// V3: progression and prescription properties, 1,000 runs each.
import type { Exercise } from "@vee/catalogue";
import fc from "fast-check";
import { describe, test } from "vitest";
import {
  bandOptions,
  checkAllowed,
  type Effort,
  estimateSeconds,
  evaluate,
  generatePlan,
  isBigJump,
  type KitItem,
  type LoggedSet,
  loadOptions,
  type PrescribedItem,
  type ProgressState,
  prescribe,
  type ReadinessMode,
  type SessionRecord,
  V_TAPER_LEAN_GAIN,
} from "../../src";
import { catalogue, ex } from "../helpers";
import { engineInput, flags, kit, RUNS } from "./arbitraries";

const exercise = fc.constantFrom(...catalogue.exercises.filter((e) => e.pattern !== "mobility"));
const effort = fc.constantFrom<Effort>("easy", "good", "hard", "failed");

/** A state on the exercise, with a load, band or hold the kit allows. */
function stateFor(e: Exercise, k: KitItem[]) {
  const loads = loadOptions(e, k);
  const bands = bandOptions(e, k);
  return fc
    .record({
      load: loads.length > 0 ? fc.constantFrom(...loads) : fc.constant(undefined),
      band: bands.length > 0 ? fc.constantFrom(...bands) : fc.constant(undefined),
      stage: fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const),
      hold: fc.integer({ min: e.default.seconds?.[0] ?? 1, max: e.default.seconds?.[1] ?? 1 }),
      top: fc.integer({ min: 0, max: 3 }),
      miss: fc.integer({ min: 0, max: 3 }),
      stall: fc.integer({ min: 0, max: 4 }),
      best: fc.option(fc.integer({ min: 0, max: 30 }), { nil: undefined }),
    })
    .map((r): ProgressState => {
      const s: ProgressState = {
        family: e.family,
        rung: e.rung,
        exerciseId: e.id,
        streaks: { top: r.top, miss: r.miss, stall: r.stall, hold: r.top },
      };
      if (r.load !== undefined) s.loadKg = r.load;
      if (r.band !== undefined) s.band = { bandId: r.band.bandId, setting: r.band.setting };
      if (e.load === "dial" || e.load === "fixed") s.tempoStage = r.stage;
      if (e.load === "timed") s.holdS = r.hold;
      if (r.best !== undefined) s.best = r.best;
      return s;
    });
}

function itemFor(e: Exercise, s: ProgressState, sets: number): PrescribedItem {
  const r = { ruleId: "T", inputs: {}, text: "T." };
  const target =
    e.load === "timed"
      ? { unit: "seconds" as const, low: s.holdS ?? 1, high: s.holdS ?? 1 }
      : { unit: "reps" as const, low: e.default.reps?.[0] ?? 1, high: e.default.reps?.[1] ?? 1 };
  return {
    order: 1,
    family: e.family,
    exerciseId: e.id,
    role: "main",
    sets,
    target,
    restS: 60,
    reasons: { exercise: r, sets: [r], target: r },
  };
}

const scenario = fc
  .record({ e: exercise, k: kit, f: flags, sets: fc.integer({ min: 1, max: 4 }) })
  .chain(({ e, k, f, sets }) =>
    fc.record({
      e: fc.constant(e),
      k: fc.constant(k),
      f: fc.constant(f),
      sets: fc.constant(sets),
      state: stateFor(e, k),
      logged: fc.array(fc.record({ v: fc.integer({ min: 0, max: 70 }), effort }), {
        minLength: 1,
        maxLength: sets * (e.unilateral ? 2 : 1),
      }),
      mode: fc.constantFrom<ReadinessMode>("full", "trimmed", "recovery"),
    }),
  );

type Scenario = typeof scenario extends fc.Arbitrary<infer T> ? T : never;

function runEval(x: Scenario, mode: ReadinessMode) {
  const session: SessionRecord = {
    id: "s",
    kind: "main",
    status: "done",
    date: "2026-11-02",
    readinessMode: mode,
  };
  const rows: LoggedSet[] = x.logged.map((l, i) => ({
    id: `r${i}`,
    sessionId: "s",
    exerciseId: x.e.id,
    ...(x.e.load === "timed" ? { seconds: l.v } : { reps: l.v }),
    effort: l.effort,
    loggedAt: "2026-11-02T19:00:00Z",
  }));
  const ctx = { catalogue, kit: x.k, flags: x.f, today: "2026-11-02" };
  return evaluate(ctx, x.state, itemFor(x.e, x.state, x.sets), rows, session);
}

describe("progression properties", () => {
  test("P2 never fires on a Trimmed or Recovery session, and the state does not change", () => {
    fc.assert(
      fc.property(scenario, (x) =>
        (["trimmed", "recovery"] as const).every((mode) => {
          const r = runEval(x, mode);
          return (
            JSON.stringify(r.next) === JSON.stringify(x.state) &&
            r.reasons.every((y) => !y.ruleId.startsWith("P2"))
          );
        }),
      ),
      RUNS,
    );
  });

  test("I6: a new exercise after a step is one the kit and flags allow", () => {
    fc.assert(
      fc.property(scenario, (x) => {
        const next = runEval(x, "full").next;
        if (next.exerciseId === x.state.exerciseId) return true;
        return checkAllowed(ex(next.exerciseId as string), x.k, x.f, "2026-11-02").ok;
      }),
      RUNS,
    );
  });

  test("a load is always one the kit can set", () => {
    fc.assert(
      fc.property(scenario, (x) => {
        const next = runEval(x, "full").next;
        if (next.loadKg === undefined) return true;
        return loadOptions(ex(next.exerciseId as string), x.k).includes(next.loadKg);
      }),
      RUNS,
    );
  });

  test("a load jump above 15% happens only after every micro-step", () => {
    fc.assert(
      fc.property(scenario, (x) => {
        const next = runEval(x, "full").next;
        const from = x.state.loadKg;
        const to = next.loadKg;
        if (next.exerciseId !== x.state.exerciseId || from === undefined || to === undefined || to <= from)
          return true;
        return !isBigJump(from, to) || x.state.tempoStage === 3;
      }),
      RUNS,
    );
  });

  test("a step moves at most one rung", () => {
    fc.assert(
      fc.property(scenario, (x) => Math.abs(runEval(x, "full").next.rung - x.state.rung) <= 1),
      RUNS,
    );
  });
});

describe("prescription properties", () => {
  const presc = fc
    .record({
      at: engineInput,
      readiness: fc.constantFrom<ReadinessMode>("full", "trimmed", "recovery"),
      minutes: fc.option(fc.integer({ min: 15, max: 60 }), { nil: undefined }),
      day: fc.integer({ min: 0, max: 3 }),
    })
    .map(({ at, readiness, minutes, day }) => {
      const programme = generatePlan(at.input, V_TAPER_LEAN_GAIN, at.week);
      const input = { ...at.input, programme };
      const template = programme.templates[day] as (typeof programme.templates)[number];
      return {
        input,
        p: prescribe(input, template, { readiness, ...(minutes ? { minutes } : {}) }),
        minutes,
      };
    });

  test("I6, loads and time: every prescription respects kit, flags, load options and minutes", () => {
    fc.assert(
      fc.property(presc, ({ input, p, minutes }) => {
        const limit = (p.kind === "recovery" ? 15 : (minutes ?? input.profile.minutesPerSession)) * 60;
        return (
          estimateSeconds(p.items, catalogue) <= limit &&
          p.items.every((i) => {
            const e = ex(i.exerciseId);
            const options = loadOptions(e, input.kit);
            return (
              checkAllowed(e, input.kit, input.flags, input.today).ok &&
              (i.loadKg === undefined ? options.length === 0 : options.includes(i.loadKg)) &&
              i.reasons.sets.length > 0 &&
              (i.loadKg === undefined || i.reasons.load !== undefined)
            );
          })
        );
      }),
      RUNS,
    );
  });

  test("I2: the same input gives the same prescription", () => {
    fc.assert(
      fc.property(
        engineInput,
        fc.constantFrom<ReadinessMode>("full", "trimmed", "recovery"),
        (at, readiness) => {
          const programme = generatePlan(at.input, V_TAPER_LEAN_GAIN, at.week);
          const t = programme.templates[0] as (typeof programme.templates)[number];
          const a = prescribe({ ...at.input, programme }, t, { readiness });
          const b = prescribe(structuredClone({ ...at.input, programme }), structuredClone(t), { readiness });
          return JSON.stringify(a) === JSON.stringify(b);
        },
      ),
      RUNS,
    );
  });
});
