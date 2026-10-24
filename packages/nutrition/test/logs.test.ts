// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import { parseTargets, startTargets, sumPortions } from "../src";

describe("sumPortions", () => {
  test("adds the portions of the day's logs, half portions included", () => {
    expect(
      sumPortions([
        { palm: 1, fist: 0, cupped: 0, thumb: 0 },
        { palm: 0.5, fist: 2, cupped: 1, thumb: 1 },
        { palm: 0, fist: 0, cupped: 0.5, thumb: 0 },
      ]),
    ).toEqual({ palm: 1.5, fist: 2, cupped: 1.5, thumb: 1 });
  });

  test("an empty day is zero", () => {
    expect(sumPortions([])).toEqual({ palm: 0, fist: 0, cupped: 0, thumb: 0 });
  });
});

describe("parseTargets", () => {
  test("reads back what startTargets stores", () => {
    const t = startTargets({ goal: "lean-gain", sex: "male" });
    expect(parseTargets(JSON.stringify(t.perMoment))).toEqual(t.perMoment);
  });

  test.each(["", "{}", "null", '{"breakfast":{"palm":"2"}}', "not json"])("rejects %s", (raw) => {
    expect(parseTargets(raw)).toBeUndefined();
  });
});
