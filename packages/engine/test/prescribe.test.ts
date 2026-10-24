// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  closeSession,
  type EngineInput,
  emptyHistory,
  estimateSeconds,
  generatePlan,
  type History,
  type LoggedSet,
  type Prescription,
  type ProgressState,
  prescribe,
  rebuildProgress,
  type SessionTemplate,
  V_TAPER_LEAN_GAIN,
} from "../src";
import { catalogue, homeKit, input } from "./helpers";

const programme = generatePlan(input(), V_TAPER_LEAN_GAIN);
const day = (d: string): SessionTemplate =>
  programme.templates.find((t) => t.dayType === d) as SessionTemplate;
const withProgress = (progress: ProgressState[], over: Partial<EngineInput> = {}) =>
  input({ programme, history: { ...emptyHistory(), progress }, ...over });
const item = (p: Prescription, exerciseId: string) => p.items.find((i) => i.exerciseId === exerciseId);

describe("prescribe: full session", () => {
  test("copies the template and freezes the engine version", () => {
    const p = prescribe(input({ programme }), day("A"), { readiness: "full" });
    expect(p.items.map((i) => i.exerciseId)).toEqual(day("A").items.map((i) => i.exerciseId));
    expect(p).toMatchObject({
      kind: "main",
      dayType: "A",
      readinessMode: "full",
      deload: false,
      engineVersion: "1",
    });
  });

  test("tempo stages show in the tempo, and stage 3 adds a set", () => {
    const at = (stage: 0 | 1 | 2 | 3) =>
      item(
        prescribe(
          withProgress([
            {
              family: "lateral-raise",
              rung: 2,
              exerciseId: "lateral-raise-db",
              loadKg: 4,
              tempoStage: stage,
            },
          ]),
          day("A"),
          { readiness: "full" },
        ),
        "lateral-raise-db",
      );
    expect(at(0)?.tempo).toBe("2-0-1-1");
    expect(at(1)?.tempo).toBe("3-0-1-1");
    expect(at(2)?.tempo).toBe("3-1-1-1");
    expect((at(3)?.sets ?? 0) - (at(0)?.sets ?? 0)).toBe(1);
    expect(at(3)?.reasons.tempo?.ruleId).toBe("TEMPO_STAGE");
  });

  test("timed work prescribes the hold target", () => {
    const p = prescribe(
      withProgress([{ family: "vertical-pull", rung: 1, exerciseId: "dead-hang", holdS: 25 }]),
      day("A"),
      {
        readiness: "full",
      },
    );
    expect(item(p, "dead-hang")?.target).toEqual({ unit: "seconds", low: 25, high: 25 });
  });

  test("band assist starts with the most help and keeps the stored setting", () => {
    const fresh = prescribe(withProgress([{ family: "vertical-pull", rung: 4 }]), day("A"), {
      readiness: "full",
    });
    expect(item(fresh, "pullup-band-assisted")?.band).toEqual({ bandId: "band", setting: "double" });
    const kept = prescribe(
      withProgress([
        {
          family: "vertical-pull",
          rung: 4,
          exerciseId: "pullup-band-assisted",
          band: { bandId: "band", setting: "single" },
        },
      ]),
      day("A"),
      { readiness: "full" },
    );
    expect(item(kept, "pullup-band-assisted")?.band?.setting).toBe("single");
  });

  test("a placement range replaces the catalogue range", () => {
    const p = prescribe(
      withProgress([
        { family: "vertical-pull", rung: 5, exerciseId: "pullup-strict", repOverride: { low: 1, high: 3 } },
      ]),
      day("A"),
      { readiness: "full" },
    );
    expect(item(p, "pullup-strict")?.target).toEqual({ unit: "reps", low: 1, high: 3 });
  });

  test("re-picks with today's kit (I6)", () => {
    const noBand = homeKit.filter((k) => k.kind !== "band");
    const p = prescribe(withProgress([{ family: "vertical-pull", rung: 4 }], { kit: noBand }), day("A"), {
      readiness: "full",
    });
    expect(p.items[0]?.exerciseId).toBe("pullup-negative");
  });

  test("the warm-up is one light set of the first main movements", () => {
    const p = prescribe(
      withProgress([{ family: "squat", rung: 1, exerciseId: "goblet-squat", loadKg: 12 }]),
      day("B"),
      { readiness: "full" },
    );
    expect(p.warmup.length).toBeGreaterThan(0);
    expect(p.warmup.length).toBeLessThanOrEqual(2);
    expect(p.warmup[0]).toMatchObject({ exerciseId: "goblet-squat", sets: 1, loadKg: 6 });
  });
});

describe("prescribe: readiness, deload and climbing", () => {
  test("Trimmed removes one set per movement", () => {
    const full = prescribe(input({ programme }), day("C"), { readiness: "full" });
    const trimmed = prescribe(input({ programme }), day("C"), { readiness: "trimmed" });
    for (const t of trimmed.items) {
      const f = full.items.find((x) => x.exerciseId === t.exerciseId);
      expect(t.sets).toBe(Math.max(1, (f?.sets ?? 0) - 1));
    }
    expect(trimmed.readinessMode).toBe("trimmed");
  });

  test("Recovery is 15 min: mobility plus the two main movements at 2 sets", () => {
    const p = prescribe(input({ programme }), day("A"), { readiness: "recovery" });
    expect(p.kind).toBe("recovery");
    expect(p.estimatedMinutes).toBeLessThanOrEqual(15);
    const mains = p.items.filter((i) => i.role === "main");
    expect(mains).toHaveLength(2);
    for (const m of mains) expect(m.sets).toBe(2);
    expect(p.items.some((i) => i.family === "mobility")).toBe(true);
  });

  test("a deload week halves the sets", () => {
    const full = prescribe(input({ programme }), day("D"), { readiness: "full" });
    const deload = prescribe(input({ programme, today: "2026-11-30" }), day("D"), { readiness: "full" });
    expect(deload.deload).toBe(true);
    for (const d of deload.items) {
      const f = full.items.find((x) => x.exerciseId === d.exerciseId);
      expect(d.sets).toBe(Math.ceil((f?.sets ?? 0) / 2));
    }
  });

  test("a climb in the last 48 h takes one vertical-pull set off A and D", () => {
    const climb: History = {
      ...emptyHistory(),
      sessions: [{ id: "c", kind: "climb", status: "done", date: "2026-11-01" }],
    };
    const base = prescribe(input({ programme }), day("A"), { readiness: "full" });
    const after = prescribe(input({ programme, history: climb }), day("A"), { readiness: "full" });
    const vp = (p: Prescription) => p.items.find((i) => i.family === "vertical-pull")?.sets ?? 0;
    expect(vp(after)).toBe(vp(base) - 1);
    const b = prescribe(input({ programme, history: climb }), day("B"), { readiness: "full" });
    expect(b.reasons.some((r) => r.ruleId === "CLIMB_PULL")).toBe(false);
  });

  test('"only 20 min" fits 20 min and keeps the first main movement', () => {
    const p = prescribe(input({ programme }), day("B"), { readiness: "full", minutes: 20 });
    expect(estimateSeconds(p.items, catalogue)).toBeLessThanOrEqual(20 * 60);
    expect(p.items[0]?.exerciseId).toBe(day("B").items[0]?.exerciseId);
  });

  test("every number carries a reason", () => {
    const p = prescribe(input({ programme }), day("B"), { readiness: "trimmed" });
    for (const i of p.items) {
      expect(i.reasons.sets.length).toBeGreaterThan(0);
      if (i.loadKg !== undefined) expect(i.reasons.load).toBeDefined();
      if (i.band !== undefined) expect(i.reasons.band).toBeDefined();
      if (i.tempo !== undefined) expect(i.reasons.tempo).toBeDefined();
    }
  });
});

describe("closeSession and rebuildProgress", () => {
  function sessionWith(i: EngineInput, id: string, date: string, reps: (n: number) => number): EngineInput {
    const next = { ...i, today: date };
    const p = { ...prescribe(next, day("B"), { readiness: "full" }), sessionId: id };
    const sets: LoggedSet[] = p.items.flatMap((it) => {
      const sides = catalogue.exercises.find((e) => e.id === it.exerciseId)?.unilateral
        ? ["left", "right"]
        : [undefined];
      return Array.from({ length: it.sets }, (_, k) =>
        sides.map(
          (side): LoggedSet => ({
            id: `${id}-${it.exerciseId}-${k}-${side ?? ""}`,
            sessionId: id,
            exerciseId: it.exerciseId,
            ...(side ? { side: side as "left" | "right" } : {}),
            ...(it.target.unit === "seconds" ? { seconds: it.target.high } : { reps: reps(it.target.high) }),
            effort: "good",
            loggedAt: `${date}T19:00:00Z`,
          }),
        ),
      ).flat();
    });
    const history: History = {
      ...next.history,
      sessions: [
        ...next.history.sessions,
        { id, kind: "main", dayType: "B", status: "done", date, readinessMode: "full" },
      ],
      prescriptions: [...next.history.prescriptions, p],
      sets: [...next.history.sets, ...sets],
    };
    const closed = closeSession({ ...next, history }, id);
    return { ...next, history: { ...history, progress: closed.progress } };
  }

  test("two top sessions move the goblet squat load up a step", () => {
    let i = input({
      programme,
      history: {
        ...emptyHistory(),
        progress: [{ family: "squat", rung: 1, exerciseId: "goblet-squat", loadKg: 16 }],
      },
    });
    i = sessionWith(i, "b1", "2026-11-03", (h) => h);
    i = sessionWith(i, "b2", "2026-11-07", (h) => h);
    expect(i.history.progress.find((p) => p.family === "squat")?.loadKg).toBe(18);
  });

  test("a deload session resets every stall count, so the same stalls do not start another deload", () => {
    const stalled = (family: string): ProgressState => ({
      family,
      rung: 1,
      streaks: { top: 0, miss: 0, stall: 3, hold: 0 },
    });
    const history: History = {
      ...emptyHistory(),
      progress: [stalled("row"), stalled("curl")],
      sessions: [{ id: "d1", kind: "main", dayType: "B", status: "done", date: "2026-11-30", deload: true }],
      prescriptions: [
        { ...prescribe(input({ programme }), day("B"), { readiness: "full" }), sessionId: "d1" },
      ],
    };
    const closed = closeSession(input({ programme, history }), "d1");
    for (const p of closed.progress) expect(p.streaks?.stall ?? 0).toBe(0);
  });

  test("rebuilding from history gives the same progress as closing each session", () => {
    let i = input({
      programme,
      history: { ...emptyHistory(), tests: [{ date: "2026-11-01", item: "pushups", value: 12 }] },
    });
    i = { ...i, history: { ...i.history, progress: rebuildProgress(i) } };
    i = sessionWith(i, "b1", "2026-11-03", (h) => h);
    i = sessionWith(i, "b2", "2026-11-05", (h) => h - 1);
    i = sessionWith(i, "b3", "2026-11-07", (h) => h);
    i = sessionWith(i, "b4", "2026-11-09", (h) => h);
    const rebuilt = rebuildProgress({ ...i, history: { ...i.history, progress: [] } });
    expect(rebuilt).toEqual([...i.history.progress].sort((a, b) => a.family.localeCompare(b.family)));
    expect(rebuilt.find((p) => p.family === "push-up")?.rung).toBe(2);
  });
});
