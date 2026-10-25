// SPDX-License-Identifier: AGPL-3.0-or-later
// A session on the local database (SDD "Session runner"). The check-in
// freezes the prescription (I3); each tap writes its set row before anything
// else moves (I5); the close runs the progression rules and stores the new
// ladder states. The engine sets every number.
import {
  type Checkin,
  closeSession,
  type EngineInput,
  nextSession,
  type PrescribeContext,
  type Prescription,
  type ProgressState,
  prescribe,
  type Reason,
  readinessMode,
  readinessScore,
} from "@vee/engine";
import { checkins, prescriptions, progress_state, runner_state, sessions, sets, uuidv7 } from "@vee/schema";
import { progressRows } from "@vee/schema/engine";
import { and, eq, isNull } from "drizzle-orm";
import { lastNightSleepMin, writeSession } from "@/features/body/health";
import { db } from "@/features/db/database";
import { localDate } from "@/features/food/data";
import { readEngineInput } from "@/features/training/data";

const now = () => new Date().toISOString();

export type CheckinAnswers = Pick<Checkin, "energy" | "soreness" | "sleep">;

/** "Adjust today" answers that the session start uses. */
export type TodayAdjustment = Pick<PrescribeContext, "minutes" | "focus">;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The frozen prescription rows of a session (I3). */
async function writePrescription(
  tx: Tx,
  sessionId: string,
  rx: Prescription,
  stamp: { created_at: string; updated_at: string },
) {
  const row = (section: "warmup" | "main", i: Prescription["items"][number]) => ({
    id: uuidv7(),
    session_id: sessionId,
    section,
    item_order: i.order,
    family: i.family,
    exercise_id: i.exerciseId,
    role: i.role,
    sets: i.sets,
    target: JSON.stringify(i.target),
    load_kg: i.loadKg ?? null,
    band: i.band ? JSON.stringify(i.band) : null,
    tempo: i.tempo ?? null,
    rest_s: i.restS,
    pair_group: i.pairGroup ?? null,
    reasons: JSON.stringify(i.reasons),
    engine_version: rx.engineVersion,
    ...stamp,
  });
  for (const i of rx.warmup) await tx.insert(prescriptions).values(row("warmup", i));
  for (const i of rx.items) await tx.insert(prescriptions).values(row("main", i));
}

/**
 * A session logged after the fact (PRD "Edit later"): the day's prescription
 * as the plan has it now, at full readiness. The sets are added on the edit
 * screen, and every ladder state is rebuilt from the corrected history.
 */
export async function logPastSession(date: string, dayType: string): Promise<string> {
  const input = await readEngineInput();
  const template = input?.programme?.templates.find((t) => t.dayType === dayType);
  if (!input || !template) throw new Error("This day is not in your plan.");
  const id = uuidv7();
  const rx = prescribe({ ...input, today: date }, template, { readiness: "full", sessionId: id });
  const at = now();
  const stamp = { created_at: at, updated_at: at };
  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      id,
      kind: rx.kind,
      day_type: rx.dayType ?? null,
      status: "done",
      date,
      readiness_mode: rx.readinessMode,
      deload: rx.deload ? 1 : 0,
      ...stamp,
    });
    await writePrescription(tx, id, rx, stamp);
  });
  return id;
}

/** Starts the next session: the check-in, the frozen prescription, and the session row, in one transaction. */
export async function startSession(answers: CheckinAnswers, adjust: TodayAdjustment = {}): Promise<string> {
  const input = await readEngineInput();
  if (!input?.programme) throw new Error("No plan yet. Finish onboarding first.");
  const today = localDate();
  const id = uuidv7();
  // Health Connect sleep under 6 h counts as bad sleep (SDD "Readiness").
  const hcSleepMin = await lastNightSleepMin();
  const checkin: Checkin = {
    sessionId: id,
    date: today,
    ...answers,
    ...(hcSleepMin !== undefined ? { hcSleepMin } : {}),
  };
  const mode = readinessMode(readinessScore(checkin));
  const { template } = nextSession(input);
  const rx = prescribe(input, template, {
    readiness: mode,
    sessionId: id,
    ...(adjust.minutes !== undefined ? { minutes: adjust.minutes } : {}),
    ...(adjust.focus?.length ? { focus: adjust.focus } : {}),
  });
  const at = now();
  const stamp = { created_at: at, updated_at: at };
  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      id,
      kind: rx.kind,
      day_type: rx.dayType ?? null,
      status: "active",
      date: today,
      started_at: at,
      readiness_mode: rx.readinessMode,
      deload: rx.deload ? 1 : 0,
      ...stamp,
    });
    await tx.insert(checkins).values({
      id: uuidv7(),
      session_id: id,
      date: today,
      ...answers,
      hc_sleep_min: hcSleepMin ?? null,
      ...stamp,
    });
    await writePrescription(tx, id, rx, stamp);
  });
  return id;
}

/** The session's frozen prescription and the engine input it runs against. */
export async function readSession(
  sessionId: string,
): Promise<{ input: EngineInput; rx: Prescription; reasons: Reason[] } | undefined> {
  const input = await readEngineInput();
  const rx = input?.history.prescriptions.find((p) => p.sessionId === sessionId);
  if (!input || !rx) return undefined;
  return { input, rx, reasons: rx.reasons };
}

export type LoggedSet = {
  exerciseId: string;
  side?: "left" | "right";
  reps?: number;
  seconds?: number;
  loadKg?: number;
  effort: "easy" | "good" | "hard" | "failed";
};

/** Writes one set. The caller advances the runner only after this resolves (I5). */
export async function logSet(sessionId: string, s: LoggedSet): Promise<string> {
  const id = uuidv7();
  const at = now();
  await db.insert(sets).values({
    id,
    session_id: sessionId,
    exercise_id: s.exerciseId,
    side: s.side ?? null,
    reps: s.reps ?? null,
    seconds: s.seconds ?? null,
    load_kg: s.loadKg ?? null,
    effort: s.effort,
    logged_at: at,
    created_at: at,
    updated_at: at,
  });
  return id;
}

/** Takes back the last set: sets are append-only, so this is a soft delete. */
export async function undoSet(setId: string) {
  const at = now();
  await db.update(sets).set({ deleted_at: at, updated_at: at }).where(eq(sets.id, setId));
}

/**
 * Finishes the session and runs the progression rules. The new ladder states
 * replace the old rows; the reasons say what moved and what comes next time.
 */
export async function finishSession(sessionId: string): Promise<Reason[]> {
  const at = now();
  await db
    .update(sessions)
    .set({ status: "done", ended_at: at, updated_at: at })
    .where(eq(sessions.id, sessionId));
  const input = await readEngineInput();
  if (!input) return [];
  const closed = closeSession(input, sessionId);
  const row = (await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0];
  if (row?.started_at)
    await writeSession(`Vee session ${row.day_type ?? ""}`.trim(), row.started_at, at).catch(() => undefined);
  await storeProgress(closed.progress);
  await db.delete(runner_state).where(eq(runner_state.session_id, sessionId));
  return Object.values(closed.reasons).flat();
}

/** Replaces the ladder states: the old rows are soft-deleted, so the change syncs. */
export async function storeProgress(progress: ProgressState[]) {
  const at = now();
  const old = await db
    .select({ id: progress_state.id })
    .from(progress_state)
    .where(isNull(progress_state.deleted_at));
  await db.transaction(async (tx) => {
    for (const r of old)
      await tx
        .update(progress_state)
        .set({ deleted_at: at, updated_at: at })
        .where(eq(progress_state.id, r.id));
    for (const row of progressRows(progress, { newId: uuidv7, now: at }))
      await tx.insert(progress_state).values(row);
  });
}

/** A skip has no penalty (PRD "Readiness"): the rotation moves on. */
export async function skipSession(sessionId: string) {
  const at = now();
  await db
    .update(sessions)
    .set({ status: "skipped", ended_at: at, updated_at: at })
    .where(eq(sessions.id, sessionId));
  await db.delete(runner_state).where(eq(runner_state.session_id, sessionId));
}

/** Skips today's session before it starts. The same day stays next; the week review counts the skip. */
export async function skipNext() {
  const input = await readEngineInput();
  if (!input?.programme) return;
  const { template } = nextSession(input);
  const at = now();
  await db.insert(sessions).values({
    id: uuidv7(),
    kind: "main",
    day_type: template.dayType,
    status: "skipped",
    date: localDate(),
    ended_at: at,
    created_at: at,
    updated_at: at,
  });
}

/** The active session, for crash resume and the Today card. */
export async function activeSessionId(): Promise<string | undefined> {
  const r = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.status, "active"), isNull(sessions.deleted_at)))
    .limit(1);
  return r[0]?.id;
}
