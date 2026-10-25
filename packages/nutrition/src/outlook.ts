// SPDX-License-Identifier: AGPL-3.0-or-later
// The honest outlook (PRD "Body and progress"): where your own weight trend
// leads at 3, 6 and 12 months, as a range. The range is the trend's own
// uncertainty (a 95% band on the least-squares line), not a promise.
import { MIN_WEIGH_INS, type WeighIn } from "./targets";

export const OUTLOOK_MONTHS = [3, 6, 12] as const;
const DAYS_PER_MONTH = 30.44;
const Z95 = 1.96;

const dayNumber = (d: string) =>
  Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;

export type Outlook = { months: number; low: number; high: number };

/** Undefined with fewer than MIN_WEIGH_INS weigh-ins: no trend, no outlook. */
export function weightOutlook(weighIns: WeighIn[], today: string): Outlook[] | undefined {
  if (weighIns.length < MIN_WEIGH_INS) return undefined;
  const pts = weighIns.map((w) => ({ x: dayNumber(w.date), y: w.kg }));
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return undefined;
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  const intercept = my - slope * mx;
  const residual = Math.sqrt(
    pts.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0) / Math.max(1, n - 2),
  );
  const t = dayNumber(today);
  return OUTLOOK_MONTHS.map((months) => {
    const x = t + months * DAYS_PER_MONTH;
    const centre = intercept + slope * x;
    // Prediction band of the line at x: it widens with distance from the data.
    const half = Z95 * residual * Math.sqrt(1 + 1 / n + (x - mx) ** 2 / sxx);
    const round = (v: number) => Math.round(v * 10) / 10;
    return { months, low: round(centre - half), high: round(centre + half) };
  });
}
