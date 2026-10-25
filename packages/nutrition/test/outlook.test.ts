// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "vitest";
import { weightOutlook } from "../src";

const days = (n: number, kg: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, kg: kg(i) }));

test("no outlook without enough weigh-ins", () => {
  expect(
    weightOutlook(
      days(5, () => 80),
      "2026-10-05",
    ),
  ).toBeUndefined();
});

test("a short trend shows no far horizon", () => {
  // 27 days of data: 3 months only.
  const o = weightOutlook(
    days(28, (i) => 78 + 0.01 * i),
    "2026-10-28",
  );
  expect(o?.map((x) => x.months)).toEqual([3]);
});

test("a steady gain projects forward, and the range widens with time", () => {
  // +0.25 kg a week over 100 days, with a small daily wobble.
  const w = Array.from({ length: 50 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 6, 1) + i * 2 * 86_400_000).toISOString().slice(0, 10);
    return { date: d, kg: 78 + (0.25 / 7) * i * 2 + (i % 2 ? 0.2 : -0.2) };
  });
  const o = weightOutlook(w, "2026-10-08");
  if (!o) throw new Error("no outlook");
  const [m3, m6, m12] = o;
  // Day 98 trend near 81.5 kg; 3 months on adds about 3.3 kg.
  expect(m3?.low).toBeLessThan(85);
  expect(m3?.high).toBeGreaterThan(84);
  expect((m12?.high ?? 0) - (m12?.low ?? 0)).toBeGreaterThan((m6?.high ?? 0) - (m6?.low ?? 0));
  expect((m6?.high ?? 0) - (m6?.low ?? 0)).toBeGreaterThan((m3?.high ?? 0) - (m3?.low ?? 0));
});
