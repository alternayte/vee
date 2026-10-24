// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import { buildCatalogue, type FamilyFileInput } from "../src";

type ExerciseInput = FamilyFileInput["exercises"][number];

function exercise(over: Partial<ExerciseInput> = {}): ExerciseInput {
  return {
    id: "pullup-strict",
    rung: 1,
    names: { en: "Strict pull-up" },
    pattern: "vertical-pull",
    muscles: { lats: 1, biceps: 0.5 },
    requires: [{ kind: "pullup_station" }],
    load: "bodyweight",
    unilateral: false,
    default: { sets: 3, reps: [3, 8], rest_s: 120 },
    cues: ["Pull until your chin is above the bar."],
    flags_block: ["shoulder:acute"],
    clip: "pullup-strict",
    ...over,
  };
}

function file(exercises: ExerciseInput[], over: Partial<FamilyFileInput> = {}): FamilyFileInput {
  return { family: "vertical-pull", names: { en: "Vertical pull" }, kind: "ladder", exercises, ...over };
}

function codes(files: unknown[]): string[] {
  const r = buildCatalogue(files);
  return r.ok ? [] : r.errors.map((e) => e.code);
}

describe("buildCatalogue", () => {
  test("accepts a valid family and sets the family on each exercise", () => {
    const r = buildCatalogue([file([exercise()])]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.catalogue.exercises[0]?.family).toBe("vertical-pull");
    expect(r.catalogue.families).toEqual([
      { id: "vertical-pull", names: { en: "Vertical pull" }, kind: "ladder", rungs: 1 },
    ]);
  });

  test("sorts exercises by family, rung and id", () => {
    const r = buildCatalogue([
      file([exercise({ id: "b", rung: 2, clip: "b" }), exercise({ id: "c", rung: 1, clip: "c" })]),
      file([exercise({ id: "a", clip: "a" })], { family: "chin-up", names: { en: "Chin-up" } }),
    ]);
    expect(r.ok && r.catalogue.exercises.map((e) => e.id)).toEqual(["a", "c", "b"]);
  });

  test("rejects a schema error with the file and path", () => {
    const r = buildCatalogue([file([exercise({ rung: 0 })])]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("schema");
    expect(r.errors[0]?.where).toContain("exercises.0.rung");
  });

  test("rejects unknown keys", () => {
    expect(codes([file([{ ...exercise(), colour: "red" } as ExerciseInput])])).toContain("schema");
  });

  test("rejects a duplicate family", () => {
    expect(codes([file([exercise()]), file([exercise({ id: "x", clip: "x" })])])).toContain(
      "duplicate-family",
    );
  });

  test("rejects a duplicate exercise id across families", () => {
    const other = file([exercise()], { family: "chin-up", names: { en: "Chin-up" } });
    expect(codes([file([exercise()]), other])).toContain("duplicate-exercise");
  });

  test("rejects a gap in ladder rungs", () => {
    expect(codes([file([exercise(), exercise({ id: "x", rung: 3, clip: "x" })])])).toContain("rung-gap");
  });

  test("accepts two exercises on one rung", () => {
    expect(codes([file([exercise(), exercise({ id: "x", clip: "x" })])])).toEqual([]);
  });

  test("rejects a pool exercise above rung 1", () => {
    expect(codes([file([exercise({ rung: 2 })], { kind: "pool" })])).toContain("pool-rung");
  });

  test("rejects muscles with no primary weight of 1", () => {
    expect(codes([file([exercise({ muscles: { lats: 0.8 } })])])).toContain("no-primary-muscle");
  });

  test("rejects a reversed rep range", () => {
    expect(codes([file([exercise({ default: { sets: 3, reps: [8, 3], rest_s: 120 } })])])).toContain(
      "range-order",
    );
  });

  test("timed load needs seconds and no reps", () => {
    expect(codes([file([exercise({ load: "timed" })])])).toContain("timed-needs-seconds");
    const ok = exercise({ load: "timed", default: { sets: 3, seconds: [10, 60], rest_s: 90 } });
    expect(codes([file([ok])])).toEqual([]);
  });

  test("other loads need reps and no seconds", () => {
    const bad = exercise({ default: { sets: 3, seconds: [10, 60], rest_s: 90 } });
    expect(codes([file([bad])])).toContain("reps-needs-reps");
  });

  test("dial load needs an implement", () => {
    expect(codes([file([exercise({ load: "dial" })])])).toContain("load-needs-implement");
    const ok = exercise({ load: "dial", requires: [{ kind: "dumbbell" }] });
    expect(codes([file([ok])])).toEqual([]);
  });

  test("band-assist needs a band used to assist", () => {
    const bad = exercise({ load: "band-assist", requires: [{ kind: "band", use: "resist" }] });
    expect(codes([file([bad])])).toContain("load-needs-band");
  });

  test("band-resist needs a band used to resist", () => {
    expect(codes([file([exercise({ load: "band-resist", requires: [] })])])).toContain("load-needs-band");
  });

  test("bodyweight load must not need an implement or a band", () => {
    const bad = exercise({ requires: [{ kind: "dumbbell" }] });
    expect(codes([file([bad])])).toContain("bodyweight-with-load");
  });

  test("a band requirement must say how the band is used", () => {
    const bad = exercise({
      load: "timed",
      default: { sets: 1, seconds: [10, 20], rest_s: 0 },
      requires: [{ kind: "band" }],
    });
    expect(codes([file([bad])])).toContain("band-needs-use");
  });

  test("use is only for bands and feature is only for the pull-up station", () => {
    expect(codes([file([exercise({ requires: [{ kind: "pullup_station", use: "assist" }] })])])).toContain(
      "bad-requirement",
    );
    const bad = exercise({ load: "dial", requires: [{ kind: "dumbbell", feature: "dip_handles" }] });
    expect(codes([file([bad])])).toContain("bad-requirement");
  });

  test("count 2 is only for dumbbells and kettlebells", () => {
    expect(codes([file([exercise({ requires: [{ kind: "pullup_station", count: 2 }] })])])).toContain(
      "bad-requirement",
    );
  });

  test("a cue is one sentence", () => {
    expect(codes([file([exercise({ cues: ["Hang. Then pull."] })])])).toContain("cue-one-sentence");
    expect(codes([file([exercise({ cues: ["Hang with straight arms"] })])])).toContain("cue-one-sentence");
  });

  test("a cue has 20 words or fewer", () => {
    const long = `${Array.from({ length: 21 }, () => "word").join(" ")}.`;
    expect(codes([file([exercise({ cues: [long] })])])).toContain("cue-too-long");
  });

  test("rejects a bad flag block", () => {
    expect(codes([file([exercise({ flags_block: ["neck:acute" as never] })])])).toContain("schema");
  });
});
