// SPDX-License-Identifier: AGPL-3.0-or-later
// Calendar math on `YYYY-MM-DD` local dates. No clock reads: the caller passes `today`.
import type { LocalDate } from "./types";

const DAY_MS = 86_400_000;

function toUtc(d: LocalDate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y as number, (m as number) - 1, day as number);
}

function fromUtc(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: LocalDate, n: number): LocalDate {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

/** Days from `a` to `b`. Positive when `b` is later. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** ISO 8601 week key, for example `2026-W45`. Weeks start on Monday. */
export function isoWeek(d: LocalDate): string {
  const ms = toUtc(d);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7; // Monday 0
  const thursday = ms + (3 - weekday) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}
