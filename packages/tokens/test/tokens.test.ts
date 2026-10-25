// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CONTRAST_PAIRS, colors, contrast, motion, themeCss, webThemeCss } from "../src";

describe("tokens", () => {
  test.each(["dark", "light"] as const)("%s theme passes WCAG AA for every text pair", (theme) => {
    const failing = CONTRAST_PAIRS.filter(
      ([fg, bg]) => contrast(colors[theme][fg], colors[theme][bg]) < 4.5,
    ).map(([fg, bg]) => `${fg} on ${bg}: ${contrast(colors[theme][fg], colors[theme][bg]).toFixed(2)}`);
    expect(failing).toEqual([]);
  });

  test("contrast of black on white is 21", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  test("no transition is longer than 200 ms", () => {
    expect(Math.max(...Object.values(motion.duration))).toBeLessThanOrEqual(200);
  });

  test("the committed web.css matches the tokens", () => {
    expect(readFileSync(join(import.meta.dirname, "..", "web.css"), "utf8")).toBe(webThemeCss());
  });

  test("the committed theme.css matches the tokens", () => {
    expect(readFileSync(join(import.meta.dirname, "..", "theme.css"), "utf8")).toBe(themeCss());
  });
});
