// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import { checkMeal, type HouseholdMember, portionsPerServing, WEEKNIGHT_MAX_MIN } from "../src";
import { SEED_INGREDIENTS, SEED_MEALS, SEED_SAVED_MEALS } from "../src/seed";

const self: HouseholdMember = { id: "me", name: "Me", isSelf: true };
const lactoseFree = [{ memberId: "me", kind: "lactose" as const }];

describe("seed ingredients", () => {
  test("ids are unique", () => {
    const ids = SEED_INGREDIENTS.map((i) => i.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test("ids are kebab-case", () => {
    for (const i of SEED_INGREDIENTS) expect(i.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("seed meals", () => {
  test("ids are unique", () => {
    const ids = SEED_MEALS.map((m) => m.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test.each(SEED_MEALS)("$id passes every check for a lactose-intolerant eater", (m) => {
    const slot = m.minutes <= WEEKNIGHT_MAX_MIN || m.noCook ? "weeknight" : "weekend";
    expect(checkMeal(m, SEED_INGREDIENTS, lactoseFree, [self], { slot })).toEqual({
      status: "pass",
      violations: [],
    });
  });

  test("the library has at least 12 weeknight meals and 2 no-cook meals", () => {
    expect(SEED_MEALS.filter((m) => m.minutes <= WEEKNIGHT_MAX_MIN).length).toBeGreaterThanOrEqual(12);
    expect(SEED_MEALS.filter((m) => m.noCook).length).toBeGreaterThanOrEqual(2);
  });

  test.each(SEED_MEALS)("$id has about 1 to 3 palms of protein per serving", (m) => {
    const palm = portionsPerServing(m, SEED_INGREDIENTS).palm;
    expect(palm).toBeGreaterThanOrEqual(1);
    expect(palm).toBeLessThanOrEqual(3);
  });

  test.each(SEED_MEALS)("$id steps are single sentences of 20 words or fewer", (m) => {
    expect(m.steps.length).toBeGreaterThan(0);
    for (const s of m.steps) {
      expect(s.match(/[.!?](\s|$)/g)?.length, s).toBe(1);
      expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
    }
  });
});

describe("seed saved meals", () => {
  test("the breakfast rotation has at least 3 options", () => {
    expect(SEED_SAVED_MEALS.filter((m) => m.moment === "breakfast").length).toBeGreaterThanOrEqual(3);
  });
});
