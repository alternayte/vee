// SPDX-License-Identifier: AGPL-3.0-or-later
// Readiness, block weeks and deload (SDD "Readiness and deload").
import { daysBetween } from "./dates";
import { reason } from "./reasons";
import type { Checkin, EngineInput, LocalDate, Programme, ReadinessMode, Reason } from "./types";

export const SLEEP_POINTS = { good: 5, ok: 3, bad: 1 } as const;
/** Health Connect sleep under this counts as bad. */
export const SHORT_SLEEP_MIN = 360;
export const BUILD_WEEKS = 4;
export const DELOAD_WEEK = 5;
export const STALL_SESSIONS = 3;

export function readinessScore(c: Checkin): number {
  const sleep = c.hcSleepMin !== undefined && c.hcSleepMin < SHORT_SLEEP_MIN ? "bad" : c.sleep;
  return c.energy + (6 - c.soreness) + SLEEP_POINTS[sleep];
}

export function readinessMode(score: number): ReadinessMode {
  if (score >= 11) return "full";
  if (score >= 7) return "trimmed";
  return "recovery";
}

/** Week of the block: 1–4 build, 5 deload, 6 or more means the block is over. */
export function blockWeek(p: Programme, today: LocalDate): number {
  if (p.earlyDeloadFrom !== undefined) {
    const d = daysBetween(p.earlyDeloadFrom, today);
    if (d >= 0) return d < 7 ? DELOAD_WEEK : DELOAD_WEEK + 1;
  }
  return Math.floor(daysBetween(p.blockStart, today) / 7) + 1;
}

export type DeloadStatus = {
  /** A deload runs today. */
  deload: boolean;
  kind?: "planned" | "early";
  /** The early-deload rule fires today and no deload runs: the app sets `earlyDeloadFrom`. */
  startEarly: boolean;
  reasons: Reason[];
};

export function deloadStatus(input: EngineInput): DeloadStatus {
  const p = input.programme;
  if (p && blockWeek(p, input.today) === DELOAD_WEEK) {
    const sinceEarly = p.earlyDeloadFrom === undefined ? -1 : daysBetween(p.earlyDeloadFrom, input.today);
    const kind = sinceEarly >= 0 && sinceEarly < 7 ? "early" : "planned";
    return { deload: true, kind, startEarly: false, reasons: [reason("DELOAD_WEEK", { week: DELOAD_WEEK })] };
  }

  // Only check-ins in the current block count, so a past low week does not start a second deload.
  const from = p?.blockStart ?? "";
  const last7 = input.history.checkins
    .filter((c) => c.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7);
  const low = last7.filter((c) => readinessMode(readinessScore(c)) !== "full").length;
  if (low >= 4) {
    return {
      deload: false,
      startEarly: true,
      reasons: [reason("DELOAD_EARLY_READINESS", { low, of: last7.length })],
    };
  }

  const stalled = input.history.progress.filter((s) => (s.streaks?.stall ?? 0) >= STALL_SESSIONS);
  if (stalled.length >= 2) {
    return {
      deload: false,
      startEarly: true,
      reasons: [
        reason("DELOAD_EARLY_STALL", {
          families: stalled.map((s) => s.family).join(", "),
          count: stalled.length,
        }),
      ],
    };
  }
  return { deload: false, startEarly: false, reasons: [] };
}
