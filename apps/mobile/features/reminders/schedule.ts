// SPDX-License-Identifier: AGPL-3.0-or-later
// Local reminders (SDD "Notifications"): scheduleAll() cancels Vee's reminders
// and makes them again from the current data, so they never drift. It runs on
// app start and after each session, settings or review change. Quiet hours
// (default 21:30 to 07:30) hold back every reminder; the rest-end alert of an
// active session is not a reminder and is not touched here.
import { testDue } from "@vee/engine";
import { profiles, sessions, ui_prefs } from "@vee/schema";
import { and, eq, gte, isNull } from "drizzle-orm";
import * as Notifications from "expo-notifications";
import { useAccount } from "@/features/account/account";
import { db } from "@/features/db/database";
import { localDate } from "@/features/food/data";
import { readEngineInput } from "@/features/training/data";
import { updateWidget } from "./widget";

const PREFIX = "vee-remind-";
export const NUDGE = { hour: 19, minute: 30 };
export const REVIEW = { hour: 19, minute: 0 };
export const QUIET = { from: "21:30", to: "07:30" };
const DAYS_AHEAD = 7;

export const REMINDERS = [
  { key: "remind_nudge", label: "Session reminder at 19:30 on a training day" },
  { key: "remind_review", label: "Weekly review ready, Sunday 19:00" },
  { key: "remind_test", label: "Test day, once a month" },
] as const;
export type ReminderKey = (typeof REMINDERS)[number]["key"];

/**
 * The training weekdays for a number of sessions a week (0 Sunday … 6
 * Saturday), spread so rest days fall between them. The plan has no weekdays
 * of its own; this decides which days get the nudge.
 */
export function trainingDays(perWeek: number): number[] {
  const table: Record<number, number[]> = {
    1: [1],
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 4, 5],
    6: [1, 2, 3, 4, 5, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return table[Math.min(7, Math.max(1, Math.round(perWeek)))] ?? [1, 3, 5];
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** True when the clock time falls inside quiet hours (which may wrap past midnight). */
export function inQuiet(d: Date, quiet = QUIET): boolean {
  const m = d.getHours() * 60 + d.getMinutes();
  const from = minutes(quiet.from);
  const to = minutes(quiet.to);
  return from <= to ? m >= from && m < to : m >= from || m < to;
}

async function enabled(): Promise<Record<ReminderKey, boolean>> {
  const rows = await db.select().from(ui_prefs);
  const off = new Set(rows.filter((r) => r.value === "0").map((r) => r.key));
  return Object.fromEntries(REMINDERS.map((r) => [r.key, !off.has(r.key)])) as Record<ReminderKey, boolean>;
}

export async function setReminder(key: ReminderKey, on: boolean) {
  await db.delete(ui_prefs).where(eq(ui_prefs.key, key));
  if (!on) await db.insert(ui_prefs).values({ id: `${key}`, key, value: "0" });
  if (on) await Notifications.requestPermissionsAsync().catch(() => undefined);
  await scheduleAll();
}

const at = (day: Date, t: { hour: number; minute: number }) => {
  const d = new Date(day);
  d.setHours(t.hour, t.minute, 0, 0);
  return d;
};

async function schedule(id: string, date: Date, title: string, body: string) {
  if (date.getTime() <= Date.now() || inQuiet(date)) return;
  await Notifications.scheduleNotificationAsync({
    identifier: `${PREFIX}${id}`,
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: "reminders" },
  });
}

/** Cancels Vee's reminders and makes them again from the current data. */
export async function scheduleAll(): Promise<void> {
  await updateWidget().catch(() => undefined);
  try {
    const { status } = await Notifications.getPermissionsAsync();
    const planned = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of planned)
      if (n.identifier.startsWith(PREFIX)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    if (status !== "granted") return;
    await Notifications.setNotificationChannelAsync("reminders", {
      name: "Reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    const on = await enabled();
    const profile = (await db.select().from(profiles).where(isNull(profiles.deleted_at)).limit(1))[0];
    if (!profile) return;
    const input = await readEngineInput();
    const days = trainingDays(profile.sessions_per_week ?? input?.programme?.rotation.length ?? 3);
    const today = localDate();
    const doneToday = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(gte(sessions.date, today), isNull(sessions.deleted_at)));
    let testSaid = false;
    for (let n = 0; n < DAYS_AHEAD; n++) {
      const day = new Date();
      day.setDate(day.getDate() + n);
      if (!days.includes(day.getDay())) continue;
      if (n === 0 && doneToday.length > 0) continue;
      const test: boolean = on.remind_test && !testSaid && input !== undefined && testDue(input);
      if (!on.remind_nudge && !test) continue;
      testSaid ||= test;
      await schedule(
        `nudge-${localDate(day)}`,
        at(day, NUDGE),
        test ? "Today is test day" : "Your session is waiting",
        test
          ? "Start with the 10-minute monthly test, then train as planned."
          : "No session logged today. A short one counts: use the time choice on Today.",
      );
    }
    if (on.remind_review && useAccount.getState().status === "signed-in") {
      const sunday = new Date();
      sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7));
      const when = at(sunday, REVIEW);
      if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 7);
      await schedule(
        `review-${localDate(when)}`,
        when,
        "Your weekly review is ready",
        "Open Body to see the week.",
      );
    }
  } catch {
    // Reminders are a convenience: a failure here never blocks the app.
  }
}
