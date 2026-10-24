// SPDX-License-Identifier: AGPL-3.0-or-later

import { loadCatalogue } from "@vee/catalogue/load";
import { describe, expect, test } from "vitest";
import { aliasTargets, detectFormat, matchExercise, parseCsv, parseImport } from "../src";

describe("alias table", () => {
  test("every alias points at a catalogue exercise", () => {
    const cat = loadCatalogue();
    if (!cat.ok) throw new Error("catalogue does not build");
    const ids = new Set(cat.catalogue.exercises.map((e) => e.id));
    expect(aliasTargets().filter((id) => !ids.has(id))).toEqual([]);
  });
});

const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Pull day","12 Oct 2026, 18:05","12 Oct 2026, 18:50","","Pull Up","","","0","normal","","5","","",""
"Pull day","12 Oct 2026, 18:05","12 Oct 2026, 18:50","","Pull Up","","","1","normal","","4","","","9"
"Pull day","12 Oct 2026, 18:05","12 Oct 2026, 18:50","","Lateral Raise (Dumbbell)","","","0","warmup","4","15","","",""
"Pull day","12 Oct 2026, 18:05","12 Oct 2026, 18:50","","Lateral Raise (Dumbbell)","","","1","normal","8","12","","",""
"Legs","14 Oct 2026, 07:10","14 Oct 2026, 07:40","","Goblet Squat","","","0","normal","16","10","","",""
"Legs","14 Oct 2026, 07:10","14 Oct 2026, 07:40","","Plank","","","0","normal","","","","45",""
"Legs","14 Oct 2026, 07:10","14 Oct 2026, 07:40","","Zercher Squat","","","0","normal","40","5","","",""
`;

const STRONG = `Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE
2026-10-12 18:05:00;Evening;45m;Pull Up;1;0;5;0;0;;;
2026-10-12 18:05:00;Evening;45m;Pull Up;2;0;4;0;0;;;8
2026-10-12 18:05:00;Evening;45m;Dumbbell Row;1;20;10;0;0;;;
`;

const FITNOTES = `Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time,Comment
2026-10-12,Chin Up,Back,0.0,6,,,,
2026-10-12,Dumbbell Curl,Biceps,10.0,12,,,,"felt, good"
2026-10-13,Dead Hang,Back,0.0,,,,0:00:40,
`;

describe("parseCsv", () => {
  test("handles quotes, commas in quotes and escaped quotes", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n', ",")).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
    ]);
  });

  test("handles CRLF line ends and a trailing newline", () => {
    expect(parseCsv("a;b\r\n1;2\r\n", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("detectFormat", () => {
  test.each([
    ["hevy", HEVY],
    ["strong", STRONG],
    ["fitnotes", FITNOTES],
  ] as const)("detects %s", (fmt, csv) => {
    expect(detectFormat(csv)).toBe(fmt);
  });

  test("unknown headers are undefined", () => {
    expect(detectFormat("foo,bar\n1,2\n")).toBeUndefined();
  });
});

describe("matchExercise", () => {
  test.each([
    ["Pull Up", "pullup-strict"],
    ["Pull-up", "pullup-strict"],
    ["Chin Up", "chinup-strict"],
    ["Lateral Raise (Dumbbell)", "lateral-raise-db"],
    ["Goblet Squat", "goblet-squat"],
    ["Plank", "plank"],
    ["Dumbbell Row", "row-single-arm-db"],
    ["Dumbbell Curl", "curl-db"],
    ["Dead Hang", "dead-hang"],
    ["Push Up", "pushup-floor"],
    ["Dips", "dip-full"],
  ])("%s → %s", (name, id) => {
    expect(matchExercise(name)).toBe(id);
  });

  test("an unknown name has no match", () => {
    expect(matchExercise("Zercher Squat")).toBeUndefined();
  });
});

describe("parseImport", () => {
  test("Hevy: sessions by workout, warm-up sets dropped, timed sets in seconds", () => {
    const r = parseImport(HEVY);
    expect(r.format).toBe("hevy");
    expect(r.sessions.map((s) => [s.date, s.name])).toEqual([
      ["2026-10-12", "Pull day"],
      ["2026-10-14", "Legs"],
    ]);
    const pull = r.sessions[0];
    expect(pull?.sets.map((s) => [s.exerciseId, s.reps, s.loadKg])).toEqual([
      ["pullup-strict", 5, undefined],
      ["pullup-strict", 4, undefined],
      ["lateral-raise-db", 12, 8],
    ]);
    expect(r.sessions[1]?.sets.find((s) => s.exerciseId === "plank")?.seconds).toBe(45);
  });

  test("unknown exercises become custom exercises, once each", () => {
    const r = parseImport(HEVY);
    expect(r.customExercises).toEqual([{ id: "custom-zercher-squat", name: "Zercher Squat" }]);
    expect(r.sessions[1]?.sets.find((s) => s.exerciseId === "custom-zercher-squat")?.reps).toBe(5);
  });

  test("Strong: semicolons, RPE maps to effort", () => {
    const r = parseImport(STRONG);
    expect(r.format).toBe("strong");
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]?.sets.map((s) => [s.exerciseId, s.reps, s.effort])).toEqual([
      ["pullup-strict", 5, "good"],
      ["pullup-strict", 4, "hard"],
      ["row-single-arm-db", 10, "good"],
    ]);
    expect(r.sessions[0]?.sets[2]?.loadKg).toBe(20);
  });

  test("FitNotes: one session per date, h:mm:ss times, quoted comments", () => {
    const r = parseImport(FITNOTES);
    expect(r.format).toBe("fitnotes");
    expect(r.sessions.map((s) => s.date)).toEqual(["2026-10-12", "2026-10-13"]);
    expect(r.sessions[1]?.sets[0]).toMatchObject({ exerciseId: "dead-hang", seconds: 40 });
    expect(r.sessions[0]?.sets[1]).toMatchObject({ exerciseId: "curl-db", reps: 12, loadKg: 10 });
  });

  test("an unknown file is an error with a reason", () => {
    expect(() => parseImport("a,b\n1,2\n")).toThrow(/Hevy, Strong or FitNotes/);
  });
});
