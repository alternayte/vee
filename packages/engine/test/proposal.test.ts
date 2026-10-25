// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  type EngineInput,
  emptyHistory,
  generatePlan,
  type PlanChange,
  type Programme,
  V_TAPER_LEAN_GAIN,
  validateProposal,
} from "../src";
import { input } from "./helpers";

function withPlan(over: Partial<EngineInput> = {}): EngineInput & { programme: Programme } {
  const i = input(over);
  return { ...i, programme: generatePlan(i, V_TAPER_LEAN_GAIN) };
}

const dayA = (p: Programme) => p.templates.find((t) => t.dayType === "A");

describe("validateProposal", () => {
  test("a swap to an allowed exercise on the same ladder and rung applies", () => {
    const i = withPlan();
    const before = dayA(i.programme)?.items.find((x) => x.family === "row");
    expect(before).toBeDefined();
    const r = validateProposal(i, { kind: "swap", dayType: "A", family: "row", to: "row-band" });
    if (!r.ok) throw new Error(r.reason.text);
    const after = dayA(r.programme)?.items.find((x) => x.family === "row");
    expect(after?.exerciseId).toBe("row-band");
    expect(after?.sets).toBe(before?.sets);
    expect(after?.reasons.exercise.ruleId).toBe("PROPOSAL_SWAP");
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
    const i = withPlan({ profile: { ...input().profile, minutesPerSession: 35 } });
    const first = dayA(i.programme)?.items[0];
    if (!first) throw new Error("no item");
    const down = validateProposal(i, { kind: "sets", dayType: "A", exerciseId: first.exerciseId, sets: 2 });
    expect(down.ok).toBe(true);
    if (down.ok) expect(dayA(down.programme)?.items[0]?.sets).toBe(2);
    const up = validateProposal(i, { kind: "sets", dayType: "A", exerciseId: first.exerciseId, sets: 5 });
    expect(up.ok).toBe(false);
    if (!up.ok) expect(up.code).toBe("time");
  });

  test("sets above the volume limit are refused even when time allows", () => {
    const long = withPlan({ profile: { ...input().profile, minutesPerSession: 90 } });
    const curl = long.programme.templates
      .flatMap((t) => t.items.map((x) => ({ t, x })))
      .find((p) => p.x.exerciseId.startsWith("curl"));
    if (!curl) throw new Error("no curl");
    const r = validateProposal(long, {
      kind: "sets",
      dayType: curl.t.dayType,
      exerciseId: curl.x.exerciseId,
      sets: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("volume");
  });

  test("an early deload sets the start date; a second one is refused", () => {
    const i = withPlan();
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
    expect(reason?.text).not.toMatch(/\{/);
  });
});
