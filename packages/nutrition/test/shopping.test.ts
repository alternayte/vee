// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "vitest";
import { buildList, type Ingredient, type Meal, mergeList, type ShoppingItem } from "../src";

const ing = (id: string, shopSection: Ingredient["shopSection"]): Ingredient => ({
  id,
  name: id,
  shopSection,
  lactoseClass: "none",
  tags: [],
});
const ingredients = [
  ing("chicken", "meat-fish"),
  ing("rice", "pantry"),
  ing("onion", "produce"),
  ing("oil", "pantry"),
  ing("stock", "pantry"),
];

const meal = (id: string, items: Meal["ingredients"]): Meal => ({
  id,
  name: id,
  steps: [],
  minutes: 20,
  servings: 2,
  noCook: false,
  origin: "seed",
  ingredients: items,
});

const a = meal("a", [
  { ingredientId: "chicken", qty: 300, unit: "g", role: "pot" },
  { ingredientId: "rice", qty: 160, unit: "g", role: "pot" },
  { ingredientId: "onion", qty: 1, unit: "piece", role: "pot" },
  { ingredientId: "oil", qty: 15, unit: "ml", role: "pot" },
]);
const b = meal("b", [
  { ingredientId: "chicken", qty: 400, unit: "g", role: "pot" },
  { ingredientId: "onion", qty: 2, unit: "piece", role: "pot" },
  { ingredientId: "stock", qty: 500, unit: "ml", role: "pot" },
  { ingredientId: "rice", qty: 80, unit: "g", role: "plate_extra" },
]);

describe("buildList", () => {
  test("sums quantities across the week and groups by shop section", () => {
    const list = buildList(["a", "b"], [a, b], ingredients, new Set());
    expect(list.map((i) => [i.ingredientId, i.qty, i.unit, i.shopSection])).toEqual([
      ["onion", 3, "piece", "produce"],
      ["chicken", 700, "g", "meat-fish"],
      ["oil", 15, "ml", "pantry"],
      ["rice", 240, "g", "pantry"],
      ["stock", 500, "ml", "pantry"],
    ]);
  });

  test("a meal planned twice counts twice", () => {
    const list = buildList(["a", "a"], [a], ingredients, new Set());
    expect(list.find((i) => i.ingredientId === "chicken")?.qty).toBe(600);
  });

  test("staples stay off the list", () => {
    const list = buildList(["a", "b"], [a, b], ingredients, new Set(["oil", "stock"]));
    expect(list.map((i) => i.ingredientId)).toEqual(["onion", "chicken", "rice"]);
  });

  test("an unknown meal id is an error", () => {
    expect(() => buildList(["x"], [a], ingredients, new Set())).toThrow(/x/);
  });
});

describe("mergeList", () => {
  test("a new plan keeps unticked items and drops ticked ones", () => {
    const old: ShoppingItem[] = [
      { ingredientId: "rice", qty: 100, unit: "g", shopSection: "pantry", checked: false },
      { ingredientId: "oil", qty: 15, unit: "ml", shopSection: "pantry", checked: true },
      { ingredientId: "salt", qty: 1, unit: "piece", shopSection: "spices", checked: false },
    ];
    const fresh = buildList(["a"], [a], ingredients, new Set());
    const merged = mergeList(old, fresh);
    expect(merged.find((i) => i.ingredientId === "rice")?.qty).toBe(260);
    expect(merged.find((i) => i.ingredientId === "oil")).toMatchObject({ qty: 15, checked: false });
    expect(merged.find((i) => i.ingredientId === "salt")).toMatchObject({ qty: 1, checked: false });
  });
});
