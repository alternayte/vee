// SPDX-License-Identifier: AGPL-3.0-or-later
// The training numbers for one week (SDD "weekly_review" input). The AI
// writes words around these numbers; it never makes them.
import { rebuildProgress } from "./close";
import { addDays } from "./dates";
import { blockWeek, STALL_SESSIONS } from "./readiness";
import type { EngineInput, LocalDate, ProgressState, ReadinessMode } from "./types";

export type Move = {
  family: string;
  exercise: string;
  kind: "rung" | "load" | "hold";
  from: number;
  to: number;
  unit: "rung" | "kg" | "s";
};

export type TrainingWeek = {
  from: LocalDate;
  to: LocalDate;
  blockWeek: number;
  mainPlanned: number;
  mainDone: number;
  microDone: number;
  skipped: number;
  sets: number;
  readiness: Record<ReadinessMode, number>;
  movedUp: Move[];
  movedDown: Move[];
  stalled: { family: string; exercise: string; sessions: number }[];
};

const name = (input: EngineInput, id?: string) =>
  input.catalogue.exercises.find((e) => e.id === id)?.names.en ?? id ?? "";

function progressUntil(input: EngineInput, date: LocalDate): ProgressState[] {
  const h = input.history;
  return rebuildProgress({
    ...input,
    history: {
      ...h,
      sessions: h.sessions.filter((s) => s.date <= date),
      tests: h.tests.filter((t) => t.date <= date),
    },
  });
}

function moves(input: EngineInput, before: ProgressState[], after: ProgressState[]): Move[] {
  const out: Move[] = [];
  for (const a of after) {
    const b = before.find((x) => x.family === a.family);
    if (!b) continue;
    const exercise = name(input, a.exerciseId);
    if (a.rung !== b.rung)
      out.push({ family: a.family, exercise, kind: "rung", from: b.rung, to: a.rung, unit: "rung" });
    else if (a.loadKg !== undefined && b.loadKg !== undefined && a.loadKg !== b.loadKg)
      out.push({ family: a.family, exercise, kind: "load", from: b.loadKg, to: a.loadKg, unit: "kg" });
    else if (a.holdS !== undefined && b.holdS !== undefined && a.holdS !== b.holdS)
      out.push({ family: a.family, exercise, kind: "hold", from: b.holdS, to: a.holdS, unit: "s" });
  }
  return out;
}

/** The week from `from` to `to`, both included. */
export function trainingWeek(input: EngineInput, from: LocalDate, to: LocalDate): TrainingWeek {
  const inWeek = input.history.sessions.filter((s) => s.date >= from && s.date <= to);
  const done = inWeek.filter((s) => s.status === "done");
  const ids = new Set(done.map((s) => s.id));
  const before = progressUntil(input, addDays(from, -1));
  // A family with no state before the week starts from its first prescription in the week.
  const dateOf = new Map(done.map((x) => [x.id, x.date]));
  const firstToLast = input.history.prescriptions
    .filter((p) => p.sessionId && ids.has(p.sessionId))
    .sort((a, b) => (dateOf.get(a.sessionId ?? "") ?? "").localeCompare(dateOf.get(b.sessionId ?? "") ?? ""));
  for (const rx of firstToLast) {
    for (const it of rx.items) {
      if (before.some((b) => b.family === it.family)) continue;
      const e = input.catalogue.exercises.find((x) => x.id === it.exerciseId);
      const s: ProgressState = { family: it.family, rung: e?.rung ?? 1, exerciseId: it.exerciseId };
      if (it.loadKg !== undefined) s.loadKg = it.loadKg;
      if (it.target.unit === "seconds") s.holdS = it.target.low;
      before.push(s);
    }
  }
  const after = progressUntil(input, to);
  const all = moves(input, before, after);
  const readiness: Record<ReadinessMode, number> = { full: 0, trimmed: 0, recovery: 0 };
  for (const s of done)
    if (s.kind === "main" || s.kind === "recovery") readiness[s.readinessMode ?? "full"]++;
  return {
    from,
    to,
    blockWeek: input.programme ? blockWeek(input.programme, to) : 0,
    mainPlanned: input.programme?.rotation.length ?? 0,
    mainDone: done.filter((s) => s.kind === "main" || s.kind === "recovery").length,
    microDone: done.filter((s) => s.kind === "micro").length,
    skipped: inWeek.filter((s) => s.status === "skipped").length,
    sets: input.history.sets.filter((x) => ids.has(x.sessionId) && x.deletedAt === undefined).length,
    readiness,
    movedUp: all.filter((m) => m.to > m.from),
    movedDown: all.filter((m) => m.to < m.from),
    stalled: after
      .filter((s) => (s.streaks?.stall ?? 0) >= STALL_SESSIONS - 1)
      .map((s) => ({
        family: s.family,
        exercise: name(input, s.exerciseId),
        sessions: s.streaks?.stall ?? 0,
      })),
  };
}
