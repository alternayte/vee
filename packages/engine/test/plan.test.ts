// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  emptyHistory,
  exposures,
  generatePlan,
  type KitItem,
  MUSCLE_GROUPS,
  type Programme,
  type SessionTemplate,
  V_TAPER_LEAN_GAIN,
  weeklyTargets,
  weeklyVolume,
} from "../src";
import { catalogue, homeKit, input } from "./helpers";

const day = (p: Programme, d: string): SessionTemplate => {
  const t = p.templates.find((x) => x.dayType === d);
  if (!t) throw new Error(`no day ${d}`);
  return t;
};
const ids = (t: SessionTemplate) => t.items.map((i) => i.exerciseId);
const groups = Object.keys(MUSCLE_GROUPS) as (keyof typeof MUSCLE_GROUPS)[];

describe("weeklyTargets", () => {
  test("week 1 is the start value and week 4 is the end value", () => {
    expect(weeklyTargets(V_TAPER_LEAN_GAIN, 1)["lats-upper-back"]).toBe(12);
    expect(weeklyTargets(V_TAPER_LEAN_GAIN, 4)["lats-upper-back"]).toBe(18);
    expect(weeklyTargets(V_TAPER_LEAN_GAIN, 2)["lats-upper-back"]).toBe(14);
    expect(weeklyTargets(V_TAPER_LEAN_GAIN, 3)["side-delts"]).toBe(14);
  });

  test("the V-taper template has the SDD set targets", () => {
    expect(V_TAPER_LEAN_GAIN.weeklySets).toEqual({
      "lats-upper-back": { start: 12, end: 18 },
      "side-delts": { start: 10, end: 16 },
      "rear-delts": { start: 4, end: 8 },
      chest: { start: 6, end: 10 },
      triceps: { start: 4, end: 8 },
      biceps: { start: 4, end: 8 },
      quads: { start: 6, end: 10 },
      "hamstrings-glutes": { start: 4, end: 8 },
      core: { start: 4, end: 6 },
    });
  });
});

describe("generatePlan", () => {
  test("returns the A → B → C → D rotation for block week 1", () => {
    const p = generatePlan(input(), V_TAPER_LEAN_GAIN);
    expect(p.rotation).toEqual(["A", "B", "C", "D"]);
    expect(p.templates.map((t) => t.dayType)).toEqual(["A", "B", "C", "D"]);
    expect(p.blockWeek).toBe(1);
    expect(p.blockStart).toBe("2026-11-02");
    expect(p.engineVersion).toBe(input().engineVersion);
  });

  test("each day starts with its first main family", () => {
    const p = generatePlan(input(), V_TAPER_LEAN_GAIN);
    expect(p.templates.map((t) => t.items[0]?.family)).toEqual(["vertical-pull", "squat", "dip", "chin-up"]);
  });

  test("a new user starts on rung 1", () => {
    const p = generatePlan(input(), V_TAPER_LEAN_GAIN);
    expect(day(p, "A").items[0]?.exerciseId).toBe("dead-hang");
    expect(day(p, "C").items[0]?.exerciseId).toBe("dip-support-hold");
  });

  test("picks the owned rung", () => {
    const p = generatePlan(
      input({ history: { ...emptyHistory(), progress: [{ family: "vertical-pull", rung: 4 }] } }),
      V_TAPER_LEAN_GAIN,
    );
    const first = day(p, "A").items[0];
    expect(first?.exerciseId).toBe("pullup-band-assisted");
    expect(first?.reasons.exercise.ruleId).toBe("PLAN_PICK");
  });

  test("on a rung with alternatives, prefers loaded work the kit allows", () => {
    const p = generatePlan(
      input({ history: { ...emptyHistory(), progress: [{ family: "vertical-pull", rung: 7 }] } }),
      V_TAPER_LEAN_GAIN,
    );
    expect(day(p, "A").items[0]?.exerciseId).toBe("pullup-weighted");
    expect(ids(day(p, "B"))[0]).toBe("goblet-squat");
  });

  test("drops to the nearest rung below when the kit rules out the owned rung", () => {
    const noBand = homeKit.filter((k) => k.kind !== "band");
    const p = generatePlan(
      input({
        kit: noBand,
        history: { ...emptyHistory(), progress: [{ family: "vertical-pull", rung: 4 }] },
      }),
      V_TAPER_LEAN_GAIN,
    );
    const first = day(p, "A").items[0];
    expect(first?.exerciseId).toBe("pullup-negative");
    expect(first?.reasons.exercise.ruleId).toBe("PLAN_PICK_LOWER");
  });

  test("an acute shoulder flag empties the vertical-pull slot and says why", () => {
    const flags = [{ joint: "shoulder", severity: "acute", activeFrom: "2026-10-01" }] as const;
    const p = generatePlan(input({ flags: [...flags] }), V_TAPER_LEAN_GAIN);
    const a = day(p, "A");
    expect(a.items.some((i) => i.family === "vertical-pull")).toBe(false);
    expect(a.reasons.some((r) => r.ruleId === "PLAN_NO_OPTION" && r.inputs.family === "vertical-pull")).toBe(
      true,
    );
  });

  test("loads: start at the lightest, keep the current load, snap to the kit", () => {
    const start = generatePlan(input(), V_TAPER_LEAN_GAIN);
    const goblet = day(start, "B").items[0];
    expect(goblet?.loadKg).toBe(2);
    expect(goblet?.reasons.load?.ruleId).toBe("LOAD_START");

    const kept = generatePlan(
      input({
        history: {
          ...emptyHistory(),
          progress: [{ family: "squat", rung: 1, exerciseId: "goblet-squat", loadKg: 10 }],
        },
      }),
      V_TAPER_LEAN_GAIN,
    );
    expect(day(kept, "B").items[0]?.loadKg).toBe(10);
    expect(day(kept, "B").items[0]?.reasons.load?.ruleId).toBe("LOAD_STATE");

    const snapped = generatePlan(
      input({
        history: {
          ...emptyHistory(),
          progress: [{ family: "squat", rung: 1, exerciseId: "goblet-squat", loadKg: 13 }],
        },
      }),
      V_TAPER_LEAN_GAIN,
    );
    expect(day(snapped, "B").items[0]?.loadKg).toBe(12);
    expect(day(snapped, "B").items[0]?.reasons.load?.ruleId).toBe("LOAD_SNAP");
  });

  test("a load from another exercise is not reused", () => {
    const p = generatePlan(
      input({
        history: {
          ...emptyHistory(),
          progress: [{ family: "squat", rung: 2, exerciseId: "goblet-squat", loadKg: 16 }],
        },
      }),
      V_TAPER_LEAN_GAIN,
    );
    const first = day(p, "B").items[0];
    expect(first?.exerciseId).toBe("split-squat");
    expect(first?.loadKg).toBe(2);
  });

  test("every day fits the planned minutes", () => {
    for (const minutes of [20, 30, 40]) {
      const p = generatePlan(
        input({ profile: { ...input().profile, minutesPerSession: minutes } }),
        V_TAPER_LEAN_GAIN,
      );
      for (const t of p.templates)
        expect(t.estimatedMinutes, `${t.dayType} at ${minutes}`).toBeLessThanOrEqual(minutes);
    }
  });

  test("at 40 minutes, week 1 meets the back and side delt targets", () => {
    const p = generatePlan(input(), V_TAPER_LEAN_GAIN);
    const v = weeklyVolume(p.templates, catalogue);
    expect(v["lats-upper-back"]).toBeGreaterThanOrEqual(12);
    expect(v["side-delts"]).toBeGreaterThanOrEqual(10);
  });

  test("back and side delts get the most weekly sets", () => {
    const v = weeklyVolume(generatePlan(input(), V_TAPER_LEAN_GAIN).templates, catalogue);
    const top = [...groups].sort((a, b) => v[b] - v[a]).slice(0, 2);
    expect(new Set(top)).toEqual(new Set(["lats-upper-back", "side-delts"]));
  });

  test("at 40 minutes, every group gets at least 2 exposures a week", () => {
    const e = exposures(generatePlan(input(), V_TAPER_LEAN_GAIN).templates, catalogue);
    for (const g of groups) expect(e[g], g).toBeGreaterThanOrEqual(2);
  });

  test("week 4 has more sets than week 1", () => {
    const long = input({ profile: { ...input().profile, minutesPerSession: 60 } });
    const total = (w: number) =>
      generatePlan(long, V_TAPER_LEAN_GAIN, w)
        .templates.flatMap((t) => t.items)
        .reduce((s, i) => s + i.sets, 0);
    expect(total(4)).toBeGreaterThan(total(1));
  });

  test("every number carries a reason with filled text", () => {
    const p = generatePlan(input(), V_TAPER_LEAN_GAIN);
    for (const i of p.templates.flatMap((t) => t.items)) {
      expect(i.reasons.sets.length).toBeGreaterThan(0);
      if (i.loadKg !== undefined) expect(i.reasons.load).toBeDefined();
      const all = [
        i.reasons.exercise,
        i.reasons.target,
        ...i.reasons.sets,
        ...(i.reasons.load ? [i.reasons.load] : []),
      ];
      for (const r of all) expect(r.text).not.toMatch(/[{}]/);
    }
  });

  test("a kit with no station and no dumbbell still gives four sessions", () => {
    const bandOnly: KitItem[] = [{ id: "b", kind: "band", count: 1, params: { colour: "green", estKg: 20 } }];
    const p = generatePlan(input({ kit: bandOnly }), V_TAPER_LEAN_GAIN);
    expect(p.templates).toHaveLength(4);
    for (const t of p.templates) expect(t.items.length).toBeGreaterThan(0);
  });
});
