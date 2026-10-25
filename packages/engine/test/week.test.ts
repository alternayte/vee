// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  type EngineInput,
  generatePlan,
  type LoggedSet,
  type Prescription,
  prescribe,
  type SessionRecord,
  trainingWeek,
  V_TAPER_LEAN_GAIN,
} from "../src";
import { input } from "./helpers";

/** Logs every prescribed set at its target, at Good. */
function doSession(i: EngineInput, id: string, date: string): EngineInput {
  const p = i.programme;
  const a = p?.templates[0];
  if (!p || !a) throw new Error("no plan");
  const rx: Prescription = { ...prescribe({ ...i, today: date }, a, { readiness: "full" }), sessionId: id };
  const session: SessionRecord = {
    id,
    kind: "main",
    dayType: "A",
    status: "done",
    date,
    readinessMode: "full",
  };
  const sets: LoggedSet[] = rx.items.flatMap((it) =>
    Array.from({ length: it.sets }, (_, n) => ({
      id: `${id}-${it.exerciseId}-${n}`,
      sessionId: id,
      exerciseId: it.exerciseId,
      ...(it.target.unit === "seconds" ? { seconds: it.target.high } : { reps: it.target.low }),
      ...(it.loadKg !== undefined ? { loadKg: it.loadKg } : {}),
      effort: "good" as const,
      loggedAt: `${date}T18:00:00Z`,
    })),
  );
  return {
    ...i,
    history: {
      ...i.history,
      sessions: [...i.history.sessions, session],
      prescriptions: [...i.history.prescriptions, rx],
      sets: [...i.history.sets, ...sets],
    },
  };
}

describe("trainingWeek", () => {
  const start = input();
  const planned = { ...start, programme: generatePlan(start, V_TAPER_LEAN_GAIN) };
  let i = doSession(planned, "s1", "2026-11-03");
  i = doSession(i, "s2", "2026-11-05");

  test("counts the week's sessions and sets", () => {
    const w = trainingWeek(i, "2026-11-02", "2026-11-08");
    expect(w.mainDone).toBe(2);
    expect(w.mainPlanned).toBe(4);
    expect(w.readiness.full).toBe(2);
    expect(w.sets).toBe(i.history.sets.length);
  });

  test("a hold held twice moves up inside the week", () => {
    const w = trainingWeek(i, "2026-11-02", "2026-11-08");
    expect(w.movedUp).toContainEqual({
      family: "vertical-pull",
      exercise: "Dead hang",
      kind: "hold",
      from: 10,
      to: 15,
    });
  });

  test("a week with no sessions has no moves", () => {
    const w = trainingWeek(i, "2026-11-09", "2026-11-15");
    expect([w.mainDone, w.sets, w.movedUp.length]).toEqual([0, 0, 0]);
  });
});
