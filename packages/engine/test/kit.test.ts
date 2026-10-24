// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exercise } from "@vee/catalogue";
import { describe, expect, test } from "vitest";
import { activeFlags, bandOptions, checkAllowed, type KitItem, loadOptions } from "../src";
import { ex, homeKit } from "./helpers";

const dial = (min: number, max: number, step: number, count: 1 | 2 = 1): KitItem => ({
  id: `dial-${min}-${max}`,
  kind: "dial_db",
  count,
  params: { min, max, step },
});

function twoDumbbellExercise(): Exercise {
  return {
    ...ex("curl-db"),
    id: "curl-db-pair",
    requires: [{ kind: "dumbbell", count: 2 }],
    unilateral: false,
  };
}

describe("loadOptions", () => {
  test("a 2–24 kg dial in 2 kg steps gives 12 loads", () => {
    expect(loadOptions(ex("goblet-squat"), homeKit)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
  });

  test("fractional steps do not drift", () => {
    expect(loadOptions(ex("goblet-squat"), [dial(1, 2, 0.1)])).toEqual([
      1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2,
    ]);
  });

  test("merges and sorts loads from several dumbbells", () => {
    const fixed: KitItem = { id: "f", kind: "fixed_db", count: 2, params: { weights: [5, 3, 12.5] } };
    expect(loadOptions(ex("goblet-squat"), [dial(2, 6, 2), fixed])).toEqual([2, 3, 4, 5, 6, 12.5]);
  });

  test("an exercise that needs two dumbbells has no loads with one", () => {
    expect(loadOptions(twoDumbbellExercise(), homeKit)).toEqual([]);
    expect(loadOptions(twoDumbbellExercise(), [dial(2, 24, 2, 2)])).toHaveLength(12);
  });

  test("bodyweight and band work has no dumbbell loads", () => {
    expect(loadOptions(ex("pullup-strict"), homeKit)).toEqual([]);
    expect(loadOptions(ex("lateral-raise-band"), homeKit)).toEqual([]);
  });

  test("a timed carry uses the dumbbell loads", () => {
    expect(loadOptions(ex("suitcase-carry"), homeKit)).toHaveLength(12);
  });
});

describe("bandOptions", () => {
  const bands: KitItem[] = [
    { id: "light", kind: "band", count: 1, params: { colour: "yellow", estKg: 10 } },
    { id: "heavy", kind: "band", count: 1, params: { colour: "black", estKg: 30 } },
  ];

  test("resist options go from light to strong", () => {
    const est = bandOptions(ex("lateral-raise-band"), bands).map((o) => o.estKg);
    expect(est).toEqual([...est].sort((a, b) => a - b));
    expect(est.length).toBeGreaterThan(2);
  });

  test("assist options go from most help to least help", () => {
    const est = bandOptions(ex("pullup-band-assisted"), bands).map((o) => o.estKg);
    expect(est).toEqual([...est].sort((a, b) => b - a));
  });

  test("one band gives a single, short and doubled setting for resist work", () => {
    expect(bandOptions(ex("face-pull-band"), homeKit).map((o) => o.setting)).toEqual([
      "single",
      "short",
      "double",
    ]);
  });

  test("no band options without a band or for non-band work", () => {
    expect(bandOptions(ex("lateral-raise-band"), [dial(2, 24, 2)])).toEqual([]);
    expect(bandOptions(ex("goblet-squat"), homeKit)).toEqual([]);
  });
});

describe("activeFlags", () => {
  const flag = {
    joint: "shoulder",
    severity: "acute",
    activeFrom: "2026-11-01",
    activeTo: "2026-11-10",
  } as const;

  test("a flag is active from its first day to its last day", () => {
    expect(activeFlags([flag], "2026-10-31")).toEqual([]);
    expect(activeFlags([flag], "2026-11-01")).toEqual([flag]);
    expect(activeFlags([flag], "2026-11-10")).toEqual([flag]);
    expect(activeFlags([flag], "2026-11-11")).toEqual([]);
  });

  test("a flag with no end stays active", () => {
    const open = { joint: "knee", severity: "mild", activeFrom: "2026-01-01" } as const;
    expect(activeFlags([open], "2030-01-01")).toEqual([open]);
  });
});

describe("checkAllowed", () => {
  const today = "2026-11-02";

  test("the home kit allows a band-assisted pull-up", () => {
    expect(checkAllowed(ex("pullup-band-assisted"), homeKit, [], today)).toEqual({ ok: true });
  });

  test("no station means no pull-ups", () => {
    const r = checkAllowed(ex("pullup-strict"), [dial(2, 24, 2)], [], today);
    expect(r).toEqual({ ok: false, why: "kit", missing: "pullup_station" });
  });

  test("a station without dip handles rules out dips", () => {
    const station: KitItem = {
      id: "s",
      kind: "pullup_station",
      count: 1,
      params: { grips: ["straight", "neutral"], dipHandles: false },
    };
    expect(checkAllowed(ex("dip-full"), [station], [], today).ok).toBe(false);
    expect(checkAllowed(ex("pullup-neutral-grip"), [station], [], today).ok).toBe(true);
    expect(checkAllowed(ex("pullup-neutral-grip"), homeKit, [], today).ok).toBe(false);
  });

  test("one dumbbell rules out two-dumbbell work", () => {
    expect(checkAllowed(twoDumbbellExercise(), homeKit, [], today).ok).toBe(false);
  });

  test("a mild flag blocks joint:mild but not joint:acute", () => {
    const mild = [{ joint: "shoulder", severity: "mild", activeFrom: "2026-01-01" }] as const;
    expect(checkAllowed(ex("dip-full"), homeKit, [...mild], today)).toEqual({
      ok: false,
      why: "flag",
      flag: "shoulder:mild",
    });
    expect(checkAllowed(ex("pullup-strict"), homeKit, [...mild], today).ok).toBe(true);
  });

  test("an acute flag blocks both", () => {
    const acute = [{ joint: "shoulder", severity: "acute", activeFrom: "2026-01-01" }] as const;
    expect(checkAllowed(ex("dip-full"), homeKit, [...acute], today).ok).toBe(false);
    expect(checkAllowed(ex("pullup-strict"), homeKit, [...acute], today).ok).toBe(false);
  });

  test("an expired flag blocks nothing", () => {
    const old = [
      { joint: "shoulder", severity: "acute", activeFrom: "2026-01-01", activeTo: "2026-02-01" },
    ] as const;
    expect(checkAllowed(ex("dip-full"), homeKit, [...old], today).ok).toBe(true);
  });
});
