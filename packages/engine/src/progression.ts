// SPDX-License-Identifier: AGPL-3.0-or-later
// Progression rules P1–P7 (SDD "Progression rules"). After each session, each
// exercise is checked in this order: P7 readiness hold, P1/P6 misses, P2 top
// of range or P4 timed hold, P5 stall, P3 working.
import type { Exercise } from "@vee/catalogue";
import { isBigJump, nextLoad, prevLoad, snapLoad } from "./dial";
import { bandOptions, checkAllowed, loadOptions } from "./kit";
import { rankCandidates } from "./plan";
import { reason } from "./reasons";
import type {
  EngineInput,
  LoggedSet,
  PrescribedItem,
  ProgressState,
  Reason,
  SessionRecord,
  Streaks,
  TempoStage,
} from "./types";

export type ProgressContext = Pick<EngineInput, "catalogue" | "kit" | "flags" | "today">;

export const ZERO_STREAKS: Streaks = { top: 0, miss: 0, stall: 0, hold: 0 };
export const TOP_SESSIONS = 2;
export const MISS_SESSIONS = 2;
export const HOLD_SESSIONS = 2;
export const STALL_LIMIT = 3;
export const HOLD_STEP_S = 5;
/** Sessions on a new dumbbell exercise in which Easy at the top moves one dial step at once. */
export const CALIBRATION_SESSIONS = 3;
/** A new dial rung starts at the lightest load at or above this share of the last load. */
export const NEW_RUNG_LOAD_SHARE = 0.5;

const STAGE_UP_TEXT: Record<1 | 2 | 3, string> = {
  1: "you lower in 3 seconds first",
  2: "a 1-second pause is added",
  3: "one set is added",
};
const STAGE_DOWN_TEXT: Record<1 | 2 | 3, string> = {
  1: "the slow lowering is removed",
  2: "the pause is removed",
  3: "the extra set is removed",
};

function exercise(ctx: ProgressContext, id: string): Exercise {
  const e = ctx.catalogue.exercises.find((x) => x.id === id);
  if (!e) throw new Error(`exercise not in catalogue: ${id}`);
  return e;
}

const isLoaded = (e: Exercise) => e.load === "dial" || e.load === "fixed";
const isBand = (e: Exercise) => e.load === "band-assist" || e.load === "band-resist";

/** Fresh state on an exercise, for a rung change. `prev` is the state before the change. */
function enter(ctx: ProgressContext, e: Exercise, prev: ProgressState, dir: "up" | "down"): ProgressState {
  const next: ProgressState = {
    family: e.family,
    rung: e.rung,
    exerciseId: e.id,
    streaks: { ...ZERO_STREAKS },
  };
  const loads = loadOptions(e, ctx.kit);
  if (loads.length > 0) {
    const last = prev.loadKg;
    let load = loads[0] as number;
    if (last !== undefined && dir === "up") load = loads.find((l) => l >= last * NEW_RUNG_LOAD_SHARE) ?? load;
    if (last !== undefined && dir === "down") load = snapLoad(loads, last) ?? load;
    next.loadKg = load;
  }
  if (isBand(e)) {
    const bands = bandOptions(e, ctx.kit);
    const b = dir === "up" ? bands[0] : bands.at(-1);
    if (b) next.band = { bandId: b.bandId, setting: b.setting };
  }
  if (e.load === "timed" && e.default.seconds) next.holdS = e.default.seconds[0];
  return next;
}

type Step = { next: ProgressState; moved: boolean; change: string; inputs: Record<string, number | string> };

function moveRung(ctx: ProgressContext, s: ProgressState, e: Exercise, dir: "up" | "down"): Step {
  const rung = s.rung + (dir === "up" ? 1 : -1);
  const onRung = ctx.catalogue.exercises.filter((x) => x.family === s.family && x.rung === rung);
  const allowed = onRung.filter((x) => checkAllowed(x, ctx.kit, ctx.flags, ctx.today).ok);
  const pick = rankCandidates(allowed)[0];
  if (!pick) return { next: s, moved: false, change: "", inputs: { rung } };
  return {
    next: enter(ctx, pick, s, dir),
    moved: true,
    change: `you move to ${pick.names.en.toLowerCase()} (rung ${pick.rung})`,
    inputs: { exercise: pick.id, rung: pick.rung, fromRung: e.rung },
  };
}

function bandIndex(s: ProgressState, e: Exercise, ctx: ProgressContext) {
  const options = bandOptions(e, ctx.kit);
  const i = options.findIndex((o) => o.bandId === s.band?.bandId && o.setting === s.band?.setting);
  return { options, i: Math.max(i, 0) };
}

const settingName = (s: string) => (s === "double" ? "doubled" : s);

export function stepUp(ctx: ProgressContext, s: ProgressState, e: Exercise): Step {
  if (isLoaded(e)) {
    const loads = loadOptions(e, ctx.kit);
    const cur = s.loadKg ?? (loads[0] as number);
    const nxt = nextLoad(loads, cur);
    if (nxt === undefined) return moveRung(ctx, s, e, "up");
    const stage = s.tempoStage ?? 0;
    if (isBigJump(cur, nxt) && stage < 3) {
      const to = (stage + 1) as 1 | 2 | 3;
      const pct = Math.round((nxt / cur - 1) * 100);
      return {
        next: { ...s, tempoStage: to },
        moved: true,
        change: `the next dial step is ${pct}% heavier (${cur} → ${nxt} kg), so ${STAGE_UP_TEXT[to]}`,
        inputs: { from: cur, to: nxt, stage: to },
      };
    }
    const { tempoStage: _drop, ...rest } = s;
    return {
      next: { ...rest, loadKg: nxt },
      moved: true,
      change: `the dial goes ${cur} → ${nxt} kg`,
      inputs: { from: cur, to: nxt },
    };
  }
  if (isBand(e)) {
    const { options, i } = bandIndex(s, e, ctx);
    const to = options[i + 1];
    if (!to) return moveRung(ctx, s, e, "up");
    const from = options[i]?.setting ?? "single";
    return {
      next: { ...s, band: { bandId: to.bandId, setting: to.setting } },
      moved: true,
      change: `the band setting goes from ${settingName(from)} to ${settingName(to.setting)}`,
      inputs: { from, to: to.setting },
    };
  }
  if (e.load === "timed") {
    const loads = loadOptions(e, ctx.kit);
    const cur = s.loadKg;
    const nxt = cur === undefined ? undefined : nextLoad(loads, cur);
    const low = e.default.seconds?.[0];
    if (cur !== undefined && nxt !== undefined && low !== undefined) {
      return {
        next: { ...s, loadKg: nxt, holdS: low },
        moved: true,
        change: `the load goes ${cur} → ${nxt} kg and the hold starts again at ${low} s`,
        inputs: { from: cur, to: nxt, holdTo: low },
      };
    }
  }
  return moveRung(ctx, s, e, "up");
}

export function stepDown(ctx: ProgressContext, s: ProgressState, e: Exercise): Step {
  if (isLoaded(e)) {
    const stage = s.tempoStage ?? 0;
    if (stage > 0) {
      return {
        next: { ...s, tempoStage: (stage - 1) as TempoStage },
        moved: true,
        change: STAGE_DOWN_TEXT[stage as 1 | 2 | 3],
        inputs: { stage: stage - 1 },
      };
    }
    const loads = loadOptions(e, ctx.kit);
    const cur = s.loadKg ?? (loads[0] as number);
    const prv = prevLoad(loads, cur);
    if (prv === undefined) return moveRung(ctx, s, e, "down");
    const tempoStage: TempoStage = isBigJump(prv, cur) ? 3 : 0;
    return {
      next: { ...s, loadKg: prv, tempoStage },
      moved: true,
      change: `the dial goes ${cur} → ${prv} kg`,
      inputs: { from: cur, to: prv },
    };
  }
  if (isBand(e)) {
    const { options, i } = bandIndex(s, e, ctx);
    const to = options[i - 1];
    if (!to) return moveRung(ctx, s, e, "down");
    const from = options[i]?.setting ?? "single";
    return {
      next: { ...s, band: { bandId: to.bandId, setting: to.setting } },
      moved: true,
      change: `the band setting goes from ${settingName(from)} to ${settingName(to.setting)}`,
      inputs: { from, to: to.setting },
    };
  }
  if (
    e.load === "timed" &&
    e.default.seconds &&
    s.holdS !== undefined &&
    s.holdS - HOLD_STEP_S >= e.default.seconds[0]
  ) {
    return {
      next: { ...s, holdS: s.holdS - HOLD_STEP_S },
      moved: true,
      change: `the hold goes ${s.holdS} → ${s.holdS - HOLD_STEP_S} s`,
      inputs: { from: s.holdS, to: s.holdS - HOLD_STEP_S },
    };
  }
  return moveRung(ctx, s, e, "down");
}

const setValue = (e: Exercise, x: LoggedSet) => (e.load === "timed" ? (x.seconds ?? 0) : (x.reps ?? 0));

/** Folds one set into the state: keeps the best reps or seconds at the current step. */
export function applySet(state: ProgressState, set: LoggedSet, e: Exercise): ProgressState {
  if (set.deletedAt !== undefined || set.exerciseId !== state.exerciseId) return state;
  const v = setValue(e, set);
  return state.best === undefined || v > state.best ? { ...state, best: v } : state;
}

export type Evaluation = { next: ProgressState; reasons: Reason[] };

/** Applies the progression rules for one exercise after one session. */
export function evaluate(
  ctx: ProgressContext,
  state: ProgressState,
  item: PrescribedItem,
  sets: LoggedSet[],
  session: SessionRecord,
): Evaluation {
  const r = rules(ctx, state, item, sets, session);
  const counted =
    session.kind !== "micro" &&
    !session.deload &&
    (session.readinessMode ?? "full") === "full" &&
    sets.some((x) => x.exerciseId === item.exerciseId && x.deletedAt === undefined);
  if (!counted || r.next.exerciseId !== item.exerciseId) return r;
  const before = state.exerciseId === item.exerciseId ? (state.seen ?? 0) : 0;
  return { ...r, next: { ...r.next, seen: before + 1 } };
}

function rules(
  ctx: ProgressContext,
  state: ProgressState,
  item: PrescribedItem,
  sets: LoggedSet[],
  session: SessionRecord,
): Evaluation {
  const e = exercise(ctx, item.exerciseId);
  const mine = sets.filter((x) => x.exerciseId === e.id && x.deletedAt === undefined);
  if (mine.length === 0) return { next: state, reasons: [] };

  const s: ProgressState = state.exerciseId === e.id ? state : { ...state, exerciseId: e.id, rung: e.rung };
  const streaks: Streaks = { ...ZERO_STREAKS, ...s.streaks };
  const values = mine.map((x) => setValue(e, x));
  const unit = item.target.unit;
  const { low, high } = item.target;

  if (session.kind === "micro") {
    if (e.load === "timed" && s.holdS !== undefined && values.every((v) => v >= (s.holdS as number))) {
      streaks.hold++;
      return { next: { ...s, streaks }, reasons: [reason("MICRO_HOLD", { hold: s.holdS })] };
    }
    return { next: state, reasons: [reason("MICRO_NONE", {})] };
  }
  if (session.deload || (session.readinessMode ?? "full") !== "full") {
    const mode = session.deload ? "a deload" : (session.readinessMode as string);
    return { next: state, reasons: [reason("P7_HOLD", { mode })] };
  }

  // P1 and P6: a miss is a set below the low end at Hard or Failed.
  const miss = mine.some(
    (x, i) => (values[i] as number) < low && (x.effort === "hard" || x.effort === "failed"),
  );
  if (miss) {
    streaks.miss++;
    streaks.top = 0;
    streaks.hold = 0;
    if (streaks.miss < MISS_SESSIONS) {
      return {
        next: { ...s, streaks },
        reasons: [reason("P1_MISS", { low, unit, low_value: Math.min(...values) })],
      };
    }
    const step = stepDown(ctx, s, e);
    if (!step.moved)
      return { next: { ...s, streaks: { ...ZERO_STREAKS } }, reasons: [reason("P6_FLOOR", {})] };
    const { best: _b, ...rest } = step.next;
    return {
      next: { ...rest, streaks: { ...ZERO_STREAKS } },
      reasons: [reason("P6_BACK_OFF", { change: step.change, ...step.inputs })],
    };
  }
  streaks.miss = 0;

  const rows = item.sets * (e.unilateral ? 2 : 1);
  const complete = mine.length >= rows;

  // Calibration: a new dumbbell exercise starts at the lightest load, so Easy at
  // the top in the first sessions moves one dial step with no micro-steps.
  if (
    isLoaded(e) &&
    (s.seen ?? 0) < CALIBRATION_SESSIONS &&
    complete &&
    values.every((v) => v >= high) &&
    mine.every((x) => x.effort === "easy")
  ) {
    const loads = loadOptions(e, ctx.kit);
    const cur = s.loadKg ?? (loads[0] as number);
    const nxt = nextLoad(loads, cur);
    if (nxt !== undefined) {
      const { tempoStage: _t, best: _b, ...rest } = s;
      return {
        next: { ...rest, loadKg: nxt, streaks: { ...ZERO_STREAKS } },
        reasons: [reason("P2_CALIBRATE", { high, from: cur, to: nxt, sessions: CALIBRATION_SESSIONS })],
      };
    }
  }

  if (unit === "seconds") {
    const hold = s.holdS ?? low;
    const hit = complete && values.every((v) => v >= hold) && mine.every((x) => x.effort !== "failed");
    if (hit) {
      streaks.hold++;
      if (streaks.hold < HOLD_SESSIONS) {
        return { next: { ...s, holdS: hold, streaks }, reasons: [reason("P4_ONCE", { hold })] };
      }
      const cap = e.default.seconds?.[1] ?? hold;
      if (hold < cap) {
        const next = Math.min(hold + HOLD_STEP_S, cap);
        const { best: _b, ...rest } = s;
        return {
          next: { ...rest, holdS: next, streaks: { ...ZERO_STREAKS } },
          reasons: [reason("P4_HOLD_UP", { hold, next })],
        };
      }
      const step = stepUp(ctx, s, e);
      if (!step.moved) return { next: { ...s, streaks }, reasons: [reason("P2_TOP", { high: hold, unit })] };
      return {
        next: step.next,
        reasons: [reason("P4_RUNG", { hold, cap, change: step.change, ...step.inputs })],
      };
    }
    streaks.hold = 0;
  } else {
    const top =
      complete &&
      values.every((v) => v >= high) &&
      mine.every((x) => x.effort === "easy" || x.effort === "good");
    if (top) {
      streaks.top++;
      streaks.stall = 0;
      const withBest = mine.reduce<ProgressState>((acc, x) => applySet(acc, x, e), {
        ...s,
        exerciseId: e.id,
      });
      if (streaks.top < TOP_SESSIONS) {
        return { next: { ...withBest, streaks }, reasons: [reason("P2_ONCE", { high, unit })] };
      }
      if (s.repOverride) {
        const { repOverride: _o, best: _b, ...rest } = s;
        const std = e.default.reps ?? [low, high];
        return {
          next: { ...rest, streaks: { ...ZERO_STREAKS } },
          reasons: [reason("P2_RANGE", { high, unit, newLow: std[0], newHigh: std[1] })],
        };
      }
      const step = stepUp(ctx, s, e);
      if (!step.moved) return { next: { ...withBest, streaks }, reasons: [reason("P2_TOP", { high, unit })] };
      const { best: _b, ...rest } = step.next;
      return {
        next: { ...rest, streaks: { ...ZERO_STREAKS } },
        reasons: [reason("P2_UP", { high, unit, change: step.change, ...step.inputs })],
      };
    }
    streaks.top = 0;
  }

  // P5 stall, else P3 working.
  const best = Math.max(...values);
  if (s.best === undefined || best > s.best) {
    streaks.stall = 0;
    return {
      next: { ...s, best, streaks },
      reasons: [reason("P3_HOLD", { aim: best + 1, unit })],
    };
  }
  streaks.stall++;
  if (streaks.stall < STALL_LIMIT) {
    return { next: { ...s, streaks }, reasons: [reason("P3_HOLD", { aim: s.best + 1, unit })] };
  }
  const swaps = ctx.catalogue.exercises.filter(
    (x) =>
      x.family === e.family &&
      x.rung === e.rung &&
      x.id !== e.id &&
      checkAllowed(x, ctx.kit, ctx.flags, ctx.today).ok,
  );
  const swap = rankCandidates(swaps)[0];
  if (swap) {
    return {
      next: enter(ctx, swap, s, "down"),
      reasons: [
        reason("P5_SWAP", { sessions: STALL_LIMIT, exercise: swap.names.en.toLowerCase(), to: swap.id }),
      ],
    };
  }
  return { next: { ...s, streaks }, reasons: [reason("P5_STALL", { sessions: STALL_LIMIT })] };
}
