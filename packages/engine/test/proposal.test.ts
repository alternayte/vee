// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  type DayType,
  type EngineInput,
  emptyHistory,
  generatePlan,
  type PlanChange,
  type Programme,
  substitute,
  swapByUser,
  V_TAPER_LEAN_GAIN,
  validateProposal,
} from "../src";
import { input } from "./helpers";

function withPlan(over: Partial<EngineInput> = {}): EngineInput & { programme: Programme } {
  const i = input(over);
  return { ...i, programme: generatePlan(i, V_TAPER_LEAN_GAIN) };
}

const dayA = (p: Programme) => p.templates.find((t) => t.dayType === "A");

/** Marks the plan's movements of these families as stalled for `sessions`. */
function stalled<T extends EngineInput & { programme: Programme }>(
  i: T,
  families: string[],
  sessions = 3,
): T {
  const items = i.programme.templates.flatMap((t) => t.items);
  const progress = families.map((family) => {
    const item = items.find((x) => x.family === family);
    if (!item) throw new Error(`no ${family} in plan`);
    return {
      family,
      rung: 1,
      exerciseId: item.exerciseId,
      streaks: { top: 0, miss: 0, stall: sessions, hold: 0 },
    };
  });
  return { ...i, history: { ...i.history, progress } };
}

describe("validateProposal", () => {
  test("a swap to an allowed exercise on the same ladder and rung applies", () => {
    const i = stalled(withPlan(), ["row"]);
    const before = dayA(i.programme)?.items.find((x) => x.family === "row");
    expect(before).toBeDefined();
    const r = validateProposal(i, { kind: "swap", dayType: "A", family: "row", to: "row-band" });
    if (!r.ok) throw new Error(r.reason.text);
    const after = dayA(r.programme)?.items.find((x) => x.family === "row");
    expect(after?.exerciseId).toBe("row-band");
    expect(after?.sets).toBe(before?.sets);
    expect(after?.reasons.exercise.ruleId).toBe("PROPOSAL_SWAP");
  });

  test("a swap or one more set for a movement stalled for fewer than 3 sessions is refused", () => {
    const i = stalled(withPlan({ profile: { ...input().profile, minutesPerSession: 90 } }), ["row"], 2);
    const row = dayA(i.programme)?.items.find((x) => x.family === "row");
    if (!row) throw new Error("no row");
    const changes: PlanChange[] = [
      { kind: "swap", dayType: "A", family: "row", to: "row-band" },
      { kind: "sets", dayType: "A", exerciseId: row.exerciseId, sets: row.sets + 1 },
    ];
    for (const c of changes) {
      const r = validateProposal(i, c);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.ruleId).toBe("PROPOSAL_NOT_STALLED");
    }
  });

  test("a stalled movement gets one more set, not two", () => {
    const plan = withPlan({ profile: { ...input().profile, minutesPerSession: 90 } });
    const sets = (dayType: DayType, exerciseId: string, n: number): PlanChange => ({
      kind: "sets",
      dayType,
      exerciseId,
      sets: n,
    });
    const fits = plan.programme.templates
      .flatMap((t) => t.items.map((x) => ({ t, x, i: stalled(plan, [x.family]) })))
      .find(({ t, x, i }) => validateProposal(i, sets(t.dayType, x.exerciseId, x.sets + 1)).ok);
    if (!fits) throw new Error("no movement takes one more set");
    const two = validateProposal(fits.i, sets(fits.t.dayType, fits.x.exerciseId, fits.x.sets + 2));
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.reason.ruleId).toBe("PROPOSAL_SETS_STEP");
  });

  test("a swap to a higher rung than the user owns is refused", () => {
    const r = validateProposal(withPlan(), {
      kind: "swap",
      dayType: "A",
      family: "vertical-pull",
      to: "pullup-strict",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("rung");
  });

  test("a swap to an exercise the kit does not allow is refused", () => {
    const noBand = input().kit.filter((k) => k.kind !== "band");
    const r = validateProposal(withPlan({ kit: noBand }), {
      kind: "swap",
      dayType: "A",
      family: "row",
      to: "row-band",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("kit");
  });

  test("a swap to another family's exercise is refused", () => {
    const r = validateProposal(withPlan(), { kind: "swap", dayType: "A", family: "row", to: "goblet-squat" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("family");
  });

  test("fewer sets apply; sets that do not fit the minutes are refused", () => {
    const plan = withPlan({ profile: { ...input().profile, minutesPerSession: 35 } });
    const first = dayA(plan.programme)?.items[0];
    if (!first) throw new Error("no item");
    const i = stalled(plan, [first.family]);
    const down = validateProposal(i, { kind: "sets", dayType: "A", exerciseId: first.exerciseId, sets: 2 });
    expect(down.ok).toBe(true);
    if (down.ok) expect(dayA(down.programme)?.items[0]?.sets).toBe(2);
    const up = validateProposal(i, {
      kind: "sets",
      dayType: "A",
      exerciseId: first.exerciseId,
      sets: first.sets + 1,
    });
    expect(up.ok).toBe(false);
    if (!up.ok) expect(up.code).toBe("time");
  });

  test("sets above the volume limit are refused even when time allows", () => {
    const plan = withPlan({ profile: { ...input().profile, minutesPerSession: 90 } });
    const curl = plan.programme.templates
      .flatMap((t) => t.items.map((x) => ({ t, x })))
      .find((p) => p.x.exerciseId.startsWith("curl"));
    if (!curl) throw new Error("no curl");
    const long = stalled(plan, [curl.x.family]);
    const r = validateProposal(long, {
      kind: "sets",
      dayType: curl.t.dayType,
      exerciseId: curl.x.exerciseId,
      sets: curl.x.sets + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("volume");
  });

  test("an early deload with no stalls and no low check-ins is refused", () => {
    const r = validateProposal(withPlan(), { kind: "deload" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.ruleId).toBe("PROPOSAL_DELOAD_NOT_NEEDED");
  });

  test("an early deload needs 2 movements stalled for 3 sessions", () => {
    const r = validateProposal(stalled(withPlan(), ["row", "squat"], 2), { kind: "deload" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("evidence");
  });

  test("an early deload sets the start date; a second one is refused", () => {
    const i = stalled(withPlan(), ["row", "squat"]);
    const r = validateProposal(i, { kind: "deload" });
    if (!r.ok) throw new Error(r.reason.text);
    expect(r.programme.earlyDeloadFrom).toBe(i.today);
    const again = validateProposal({ ...i, programme: r.programme }, { kind: "deload" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("deload");
  });

  test("a change to a day or exercise that is not in the plan is refused", () => {
    const cases: PlanChange[] = [
      { kind: "swap", dayType: "A", family: "squat", to: "goblet-squat" },
      { kind: "sets", dayType: "B", exerciseId: "dead-hang", sets: 2 },
    ];
    for (const c of cases) {
      const r = validateProposal(withPlan(), c);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("not-in-plan");
    }
  });

  test("every result carries a reason with filled text", () => {
    const r = validateProposal(withPlan({ history: emptyHistory() }), { kind: "deload" });
    const reason = r.ok ? r.reasons[0] : r.reason;
    expect(r.ok).toBe(false);
    expect(reason?.text).not.toMatch(/\{/);
  });
});

describe("swapByUser", () => {
  test("a ranked candidate replaces the movement with its reason, and needs no stall", () => {
    const i = withPlan();
    const row = dayA(i.programme)?.items.find((x) => x.family === "row");
    if (!row) throw new Error("no row");
    const pick = substitute(i, row.exerciseId)[0];
    if (!pick) throw new Error("no candidate");
    const r = validateProposal(i, { kind: "swap", dayType: "A", family: "row", to: pick.exerciseId });
    expect(r.ok).toBe(false);
    const own = swapByUser(i, "A", row.exerciseId, pick.exerciseId);
    if (!own.ok) throw new Error(own.reason.text);
    const after = dayA(own.programme)?.items.find((x) => x.exerciseId === pick.exerciseId);
    expect(after?.sets).toBe(row.sets);
    expect(after?.reasons.exercise.ruleId).toMatch(/^SWAP_/);
  });

  test("an exercise the ranking does not offer is refused", () => {
    const i = withPlan();
    const row = dayA(i.programme)?.items.find((x) => x.family === "row");
    if (!row) throw new Error("no row");
    const r = swapByUser(i, "A", row.exerciseId, "pullup-strict");
    expect(r.ok).toBe(false);
  });
});
