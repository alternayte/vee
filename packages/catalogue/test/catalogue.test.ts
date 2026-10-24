// SPDX-License-Identifier: AGPL-3.0-or-later
// Content checks on the authored YAML: the PRD ladders, coverage for a
// one-dumbbell home kit, and the ids that tests and templates depend on.
import { beforeAll, describe, expect, test } from "vitest";
import { loadCatalogue } from "../scripts/load";
import type { Catalogue, Exercise, Requirement } from "../src";

let cat: Omit<Catalogue, "hash">;

beforeAll(() => {
  const r = loadCatalogue();
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.where}: ${e.code}: ${e.message}`).join("\n"));
  cat = r.catalogue;
});

// A home kit like the first user's: one dial dumbbell, one band, a pull-up
// station with dip handles and a straight bar only.
const homeKit = { dumbbells: 1, band: true, station: ["dip_handles"] as string[] };

function allowed(req: Requirement): boolean {
  switch (req.kind) {
    case "dumbbell":
      return (req.count ?? 1) <= homeKit.dumbbells;
    case "band":
      return homeKit.band;
    case "pullup_station":
      return req.feature === undefined || homeKit.station.includes(req.feature);
    default:
      return false;
  }
}

const fits = (e: Exercise) => e.requires.every(allowed);
const rung = (family: string, n: number) =>
  cat.exercises.filter((e) => e.family === family && e.rung === n).map((e) => e.id);

describe("PRD ladders", () => {
  test.each([
    [
      "vertical-pull",
      [
        "dead-hang",
        "scapular-pull",
        "pullup-negative",
        "pullup-band-assisted",
        "pullup-strict",
        "pullup-pause",
        "pullup-weighted",
      ],
    ],
    [
      "dip",
      ["dip-support-hold", "dip-negative", "dip-band-assisted", "dip-full", "dip-slow", "dip-weighted"],
    ],
    ["push-up", ["pushup-incline-handles", "pushup-floor", "pushup-deficit-handles", "pushup-archer"]],
    ["row", ["row-single-arm-db"]],
    [
      "squat",
      ["goblet-squat", "split-squat", "split-squat-rear-foot-raised", "split-squat-rear-foot-raised-slow"],
    ],
    ["hinge", ["glute-bridge", "glute-bridge-single-leg", "rdl-single-leg-db"]],
    ["core", ["dead-bug", "hanging-knee-raise", "hanging-leg-raise", "l-sit-tuck", "l-sit"]],
    ["lateral-raise", ["lateral-raise-band", "lateral-raise-db", "lateral-raise-lean-away"]],
  ])("%s has the PRD rungs in order", (family, ids) => {
    const fam = cat.families.find((f) => f.id === family);
    expect(fam?.kind).toBe("ladder");
    expect(fam?.rungs).toBe(ids.length);
    ids.forEach((id, i) => {
      expect(rung(family, i + 1)).toContain(id);
    });
  });

  test("the archer pull-up sits on the top rung with the weighted pull-up", () => {
    expect(rung("vertical-pull", 7)).toContain("pullup-archer");
  });
});

describe("home kit coverage", () => {
  test("every family has a rung-1 exercise the home kit allows", () => {
    for (const f of cat.families) {
      const first = cat.exercises.filter((e) => e.family === f.id && e.rung === 1);
      expect(first.some(fits), f.id).toBe(true);
    }
  });

  test("every rung of every ladder has an exercise the home kit allows", () => {
    for (const f of cat.families.filter((x) => x.kind === "ladder")) {
      for (let n = 1; n <= f.rungs; n++) {
        const options = cat.exercises.filter((e) => e.family === f.id && e.rung === n);
        expect(options.some(fits), `${f.id} rung ${n}`).toBe(true);
      }
    }
  });

  test("no exercise needs two dumbbells", () => {
    const pairs = cat.exercises.filter((e) => e.requires.some((r) => r.kind === "dumbbell" && r.count === 2));
    expect(pairs.map((e) => e.id)).toEqual([]);
  });

  test("dumbbell work for one dumbbell is unilateral or held in both hands", () => {
    const twoHand = new Set([
      "goblet-squat",
      "goblet-carry",
      "triceps-floor-extension-db",
      "pullup-weighted",
      "chinup-weighted",
      "dip-weighted",
    ]);
    const loaded = cat.exercises.filter((e) => e.requires.some((r) => r.kind === "dumbbell"));
    for (const e of loaded) {
      expect(e.unilateral || twoHand.has(e.id), e.id).toBe(true);
    }
  });
});

describe("ids other code depends on", () => {
  test.each([
    "dead-hang",
    "pullup-strict",
    "pushup-floor",
    "dip-support-hold",
    "goblet-squat",
    "plank",
    "suitcase-carry",
    "burpee",
  ])("test item exercise exists: %s", (id) => {
    expect(cat.exercises.some((e) => e.id === id)).toBe(true);
  });

  test.each([
    "vertical-pull",
    "chin-up",
    "row",
    "lateral-raise",
    "rear-delt",
    "core",
    "squat",
    "hinge",
    "carry",
    "dip",
    "push-up",
    "overhead-press",
    "floor-press",
    "triceps",
    "curl",
    "mobility",
  ])("session family exists: %s", (id) => {
    expect(cat.families.some((f) => f.id === id)).toBe(true);
  });

  test("every clip id is the exercise id", () => {
    for (const e of cat.exercises) expect(e.clip).toBe(e.id);
  });
});
