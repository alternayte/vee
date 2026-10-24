// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import { isBigJump, JUMP_LIMIT, jumpRatio, nextLoad, prevLoad, snapLoad } from "../src";

const dial = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

describe("dial math", () => {
  test("jump ratio is next ÷ current − 1", () => {
    expect(jumpRatio(10, 12)).toBeCloseTo(0.2);
    expect(jumpRatio(22, 24)).toBeCloseTo(0.0909, 4);
  });

  test("the limit is 15%", () => {
    expect(JUMP_LIMIT).toBe(0.15);
  });

  test("small loads give big jumps on a 2 kg dial", () => {
    expect(isBigJump(2, 4)).toBe(true);
    expect(isBigJump(12, 14)).toBe(true);
    expect(isBigJump(14, 16)).toBe(false);
    expect(isBigJump(22, 24)).toBe(false);
  });

  test("a jump of exactly 15% is not big", () => {
    expect(isBigJump(20, 23)).toBe(false);
  });

  test("next and previous load", () => {
    expect(nextLoad(dial, 10)).toBe(12);
    expect(nextLoad(dial, 24)).toBeUndefined();
    expect(prevLoad(dial, 10)).toBe(8);
    expect(prevLoad(dial, 2)).toBeUndefined();
  });

  test("next and previous work from a load between options", () => {
    expect(nextLoad(dial, 11)).toBe(12);
    expect(prevLoad(dial, 11)).toBe(10);
  });

  test("snap goes to the nearest option at or below, else the lowest", () => {
    expect(snapLoad(dial, 11)).toBe(10);
    expect(snapLoad(dial, 12)).toBe(12);
    expect(snapLoad(dial, 30)).toBe(24);
    expect(snapLoad(dial, 1)).toBe(2);
    expect(snapLoad([], 10)).toBeUndefined();
  });
});
