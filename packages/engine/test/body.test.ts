// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  bestSets,
  consistency,
  destinationGap,
  type EngineInput,
  emptyHistory,
  generatePlan,
  type LoggedSet,
  muscleWeek,
  type SessionRecord,
  testDue,
  V_TAPER_LEAN_GAIN,
} from "../src";
import { input } from "./helpers";

function withSessions(sessions: SessionRecord[], sets: LoggedSet[]): EngineInput {
  const i = input();
  return {
    ...i,
    programme: generatePlan(i, V_TAPER_LEAN_GAIN),
    history: { ...emptyHistory(), sessions, sets },
  };
}

const set = (
  id: string,
  sessionId: string,
  exerciseId: string,
  over: Partial<LoggedSet> = {},
): LoggedSet => ({
  id,
  sessionId,
  exerciseId,
  reps: 10,
  effort: "good",
  loggedAt: "2026-11-01T10:00:00Z",
  ...over,
});

describe("muscleWeek", () => {
  test("counts this week's sets per group, a side as half, and marks recovering and untrained groups", () => {
    const i = withSessions(
      [
        { id: "s1", kind: "main", status: "done", date: "2026-11-01" },
        { id: "old", kind: "main", status: "done", date: "2026-10-20" },
      ],
      [
        set("a", "s1", "goblet-squat"),
        set("b", "s1", "goblet-squat"),
        set("c", "s1", "goblet-squat"),
        set("d", "s1", "row-single-arm-db", { side: "left" }),
        set("e", "s1", "row-single-arm-db", { side: "right" }),
        set("f", "old", "push-up"),
      ],
    );
    const w = muscleWeek(i, "2026-11-02");
    expect(w.sets.quads).toBe(3);
    expect(w.sets["lats-upper-back"]).toBe(1);
    expect(w.sets.chest).toBe(0);
    expect(w.recovering).toContain("quads");
    expect(w.recovering).not.toContain("lats-upper-back");
    expect(w.untrained).toContain("chest");
  });
});

test("best sets: the heaviest load per session, then the most reps", () => {
  const i = withSessions(
    [{ id: "s1", kind: "main", status: "done", date: "2026-11-01" }],
    [
      set("a", "s1", "row-single-arm-db", { reps: 12, loadKg: 8 }),
      set("b", "s1", "row-single-arm-db", { reps: 8, loadKg: 10 }),
      set("c", "s1", "row-single-arm-db", { reps: 9, loadKg: 10 }),
    ],
  );
  expect(bestSets(i, "row-single-arm-db")).toEqual([{ date: "2026-11-01", value: 9, unit: "reps", kg: 10 }]);
});

test("consistency counts main sessions against the rotation per 4 weeks", () => {
  const i = withSessions(
    [
      { id: "s1", kind: "main", status: "done", date: "2026-11-01" },
      { id: "s2", kind: "main", status: "skipped", date: "2026-10-30" },
      { id: "s3", kind: "micro", status: "done", date: "2026-10-29" },
    ],
    [],
  );
  const last = consistency(i, 1)[0];
  expect(last).toMatchObject({ done: 1, planned: (i.programme?.rotation.length ?? 0) * 4 });
});

test("the test is due until a test is logged this month", () => {
  const i = input({ today: "2026-11-02" });
  expect(testDue(i)).toBe(true);
  expect(
    testDue({ ...i, history: { ...i.history, tests: [{ date: "2026-11-01", item: "hang", value: 30 }] } }),
  ).toBe(false);
});

test("a destination gap uses the latest result of each item", () => {
  const gap = destinationGap(
    [
      { item: "hang", value: 60 },
      { item: "pullups", value: 5 },
    ],
    [
      { date: "2026-10-01", item: "hang", value: 70 },
      { date: "2026-11-01", item: "hang", value: 40 },
    ],
  );
  expect(gap).toEqual([
    { item: "hang", want: 60, have: 40, met: false },
    { item: "pullups", want: 5, met: false },
  ]);
});
