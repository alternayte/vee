// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  type Effort,
  evaluate,
  type LoggedSet,
  type PrescribedItem,
  type ProgressContext,
  type ProgressState,
  type SessionRecord,
} from "../src";
import { catalogue, ex, homeKit } from "./helpers";

const ctx: ProgressContext = { catalogue, kit: homeKit, flags: [], today: "2026-11-02" };

function state(exerciseId: string, over: Partial<ProgressState> = {}): ProgressState {
  const e = ex(exerciseId);
  return { family: e.family, rung: e.rung, exerciseId, ...over };
}

function item(s: ProgressState, sets = 3): PrescribedItem {
  const e = ex(s.exerciseId as string);
  const range =
    s.repOverride ?? (e.default.reps ? { low: e.default.reps[0], high: e.default.reps[1] } : undefined);
  const target = range
    ? { unit: "reps" as const, ...range }
    : { unit: "seconds" as const, low: s.holdS ?? 0, high: s.holdS ?? 0 };
  const r = { ruleId: "T", inputs: {}, text: "T." };
  return {
    order: 1,
    family: e.family,
    exerciseId: e.id,
    role: "main",
    sets,
    target,
    restS: e.default.rest_s,
    ...(s.loadKg !== undefined ? { loadKg: s.loadKg } : {}),
    reasons: { exercise: r, sets: [r], target: r },
  };
}

let n = 0;
const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: `s${++n}`,
  kind: "main",
  status: "done",
  date: "2026-11-02",
  readinessMode: "full",
  ...over,
});

function logged(
  s: SessionRecord,
  exerciseId: string,
  values: number[],
  effort: Effort = "good",
  extra: Partial<LoggedSet> = {},
): LoggedSet[] {
  const timed = ex(exerciseId).load === "timed";
  return values.map((v, i) => ({
    id: `${s.id}-${exerciseId}-${i}-${extra.side ?? ""}`,
    sessionId: s.id,
    exerciseId,
    ...(timed ? { seconds: v } : { reps: v }),
    effort,
    loggedAt: `${s.date}T19:00:0${i}Z`,
    ...extra,
  }));
}

/** Runs sessions in order. Each entry gives the reps or seconds per set and the effort. */
function run(start: ProgressState, sessions: [number[], Effort?, Partial<SessionRecord>?][]) {
  let s = start;
  const reasons: string[][] = [];
  for (const [values, effort, over] of sessions) {
    const rec = session(over);
    const id = s.exerciseId as string;
    const sets = ex(id).unilateral
      ? [
          ...logged(rec, id, values, effort ?? "good", { side: "left" }),
          ...logged(rec, id, values, effort ?? "good", { side: "right" }),
        ]
      : logged(rec, id, values, effort ?? "good");
    const r = evaluate(ctx, s, item(s), sets, rec);
    s = r.next;
    reasons.push(r.reasons.map((x) => x.ruleId));
  }
  return { state: s, reasons };
}

describe("P2 top of range", () => {
  test("a small dial jump goes straight up after 2 top sessions", () => {
    const r = run(state("lateral-raise-db", { loadKg: 16 }), [[[15, 15, 15]], [[15, 15, 15]]]);
    expect(r.state.loadKg).toBe(18);
    expect(r.state.tempoStage ?? 0).toBe(0);
    expect(r.reasons).toEqual([["P2_ONCE"], ["P2_UP"]]);
  });

  test("one top session is not enough", () => {
    expect(run(state("lateral-raise-db", { loadKg: 16 }), [[[15, 15, 15]]]).state.loadKg).toBe(16);
  });

  test("Hard effort at the top does not count", () => {
    const r = run(state("lateral-raise-db", { loadKg: 16 }), [
      [[15, 15, 15], "hard"],
      [[15, 15, 15], "hard"],
    ]);
    expect(r.state.loadKg).toBe(16);
  });

  test("a big dial jump adds tempo, then a pause, then a set, then the load", () => {
    const top: [number[]] = [[12, 12, 12]];
    let s = state("goblet-squat", { loadKg: 10 });
    const stages: number[] = [];
    for (let i = 0; i < 4; i++) {
      s = run(s, [top, top]).state;
      stages.push(s.tempoStage ?? 0);
    }
    expect(stages).toEqual([1, 2, 3, 0]);
    expect(s.loadKg).toBe(12);
  });

  test("the reason names the rule and the numbers", () => {
    const s = state("row-single-arm-db", { loadKg: 20 });
    const both = (rec: SessionRecord) => [
      ...logged(rec, "row-single-arm-db", [12, 12, 12], "good", { side: "left" }),
      ...logged(rec, "row-single-arm-db", [12, 12, 12], "good", { side: "right" }),
    ];
    const rec = session();
    const first = evaluate(ctx, s, item(s), both(rec), rec).next;
    const rec2 = session();
    const r = evaluate(ctx, first, item(first), both(rec2), rec2);
    expect(r.reasons[0]?.text).toBe("12 reps hit twice at Easy or Good, so the dial goes 20 → 22 kg.");
    expect(r.reasons[0]?.inputs).toMatchObject({ high: 12, from: 20, to: 22 });
  });

  test("at the top of the dial, the next rung starts near half the load", () => {
    const r = run(state("goblet-squat", { loadKg: 24 }), [[[12, 12, 12]], [[12, 12, 12]]]);
    expect(r.state.exerciseId).toBe("split-squat");
    expect(r.state.rung).toBe(2);
    expect(r.state.loadKg).toBe(12);
  });

  test("bodyweight work moves to the next rung, and band assist starts with the most help", () => {
    const r = run(state("pullup-negative"), [[[5, 5, 5]], [[5, 5, 5]]]);
    expect(r.state.exerciseId).toBe("pullup-band-assisted");
    expect(r.state.band).toEqual({ bandId: "band", setting: "double" });
  });

  test("band assist goes to less help, then to the next rung", () => {
    const top: [number[]] = [[8, 8, 8]];
    let s = state("pullup-band-assisted", { band: { bandId: "band", setting: "double" } });
    s = run(s, [top, top]).state;
    expect(s.band?.setting).toBe("single");
    s = run(s, [top, top]).state;
    expect(s.exerciseId).toBe("pullup-strict");
    expect(s.band).toBeUndefined();
  });

  test("band resist goes single → short → double, then the dial version", () => {
    const top: [number[]] = [[20, 20, 20]];
    let s = state("lateral-raise-band", { band: { bandId: "band", setting: "single" } });
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      s = run(s, [top, top]).state;
      seen.push(s.band?.setting ?? s.exerciseId ?? "");
    }
    expect(seen).toEqual(["short", "double", "lateral-raise-db"]);
    expect(s.loadKg).toBe(2);
  });

  test("a placement range clears before the rung moves", () => {
    const s = state("pullup-strict", { repOverride: { low: 1, high: 3 } });
    const r = run(s, [[[3, 3, 3]], [[3, 3, 3]]]);
    expect(r.state.exerciseId).toBe("pullup-strict");
    expect(r.state.repOverride).toBeUndefined();
    expect(r.reasons[1]).toEqual(["P2_RANGE"]);
  });

  test("a rung that flags rule out is not given", () => {
    const flagged: ProgressContext = {
      ...ctx,
      flags: [{ joint: "shoulder", severity: "mild", activeFrom: "2026-01-01" }],
    };
    let s = state("pullup-pause");
    for (let i = 0; i < 2; i++) {
      const rec = session();
      s = evaluate(flagged, s, item(s), logged(rec, "pullup-pause", [6, 6, 6]), rec).next;
    }
    expect(s.exerciseId).toBe("pullup-pause");
  });

  test("unilateral work needs both sides at the top", () => {
    const s = state("curl-db", { loadKg: 10 });
    let cur = s;
    for (let i = 0; i < 2; i++) {
      const rec = session();
      const sets = [
        ...logged(rec, "curl-db", [12, 12, 12], "good", { side: "left" }),
        ...logged(rec, "curl-db", [12, 12, 11], "good", { side: "right" }),
      ];
      cur = evaluate(ctx, cur, item(cur), sets, rec).next;
    }
    expect(cur.loadKg).toBe(10);
  });
});

describe("P1 and P6 misses", () => {
  test("one miss session marks a miss; a second steps down", () => {
    const r = run(state("goblet-squat", { loadKg: 14 }), [
      [[8, 6, 5], "failed"],
      [[8, 7, 6], "hard"],
    ]);
    expect(r.reasons).toEqual([["P1_MISS"], ["P6_BACK_OFF"]]);
    expect(r.state.loadKg).toBe(12);
  });

  test("stepping down into a big dial jump goes to the lighter load with every micro-step", () => {
    const r = run(state("goblet-squat", { loadKg: 12 }), [
      [[5, 5, 5], "failed"],
      [[5, 5, 5], "failed"],
    ]);
    expect(r.state.loadKg).toBe(10);
    expect(r.state.tempoStage).toBe(3);
  });

  test("with a micro-step active, a step down removes it first", () => {
    const r = run(state("goblet-squat", { loadKg: 10, tempoStage: 2 }), [
      [[5], "failed"],
      [[5], "failed"],
    ]);
    expect(r.state).toMatchObject({ loadKg: 10, tempoStage: 1 });
  });

  test("a clean session resets the miss count", () => {
    const r = run(state("goblet-squat", { loadKg: 14 }), [[[6], "failed"], [[10, 10, 10]], [[6], "failed"]]);
    expect(r.state.loadKg).toBe(14);
  });

  test("a miss at Good effort is not a miss", () => {
    const r = run(state("goblet-squat", { loadKg: 14 }), [
      [[6, 6, 6], "good"],
      [[6, 6, 6], "good"],
    ]);
    expect(r.state.loadKg).toBe(14);
  });

  test("bodyweight work steps down one rung", () => {
    const r = run(state("pullup-strict"), [
      [[1, 1, 0], "failed"],
      [[1, 1, 1], "failed"],
    ]);
    expect(r.state.exerciseId).toBe("pullup-band-assisted");
    expect(r.state.band?.setting).toBe("single");
  });

  test("rung 1 has no step down", () => {
    const r = run(state("dead-bug"), [
      [[2, 2, 2], "failed"],
      [[2, 2, 2], "failed"],
    ]);
    expect(r.state.exerciseId).toBe("dead-bug");
    expect(r.reasons[1]).toEqual(["P6_FLOOR"]);
  });
});

describe("P4 timed holds", () => {
  test("2 sessions at the hold target add 5 s", () => {
    const r = run(state("dead-hang", { holdS: 20 }), [[[20, 22, 20]], [[21, 20, 20]]]);
    expect(r.state.holdS).toBe(25);
    expect(r.reasons[1]).toEqual(["P4_HOLD_UP"]);
  });

  test("at the cap, the next rung", () => {
    const r = run(state("dead-hang", { holdS: 60 }), [[[60, 60, 60]], [[60, 60, 60]]]);
    expect(r.state.exerciseId).toBe("scapular-pull");
    expect(r.state.holdS).toBeUndefined();
  });

  test("a timed rung starts at the low end of its range", () => {
    const r = run(state("chinup-negative"), [
      [[2, 2, 2], "failed"],
      [[2, 2, 2], "failed"],
    ]);
    expect(r.state).toMatchObject({ exerciseId: "flexed-arm-hang", holdS: 5 });
  });
});

describe("P5 stall", () => {
  test("3 sessions with no gain swap to another exercise on the same rung", () => {
    const r = run(state("row-single-arm-db", { loadKg: 12 }), [
      [[10, 10, 9]],
      [[10, 9, 9]],
      [[10, 10, 10]],
      [[9, 9, 9]],
    ]);
    expect(r.reasons[3]).toEqual(["P5_SWAP"]);
    expect(r.state.exerciseId).toBe("row-band");
  });

  test("with no alternative, the stall stays for the deload check", () => {
    const r = run(state("pullup-pause"), [[[4, 4, 4]], [[4, 4, 3]], [[4, 4, 4]], [[4, 3, 3]]]);
    expect(r.reasons[3]).toEqual(["P5_STALL"]);
    expect(r.state.streaks?.stall).toBe(3);
  });

  test("a rep gain resets the stall count", () => {
    const r = run(state("pullup-pause"), [[[4, 4, 4]], [[4, 4, 4]], [[5, 4, 4]], [[4, 4, 4]]]);
    expect(r.state.streaks?.stall).toBe(1);
  });
});

describe("P7 and non-progress sessions", () => {
  test("a Trimmed session changes nothing", () => {
    const s = state("lateral-raise-db", { loadKg: 16, streaks: { top: 1, miss: 0, stall: 0, hold: 0 } });
    const r = run(s, [[[15, 15, 15], "good", { readinessMode: "trimmed" }]]);
    expect(r.state).toEqual(s);
    expect(r.reasons).toEqual([["P7_HOLD"]]);
  });

  test("a deload session changes nothing", () => {
    const s = state("lateral-raise-db", { loadKg: 16, streaks: { top: 1, miss: 0, stall: 0, hold: 0 } });
    expect(run(s, [[[15, 15, 15], "good", { deload: true }]]).state).toEqual(s);
  });

  test("a micro session counts only toward the hang timer", () => {
    const s = state("dead-hang", { holdS: 20 });
    const r = run(s, [[[20], "good", { kind: "micro" }], [[25, 25, 25]]]);
    expect(r.state.holdS).toBe(25);
    const reps = run(state("pullup-strict"), [
      [[8], "good", { kind: "micro" }],
      [[8, 8, 8], "good", { kind: "micro" }],
    ]);
    expect(reps.state.exerciseId).toBe("pullup-strict");
    expect(reps.state.streaks?.top ?? 0).toBe(0);
  });

  test("no logged sets changes nothing", () => {
    const s = state("lateral-raise-db", { loadKg: 16 });
    expect(run(s, [[[]]]).state).toEqual(s);
  });
});
