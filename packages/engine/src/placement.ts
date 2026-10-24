// SPDX-License-Identifier: AGPL-3.0-or-later
// Test placement (SDD "Tests and placement"): fixed tables map test results to rungs.
import { prevLoad, snapLoad } from "./dial";
import { checkAllowed, loadOptions } from "./kit";
import { familyName, rankCandidates } from "./plan";
import { type ProgressContext, ZERO_STREAKS } from "./progression";
import { reason } from "./reasons";
import type { EngineInput, ProgressState, Reason, TestItem, TestResult } from "./types";

/** A monthly test can move a rung up by at most this. A baseline (no state) is not capped. */
export const PLACEMENT_MAX_UP = 2;
export const SPLIT_SQUAT_SHARE = 0.5;

export type RungPlacement = {
  family: string;
  rung: number;
  repOverride?: { low: number; high: number };
  loadKg?: number;
  reason: Reason;
};

type Table = {
  family: string;
  rung: number;
  repOverride?: { low: number; high: number };
  loadKg?: number;
  from: TestItem;
  value: number;
};

function latest(results: TestResult[]): Map<TestItem, TestResult> {
  const out = new Map<TestItem, TestResult>();
  for (const r of [...results].sort((a, b) => a.date.localeCompare(b.date))) out.set(r.item, r);
  return out;
}

function pullTables(
  pullups: number,
  hang: number,
): { vp: Omit<Table, "family" | "from" | "value">; chin: Omit<Table, "family" | "from" | "value"> } {
  const few = { low: 1, high: 3 };
  if (pullups >= 6) return { vp: { rung: 6 }, chin: { rung: 5 } };
  if (pullups >= 4) return { vp: { rung: 5 }, chin: { rung: 4 } };
  if (pullups >= 1) return { vp: { rung: 5, repOverride: few }, chin: { rung: 4, repOverride: few } };
  if (hang >= 20) return { vp: { rung: 3 }, chin: { rung: 2 } };
  if (hang >= 10) return { vp: { rung: 2 }, chin: { rung: 1 } };
  return { vp: { rung: 1 }, chin: { rung: 1 } };
}

function band(value: number, cuts: number[]): number {
  return cuts.filter((c) => value >= c).length + 1;
}

function tables(input: EngineInput, results: TestResult[]): Table[] {
  const r = latest(results);
  const out: Table[] = [];
  const pull = r.get("pullups");
  const hang = r.get("hang");
  if (pull || hang) {
    const t = pullTables(pull?.value ?? 0, hang?.value ?? 0);
    const from: TestItem = pull ? "pullups" : "hang";
    const value = (pull ?? hang)?.value ?? 0;
    out.push(
      { family: "vertical-pull", ...t.vp, from, value },
      { family: "chin-up", ...t.chin, from, value },
    );
  }
  const push = r.get("pushups");
  if (push)
    out.push({ family: "push-up", rung: band(push.value, [5, 20, 30]), from: "pushups", value: push.value });
  const dip = r.get("dip_hold");
  if (dip) out.push({ family: "dip", rung: band(dip.value, [20, 45]), from: "dip_hold", value: dip.value });
  const plank = r.get("plank");
  if (plank) out.push({ family: "core", rung: band(plank.value, [45]), from: "plank", value: plank.value });
  const carry = r.get("carry");
  if (carry) {
    out.push({
      family: "carry",
      rung: band(carry.value, [30]),
      ...(carry.loadKg === undefined ? {} : { loadKg: carry.loadKg }),
      from: "carry",
      value: carry.value,
    });
  }
  const squat = r.get("goblet_squat");
  if (squat) {
    if (squat.value >= 15) {
      // The split squat loads one leg, so it starts at half the goblet squat load.
      const loadKg = squat.loadKg === undefined ? undefined : squat.loadKg * SPLIT_SQUAT_SHARE;
      out.push({
        family: "squat",
        rung: 2,
        ...(loadKg === undefined ? {} : { loadKg }),
        from: "goblet_squat",
        value: squat.value,
      });
    } else {
      const goblet = input.catalogue.exercises.find((e) => e.id === "goblet-squat");
      const loads = goblet ? loadOptions(goblet, input.kit) : [];
      const at = squat.loadKg === undefined ? undefined : snapLoad(loads, squat.loadKg);
      const loadKg = at === undefined ? undefined : squat.value >= 8 ? at : (prevLoad(loads, at) ?? at);
      out.push({
        family: "squat",
        rung: 1,
        ...(loadKg === undefined ? {} : { loadKg }),
        from: "goblet_squat",
        value: squat.value,
      });
    }
  }
  return out;
}

export function placeFromTest(input: EngineInput, results: TestResult[]): RungPlacement[] {
  const out: RungPlacement[] = [];
  for (const t of tables(input, results)) {
    const state = input.history.progress.find((p) => p.family === t.family);
    const name = familyName(input, t.family);
    const base = { item: t.from.replace("_", " "), value: t.value, family: t.family, familyName: name };
    let rung = t.rung;
    let ruleId = "PLACE_TEST";
    if (state) {
      if (rung <= state.rung) continue;
      if (rung > state.rung + PLACEMENT_MAX_UP) {
        rung = state.rung + PLACEMENT_MAX_UP;
        ruleId = "PLACE_LIMIT";
      }
    }
    const keepExtras = rung === t.rung;
    out.push({
      family: t.family,
      rung,
      ...(keepExtras && t.repOverride ? { repOverride: t.repOverride } : {}),
      ...(keepExtras && t.loadKg !== undefined ? { loadKg: t.loadKg } : {}),
      reason: reason(ruleId, { ...base, rung, max: PLACEMENT_MAX_UP }),
    });
  }
  return out;
}

/** New progress rows for the placements. A rung the kit or flags rule out falls to the nearest allowed rung below. */
export function applyPlacements(
  ctx: ProgressContext,
  progress: ProgressState[],
  placements: RungPlacement[],
): ProgressState[] {
  const out = progress.filter((p) => !placements.some((x) => x.family === p.family));
  for (const p of placements) {
    const options = ctx.catalogue.exercises.filter(
      (e) => e.family === p.family && e.rung <= p.rung && checkAllowed(e, ctx.kit, ctx.flags, ctx.today).ok,
    );
    const e = rankCandidates(options)[0];
    if (!e) {
      const old = progress.find((x) => x.family === p.family);
      if (old) out.push(old);
      continue;
    }
    const s: ProgressState = {
      family: p.family,
      rung: e.rung,
      exerciseId: e.id,
      streaks: { ...ZERO_STREAKS },
    };
    if (e.rung === p.rung && p.repOverride) s.repOverride = p.repOverride;
    const loads = loadOptions(e, ctx.kit);
    if (loads.length > 0)
      s.loadKg =
        p.loadKg !== undefined && e.rung === p.rung
          ? (snapLoad(loads, p.loadKg) as number)
          : (loads[0] as number);
    if (e.load === "timed" && e.default.seconds) s.holdS = e.default.seconds[0];
    out.push(s);
  }
  return out.sort((a, b) => a.family.localeCompare(b.family));
}
