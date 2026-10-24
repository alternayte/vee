// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import {
  checkMeal,
  type Exclusion,
  type HouseholdMember,
  type Ingredient,
  type Meal,
  portionsPerServing,
} from "../src";

const ing = (id: string, over: Partial<Ingredient> = {}): Ingredient => ({
  id,
  name: id,
  shopSection: "pantry",
  lactoseClass: "none",
  tags: [],
  ...over,
});

const ingredients: Ingredient[] = [
  ing("chicken", { per100: { palm: 0.8 }, tags: ["poultry"] }),
  ing("rice", { per100: { cupped: 2.5 } }),
  ing("broccoli", { per100: { fist: 1 } }),
  ing("butter", { lactoseClass: "trace", per100: { thumb: 10 } }),
  ing("cream", { lactoseClass: "high", per100: { thumb: 3 } }),
  ing("lf-milk", { lactoseClass: "lactose_free_product" }),
  ing("peanuts", { per100: { thumb: 6, palm: 0.3 }, tags: ["nuts", "peanut"] }),
  ing("prawns", { per100: { palm: 0.8 }, tags: ["shellfish"] }),
  ing("egg", { pieceG: 55, per100: { palm: 0.6 } }),
];

const self: HouseholdMember = { id: "me", name: "Me", isSelf: true };
const partner: HouseholdMember = { id: "p", name: "Partner", isSelf: false };
const household = [self, partner];

const meal = (over: Partial<Meal> = {}): Meal => ({
  id: "m",
  name: "Chicken rice",
  steps: ["Cook the rice."],
  minutes: 20,
  servings: 2,
  noCook: false,
  origin: "seed",
  ingredients: [
    { ingredientId: "chicken", qty: 300, unit: "g", role: "pot" },
    { ingredientId: "rice", qty: 160, unit: "g", role: "pot" },
    { ingredientId: "broccoli", qty: 300, unit: "g", role: "pot" },
  ],
  ...over,
});

const lactoseIntolerant: Exclusion[] = [{ memberId: "me", kind: "lactose" }];
const codes = (r: ReturnType<typeof checkMeal>) => r.violations.map((v) => v.rule);

describe("checkMeal", () => {
  test("a plain meal passes", () => {
    const r = checkMeal(meal(), ingredients, lactoseIntolerant, household, { slot: "weeknight" });
    expect(r).toMatchObject({ status: "pass", violations: [] });
  });

  test("a high-lactose ingredient fails for a lactose-intolerant eater", () => {
    const m = meal({
      ingredients: [...meal().ingredients, { ingredientId: "cream", qty: 100, unit: "ml", role: "pot" }],
    });
    const r = checkMeal(m, ingredients, lactoseIntolerant, household, { slot: "weeknight" });
    expect(r.status).toBe("fail");
    expect(codes(r)).toEqual(["lactose"]);
    expect(r.violations[0]?.ingredientId).toBe("cream");
  });

  test("butter (trace) and lactose-free products pass", () => {
    const m = meal({
      ingredients: [
        ...meal().ingredients,
        { ingredientId: "butter", qty: 20, unit: "g", role: "pot" },
        { ingredientId: "lf-milk", qty: 100, unit: "ml", role: "pot" },
      ],
    });
    expect(checkMeal(m, ingredients, lactoseIntolerant, household, { slot: "weeknight" }).status).toBe(
      "pass",
    );
  });

  test("with no lactose rule, high lactose passes", () => {
    const m = meal({
      ingredients: [...meal().ingredients, { ingredientId: "cream", qty: 100, unit: "ml", role: "pot" }],
    });
    expect(checkMeal(m, ingredients, [], household, { slot: "weeknight" }).status).toBe("pass");
  });

  test("a refused ingredient or tag fails", () => {
    const byTag: Exclusion[] = [{ memberId: "me", kind: "refuse", tag: "poultry" }];
    expect(codes(checkMeal(meal(), ingredients, byTag, household, { slot: "weeknight" }))).toEqual([
      "refusal",
    ]);
    const byId: Exclusion[] = [{ memberId: "me", kind: "refuse", ingredientId: "broccoli" }];
    expect(codes(checkMeal(meal(), ingredients, byId, household, { slot: "weeknight" }))).toEqual([
      "refusal",
    ]);
  });

  test("the shared pot follows every member's rules", () => {
    const allergy: Exclusion[] = [{ memberId: "p", kind: "allergy", tag: "nuts" }];
    const m = meal({
      ingredients: [...meal().ingredients, { ingredientId: "peanuts", qty: 40, unit: "g", role: "pot" }],
    });
    const r = checkMeal(m, ingredients, allergy, household, { slot: "weeknight" });
    expect(codes(r)).toEqual(["shared-pot"]);
    expect(r.violations[0]?.memberId).toBe("p");
  });

  test("a plate extra follows only the eater's rules", () => {
    const allergy: Exclusion[] = [{ memberId: "p", kind: "allergy", tag: "nuts" }];
    const m = meal({
      ingredients: [
        ...meal().ingredients,
        { ingredientId: "peanuts", qty: 20, unit: "g", role: "plate_extra" },
      ],
    });
    expect(checkMeal(m, ingredients, allergy, household, { slot: "weeknight" }).status).toBe("pass");
    const mine: Exclusion[] = [{ memberId: "me", kind: "allergy", tag: "peanut" }];
    expect(codes(checkMeal(m, ingredients, mine, household, { slot: "weeknight" }))).toEqual(["refusal"]);
  });

  test("a lactose-intolerant partner blocks cream in the pot", () => {
    const partnerLactose: Exclusion[] = [{ memberId: "p", kind: "lactose" }];
    const m = meal({
      ingredients: [...meal().ingredients, { ingredientId: "cream", qty: 100, unit: "ml", role: "pot" }],
    });
    expect(codes(checkMeal(m, ingredients, partnerLactose, household, { slot: "weeknight" }))).toEqual([
      "shared-pot",
    ]);
  });

  test("weeknight meals take 20 min or less; no-cook meals 10 min or less", () => {
    expect(
      codes(checkMeal(meal({ minutes: 25 }), ingredients, [], household, { slot: "weeknight" })),
    ).toEqual(["weeknight-time"]);
    expect(checkMeal(meal({ minutes: 25 }), ingredients, [], household, { slot: "weekend" }).status).toBe(
      "pass",
    );
    expect(
      codes(checkMeal(meal({ minutes: 12, noCook: true }), ingredients, [], household, { slot: "weekend" })),
    ).toEqual(["no-cook-time"]);
  });

  test("a serving must reach 1 palm of protein", () => {
    const m = meal({ ingredients: [{ ingredientId: "rice", qty: 160, unit: "g", role: "pot" }] });
    expect(codes(checkMeal(m, ingredients, [], household, { slot: "weeknight" }))).toEqual(["protein"]);
  });

  test("an unknown ingredient fails closed to review", () => {
    const m = meal({
      ingredients: [...meal().ingredients, { ingredientId: "mystery", qty: 10, unit: "g", role: "pot" }],
    });
    const r = checkMeal(m, ingredients, [], household, { slot: "weeknight" });
    expect(r.status).toBe("review");
    expect(codes(r)).toEqual(["unknown-ingredient"]);
  });

  test("each violation carries a reason text", () => {
    const m = meal({
      minutes: 30,
      ingredients: [...meal().ingredients, { ingredientId: "cream", qty: 1, unit: "ml", role: "pot" }],
    });
    for (const v of checkMeal(m, ingredients, lactoseIntolerant, household, { slot: "weeknight" })
      .violations) {
      expect(v.reason.text.length).toBeGreaterThan(0);
      expect(v.reason.text).not.toMatch(/[{}]/);
    }
  });
});

describe("portionsPerServing", () => {
  test("sums hand portions from quantities and divides by servings", () => {
    expect(portionsPerServing(meal(), ingredients)).toEqual({ palm: 1.2, fist: 1.5, cupped: 2, thumb: 0 });
  });

  test("counted pieces convert with the piece weight", () => {
    const m = meal({
      servings: 1,
      ingredients: [{ ingredientId: "egg", qty: 3, unit: "piece", role: "pot" }],
    });
    expect(portionsPerServing(m, ingredients).palm).toBeCloseTo(0.99, 2);
  });
});
