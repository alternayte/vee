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

test("a steady gain projects forward, and the range widens with time", () => {
  // +0.25 kg a week, with a small daily wobble.
  const w = days(28, (i) => 78 + (0.25 / 7) * i + (i % 2 ? 0.2 : -0.2));
  const o = weightOutlook(w, "2026-10-28");
  if (!o) throw new Error("no outlook");
  const [m3, m6, m12] = o;
  expect(m3?.low).toBeLessThan(82);
  expect(m3?.high).toBeGreaterThan(81);
  expect((m12?.high ?? 0) - (m12?.low ?? 0)).toBeGreaterThan((m6?.high ?? 0) - (m6?.low ?? 0));
  expect((m6?.high ?? 0) - (m6?.low ?? 0)).toBeGreaterThan((m3?.high ?? 0) - (m3?.low ?? 0));
});
