// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  climbedRecently,
  type EngineInput,
  emptyHistory,
  generatePlan,
  microSession,
  nextSession,
  type SessionRecord,
  substitute,
  V_TAPER_LEAN_GAIN,
} from "../src";
import { ex, homeKit, input } from "./helpers";

const programme = generatePlan(input(), V_TAPER_LEAN_GAIN);

function withSessions(sessions: Partial<SessionRecord>[], over: Partial<EngineInput> = {}): EngineInput {
  const rows = sessions.map(
    (s, i): SessionRecord => ({ id: `s${i}`, kind: "main", status: "done", date: "2026-11-02", ...s }),
  );
  return input({ programme, history: { ...emptyHistory(), sessions: rows }, ...over });
}

describe("nextSession", () => {
  test("a new block starts with A", () => {
    expect(nextSession(withSessions([])).template.dayType).toBe("A");
  });

  test("the next session is the next one not done, whatever the weekday", () => {
    expect(nextSession(withSessions([{ dayType: "A" }, { dayType: "B" }])).template.dayType).toBe("C");
  });

  test("a skipped session stays next", () => {
    const i = withSessions([{ dayType: "A" }, { dayType: "B", status: "skipped" }]);
    expect(nextSession(i).template.dayType).toBe("B");
  });

  test("after a full cycle, A comes again", () => {
    const i = withSessions([{ dayType: "A" }, { dayType: "B" }, { dayType: "C" }, { dayType: "D" }]);
    expect(nextSession(i).template.dayType).toBe("A");
  });

  test("a session done out of order does not count twice", () => {
    const i = withSessions([{ dayType: "A" }, { dayType: "C" }, { dayType: "A" }]);
    expect(nextSession(i).template.dayType).toBe("B");
  });

  test("micro and climb sessions do not move the rotation", () => {
    const i = withSessions([{ dayType: "A" }, { kind: "micro" }, { kind: "climb" }]);
    expect(nextSession(i).template.dayType).toBe("B");
  });

  test("the reason says why", () => {
    expect(nextSession(withSessions([{ dayType: "A" }])).reason.ruleId).toBe("ROTATION_NEXT");
  });
});

describe("microSession", () => {
  test("is offered the day after a main session", () => {
    const i = withSessions([{ dayType: "A", date: "2026-11-02" }], { today: "2026-11-03" });
    const m = microSession(i);
    expect(m?.kind).toBe("micro");
    expect(m?.items.some((x) => x.family === "mobility")).toBe(true);
  });

  test("is not offered on other days", () => {
    expect(
      microSession(withSessions([{ dayType: "A", date: "2026-11-02" }], { today: "2026-11-04" })),
    ).toBeUndefined();
  });

  test("at most 2 a week", () => {
    const i = withSessions(
      [
        { dayType: "A", date: "2026-11-02" },
        { kind: "micro", date: "2026-11-03" },
        { dayType: "B", date: "2026-11-04" },
        { kind: "micro", date: "2026-11-05" },
        { dayType: "C", date: "2026-11-06" },
      ],
      { today: "2026-11-07" },
    );
    expect(microSession(i)).toBeUndefined();
  });

  test("without strict pull-ups, hangs at 50–60% of the best hang", () => {
    const i = withSessions([{ dayType: "A", date: "2026-11-02" }], {
      today: "2026-11-03",
      history: {
        ...emptyHistory(),
        sessions: [{ id: "a", kind: "main", dayType: "A", status: "done", date: "2026-11-02" }],
        tests: [{ date: "2026-11-01", item: "hang", value: 30 }],
      },
    });
    const hang = microSession(i)?.items.find((x) => x.exerciseId === "dead-hang");
    expect(hang?.target).toEqual({ unit: "seconds", low: 15, high: 18 });
  });

  test("with strict pull-ups, singles or doubles at 50–60% of the best", () => {
    const i = withSessions([], {
      today: "2026-11-03",
      history: {
        ...emptyHistory(),
        progress: [{ family: "vertical-pull", rung: 5, exerciseId: "pullup-strict" }],
        sessions: [{ id: "a", kind: "main", dayType: "A", status: "done", date: "2026-11-02" }],
        tests: [{ date: "2026-11-01", item: "pullups", value: 5 }],
      },
    });
    const singles = microSession(i)?.items.find((x) => x.exerciseId === "pullup-strict");
    expect(singles?.target).toEqual({ unit: "reps", low: 3, high: 3 });
  });

  test("an acute shoulder flag leaves mobility only", () => {
    const i = withSessions([{ dayType: "A", date: "2026-11-02" }], {
      today: "2026-11-03",
      flags: [{ joint: "shoulder", severity: "acute", activeFrom: "2026-01-01" }],
    });
    const m = microSession(i);
    expect(m?.items.every((x) => x.family === "mobility")).toBe(true);
    expect(m?.items.every((x) => x.exerciseId !== "band-shoulder-dislocate")).toBe(true);
  });
});

describe("climbedRecently", () => {
  test("a climb in the last 48 h counts", () => {
    expect(
      climbedRecently(withSessions([{ kind: "climb", date: "2026-11-01" }], { today: "2026-11-03" })),
    ).toBe(true);
    expect(
      climbedRecently(withSessions([{ kind: "climb", date: "2026-10-31" }], { today: "2026-11-03" })),
    ).toBe(false);
  });
});

describe("substitute", () => {
  test("ranks the same rung first, then ±1 rung, then the same pattern and primary muscle", () => {
    const c = substitute(input(), "row-single-arm-db").map((x) => x.exerciseId);
    expect(c[0]).toBe("row-band");
    const strict = substitute(input(), "pullup-strict").map((x) => x.exerciseId);
    expect(strict.indexOf("pullup-band-assisted")).toBeLessThan(strict.indexOf("chinup-strict"));
    expect(strict).toContain("chinup-strict");
  });

  test("never offers what kit or flags rule out", () => {
    const flags = [{ joint: "shoulder", severity: "mild", activeFrom: "2026-01-01" }] as const;
    const c = substitute(input({ flags: [...flags] }), "pullup-pause").map((x) => x.exerciseId);
    expect(c).not.toContain("pullup-weighted");
    expect(c).not.toContain("pullup-neutral-grip");
    expect(c.length).toBeGreaterThan(0);
  });

  test("each candidate carries a reason", () => {
    for (const x of substitute(input({ kit: homeKit }), "goblet-squat")) {
      expect(x.reason.text.length).toBeGreaterThan(0);
      expect(ex(x.exerciseId).id).toBe(x.exerciseId);
    }
  });
});
