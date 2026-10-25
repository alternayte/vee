// SPDX-License-Identifier: AGPL-3.0-or-later
// V5: 26 simulated weeks per persona with scripted adherence. A seeded athlete
// model logs the sets. The checks: no load jump over 15% without the
// micro-steps (or calibration), deloads appear, no rung skips over 2, I6 and
// the time budget hold on every session, and the history fold rebuilds the
// same progress state.
import { emptyHistory, rebuildProgress } from "@vee/engine";
import { describe, expect, test } from "vitest";
import { PERSONAS } from "../src/personas";
import { simulate, WEEKS } from "../src/sim";

describe.each(PERSONAS)("simulation: $id", (persona) => {
  const r = simulate(persona);

  test("no violations: micro-steps, rung skips, loads, I6 and time", () => {
    expect(r.violations).toEqual([]);
  });

  test("deloads appear", () => {
    // 26 weeks hold at least 4 blocks of 5 weeks; each block ends in a deload week.
    expect(r.blocks).toBeGreaterThanOrEqual(5);
    expect(r.deloadWeeks.size).toBeGreaterThanOrEqual(4);
  });

  test("the history fold rebuilds the same progress state", () => {
    expect(r.rebuilt).toEqual([...r.input.history.progress].sort((a, b) => a.family.localeCompare(b.family)));
  });

  test("the athlete makes progress", () => {
    const done = r.input.history.sessions.filter((s) => s.status === "done" && s.kind === "main").length;
    expect(done).toBeGreaterThan(WEEKS * persona.trainingDays.length * 0.6);
    const summary = r.input.history.progress
      .map(
        (p) =>
          `${p.family}: ${p.exerciseId}${p.loadKg !== undefined ? ` @ ${p.loadKg} kg` : ""}${p.holdS ? ` ${p.holdS}s` : ""}`,
      )
      .join("\n");
    console.log(
      `--- ${persona.id}: ${done} main sessions, ${r.blocks} blocks, ${r.deloadWeeks.size} deload weeks\n${summary}`,
    );
    const moved = r.input.history.progress.filter((p) => {
      const start = rebuildProgress({
        ...r.input,
        history: { ...emptyHistory(), tests: persona.baseline },
      }).find((s) => s.family === p.family);
      return !start || start.exerciseId !== p.exerciseId || start.loadKg !== p.loadKg;
    });
    expect(moved.length).toBeGreaterThan(0);
  });
});
