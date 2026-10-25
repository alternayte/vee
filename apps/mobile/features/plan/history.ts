// SPDX-License-Identifier: AGPL-3.0-or-later
// Edit later (PRD "Session flow"): a past session can be logged, edited,
// moved to another date or removed. Sets are append-only, so an edit is a soft
// delete plus a new row. After each change the engine rebuilds every ladder
// state from the corrected history, so all targets follow it.
import { rebuildProgress } from "@vee/engine";
import { sessions, sets } from "@vee/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/features/db/database";
import { type LoggedSet, logSet, storeProgress } from "@/features/session/data";
import { readEngineInput } from "@/features/training/data";

const now = () => new Date().toISOString();

/** Rebuilds every ladder state from the tests and the finished sessions. */
export async function recompute() {
  const input = await readEngineInput();
  if (input) await storeProgress(rebuildProgress(input));
}

export const recentSessions = () =>
  db
    .select()
    .from(sessions)
    .where(and(isNull(sessions.deleted_at)))
    .orderBy(desc(sessions.date), desc(sessions.created_at))
    .limit(60);

export async function addSet(sessionId: string, s: LoggedSet) {
  await logSet(sessionId, s);
  await recompute();
}

export async function removeSet(setId: string) {
  const at = now();
  await db.update(sets).set({ deleted_at: at, updated_at: at }).where(eq(sets.id, setId));
  await recompute();
}

/** An edit: the old row is soft-deleted and the corrected one written. */
export async function editSet(setId: string, sessionId: string, s: LoggedSet) {
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(sets).set({ deleted_at: at, updated_at: at }).where(eq(sets.id, setId));
  });
  await logSet(sessionId, s);
  await recompute();
}

export async function moveSession(sessionId: string, date: string) {
  await db.update(sessions).set({ date, updated_at: now() }).where(eq(sessions.id, sessionId));
  await recompute();
}

/** Removes the session and its sets from the history. */
export async function removeSession(sessionId: string) {
  const at = now();
  await db.transaction(async (tx) => {
    await tx
      .update(sets)
      .set({ deleted_at: at, updated_at: at })
      .where(and(eq(sets.session_id, sessionId), isNull(sets.deleted_at)));
    await tx.update(sessions).set({ deleted_at: at, updated_at: at }).where(eq(sessions.id, sessionId));
  });
  await recompute();
}

/** A skipped or past session marked as done, for example when the sets were logged later. */
export async function markDone(sessionId: string) {
  await db.update(sessions).set({ status: "done", updated_at: now() }).where(eq(sessions.id, sessionId));
  await recompute();
}
