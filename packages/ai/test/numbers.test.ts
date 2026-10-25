// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import { inventedNumbers, wordCount } from "../src/numbers";

describe("inventedNumbers", () => {
  const input = { sets: 12, slope: 0.255, moves: [{ from: 10, to: 15 }], note: "rung 3" };

  test("numbers from the input pass, at any depth and in strings", () => {
    expect(inventedNumbers("12 sets. The hold went from 10 to 15 s on rung 3.", input)).toEqual([]);
  });

  test("a rounded input number passes", () => {
    expect(inventedNumbers("You gain 0.26 kg a week, about 0.3.", input)).toEqual([]);
  });

  test("a number that is not in the input fails", () => {
    expect(inventedNumbers("Add 20 sets and lose 2.5 kg.", input)).toEqual(["20", "2.5"]);
  });

  test("a decimal comma reads as a decimal point", () => {
    expect(inventedNumbers("0,255 kg", input)).toEqual([]);
  });
});

test("wordCount counts words between spaces", () => {
  expect(wordCount("  One two\nthree.  ")).toBe(3);
});
