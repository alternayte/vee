// SPDX-License-Identifier: AGPL-3.0-or-later
// The session runner state (SDD "Session runner"): warm-up → each step → rest
// → … → summary. Each transition is written to the local runner_state table,
// so a crash or an OS kill resumes at the same set. Rest stores its end time,
// not a countdown, so it is right after the phone sleeps.
import type { Reason } from "@vee/engine";
import { runner_state } from "@vee/schema";
import { eq } from "drizzle-orm";
import * as Notifications from "expo-notifications";
import { create } from "zustand";
import { db } from "@/features/db/database";

export type Phase = "warmup" | "work" | "rest" | "summary";

export type Runner = {
  sessionId: string;
  phase: Phase;
  /** Index into the session's steps. */
  cursor: number;
  restEndsAt?: string;
  /** The rows written in this session, newest last, so "Undo" can take one back. */
  logged: string[];
  /** Set when the session is closed. */
  reasons?: Reason[];
  /** The backup notification for the end of the rest. */
  restNotice?: string;
};

export const REST_ADD_S = 30;

async function save(r: Runner) {
  const at = new Date().toISOString();
  const row = {
    id: r.sessionId,
    session_id: r.sessionId,
    cursor: JSON.stringify({ phase: r.phase, cursor: r.cursor }),
    rest_ends_at: r.restEndsAt ?? null,
    json: JSON.stringify(r),
    updated_at: at,
  };
  const existing = await db
    .select({ id: runner_state.id })
    .from(runner_state)
    .where(eq(runner_state.id, r.sessionId));
  if (existing.length) await db.update(runner_state).set(row).where(eq(runner_state.id, r.sessionId));
  else await db.insert(runner_state).values(row);
}

/** The saved state of a session, or a fresh start at the warm-up. */
export async function loadRunner(sessionId: string, hasWarmup: boolean): Promise<Runner> {
  const r = (await db.select().from(runner_state).where(eq(runner_state.id, sessionId)))[0];
  if (r?.json) return JSON.parse(r.json) as Runner;
  const fresh: Runner = { sessionId, phase: hasWarmup ? "warmup" : "work", cursor: 0, logged: [] };
  await save(fresh);
  return fresh;
}

async function cancelNotice(r: Runner) {
  if (r.restNotice) await Notifications.cancelScheduledNotificationAsync(r.restNotice).catch(() => undefined);
}

/** A local notification at the end of the rest: the backup when the screen is off. No sound by default. */
async function scheduleRestEnd(endsAt: Date, next: string): Promise<string | undefined> {
  try {
    await Notifications.setNotificationChannelAsync("rest", {
      name: "Rest timer",
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      vibrationPattern: [0, 300, 150, 300],
    });
    return await Notifications.scheduleNotificationAsync({
      content: { title: "Rest is over", body: next },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: endsAt, channelId: "rest" },
    });
  } catch {
    return undefined;
  }
}

type Store = {
  runner?: Runner;
  set: (r: Runner) => Promise<void>;
};

export const useRunner = create<Store>((setState) => ({
  set: async (r) => {
    setState({ runner: r });
    await save(r);
  },
}));

const commit = (r: Runner) => useRunner.getState().set(r);

export async function warmupDone(r: Runner) {
  await commit({ ...r, phase: "work", cursor: 0 });
}

/**
 * After a set row is written: rest when the step has one, else the next step
 * (a side switch), else the end of the work.
 */
export async function afterSet(
  r: Runner,
  setId: string,
  step: { restS: number },
  last: boolean,
  next: string,
) {
  const logged = [...r.logged, setId];
  if (last) return commit({ ...r, logged, phase: "summary", cursor: r.cursor });
  if (step.restS > 0) {
    const ends = new Date(Date.now() + step.restS * 1000);
    const restNotice = await scheduleRestEnd(ends, next);
    return commit({
      ...r,
      logged,
      phase: "rest",
      restEndsAt: ends.toISOString(),
      ...(restNotice ? { restNotice } : {}),
    });
  }
  return commit({ ...r, logged, phase: "work", cursor: r.cursor + 1 });
}

export async function endRest(r: Runner) {
  await cancelNotice(r);
  const { restEndsAt: _e, restNotice: _n, ...rest } = r;
  await commit({ ...rest, phase: "work", cursor: r.cursor + 1 });
}

export async function addRest(r: Runner, next: string) {
  await cancelNotice(r);
  const ends = new Date(new Date(r.restEndsAt ?? Date.now()).getTime() + REST_ADD_S * 1000);
  const restNotice = await scheduleRestEnd(ends, next);
  await commit({ ...r, restEndsAt: ends.toISOString(), ...(restNotice ? { restNotice } : {}) });
}

/** Back to the step of the last logged set; the caller soft-deletes that row. */
export async function undoLast(r: Runner) {
  await cancelNotice(r);
  const { restEndsAt: _e, restNotice: _n, reasons: _r, ...rest } = r;
  const cursor = r.phase === "rest" || r.phase === "summary" ? r.cursor : Math.max(0, r.cursor - 1);
  await commit({ ...rest, logged: r.logged.slice(0, -1), phase: "work", cursor });
}

export async function closed(r: Runner, reasons: Reason[]) {
  useRunner.setState({ runner: { ...r, phase: "summary", reasons } });
}
