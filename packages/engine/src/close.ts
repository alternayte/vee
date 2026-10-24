// SPDX-License-Identifier: AGPL-3.0-or-later
// Session close and the history fold. progress_state is a cache: replaying
// tests and finished sessions in date order rebuilds it.
import { applyPlacements, placeFromTest } from "./placement";
import { evaluate, type ProgressContext, ZERO_STREAKS } from "./progression";
import type { EngineInput, PrescribedItem, ProgressState, Reason, SessionRecord, TestResult } from "./types";

export type CloseResult = { progress: ProgressState[]; reasons: Record<string, Reason[]> };

function startState(ctx: ProgressContext, item: PrescribedItem): ProgressState {
  const e = ctx.catalogue.exercises.find((x) => x.id === item.exerciseId);
  const s: ProgressState = {
    family: item.family,
    rung: e?.rung ?? 1,
    exerciseId: item.exerciseId,
    streaks: { ...ZERO_STREAKS },
  };
  if (item.loadKg !== undefined) s.loadKg = item.loadKg;
  if (item.band !== undefined) s.band = item.band;
  if (item.target.unit === "seconds") s.holdS = item.target.low;
  return s;
}

function closeOne(
  ctx: ProgressContext,
  input: EngineInput,
  progress: ProgressState[],
  session: SessionRecord,
): CloseResult {
  const prescription = input.history.prescriptions.find((p) => p.sessionId === session.id);
  const reasons: Record<string, Reason[]> = {};
  if (!prescription || session.status !== "done") return { progress, reasons };
  const sets = input.history.sets.filter((x) => x.sessionId === session.id && x.deletedAt === undefined);
  let out = [...progress];
  for (const item of prescription.items) {
    const current = out.find((p) => p.family === item.family) ?? startState(ctx, item);
    const r = evaluate(ctx, current, item, sets, session);
    out = [...out.filter((p) => p.family !== item.family), r.next];
    if (r.reasons.length > 0) reasons[item.family] = r.reasons;
  }
  return { progress: out.sort((a, b) => a.family.localeCompare(b.family)), reasons };
}

/** Runs the progression rules for each prescribed exercise of a finished session. */
export function closeSession(input: EngineInput, sessionId: string): CloseResult {
  const session = input.history.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`no session ${sessionId}`);
  return closeOne(input, input, input.history.progress, session);
}

/** Rebuilds progress from tests and finished sessions, oldest first. Tests on a day come before its sessions. */
export function rebuildProgress(input: EngineInput): ProgressState[] {
  type Event = { date: string; order: number; tests?: TestResult[]; session?: SessionRecord };
  const testDays = new Map<string, TestResult[]>();
  for (const t of input.history.tests) testDays.set(t.date, [...(testDays.get(t.date) ?? []), t]);
  const events: Event[] = [
    ...[...testDays].map(([date, tests]) => ({ date, order: 0, tests })),
    ...input.history.sessions
      .filter((s) => s.status === "done")
      .map((session, i) => ({ date: session.date, order: 1 + i, session })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  let progress: ProgressState[] = [];
  for (const ev of events) {
    const ctx: ProgressContext = {
      catalogue: input.catalogue,
      kit: input.kit,
      flags: input.flags,
      today: ev.date,
    };
    if (ev.tests) {
      const at = { ...input, today: ev.date, history: { ...input.history, progress } };
      progress = applyPlacements(ctx, progress, placeFromTest(at, ev.tests));
    } else if (ev.session) {
      progress = closeOne(ctx, input, progress, ev.session).progress;
    }
  }
  return progress.sort((a, b) => a.family.localeCompare(b.family));
}
