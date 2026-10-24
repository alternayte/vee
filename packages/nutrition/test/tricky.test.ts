// SPDX-License-Identifier: AGPL-3.0-or-later
// V6 / I7: tricky ingredients against the lactose rule. The decisions here are
// written apart from the seed data, so a wrong class in the seed fails a test.
import { describe, expect, test } from "vitest";
import { checkMeal, type Exclusion, type HouseholdMember, type Meal } from "../src";
import { SEED_INGREDIENTS } from "../src/seed";

const BLOCK = [
  "milk-whole",
  "milk-semi",
  "milk-skim",
  "milk-drink-protein",
  "chocolate-milk",
  "cream-full",
  "cream-half",
  "cream-sauce",
  "cream-coffee",
  "cream-whipping",
  "cream-sour",
  "creme-fraiche",
  "condensed-milk",
  "evaporated-milk",
  "milk-powder",
  "skim-milk-powder",
  "buttermilk",
  "buttermilk-powder",
  "sour-milk",
  "kefir",
  "yogurt-plain",
  "yogurt-greek",
  "yogurt-fruit",
  "yogurt-drink",
  "skyr",
  "quark",
  "cottage-cheese",
  "ricotta",
  "mascarpone",
  "cream-cheese",
  "mozzarella",
  "burrata",
  "goat-cheese-fresh",
  "paneer",
  "halloumi",
  "feta",
  "brie",
  "camembert",
  "raclette-cheese",
  "fondue-mix",
  "vacherin-fribourgeois",
  "tilsiter",
  "processed-cheese",
  "cheese-spread",
  "grated-pizza-cheese",
  "ice-cream",
  "frozen-yogurt",
  "custard",
  "pudding-chocolate",
  "rice-pudding",
  "bechamel",
  "cheese-sauce",
  "alfredo-sauce",
  "pesto-jar",
  "tzatziki",
  "raita",
  "ranch-dressing",
  "caesar-dressing",
  "french-dressing-ch",
  "milk-chocolate",
  "white-chocolate",
  "nut-nougat-spread",
  "whey-concentrate",
  "whey-isolate",
  "casein-powder",
  "whey-powder",
  "lactose",
  "milk-solids",
  "lactoserum",
  "zopf",
  "croissant",
  "brioche",
  "milk-bread",
  "naan",
  "pancake-mix",
  "mashed-potato-flakes",
  "potato-gratin",
  "stock-cube",
  "gravy-granules",
  "cream-soup-mix",
  "cervelat",
  "bratwurst",
  "chicken-nuggets",
  "fish-fingers",
  "cordon-bleu",
  "lasagne-ready",
  "pizza-frozen",
  "granola-yogurt",
  "muesli-bircher",
  "protein-bar-whey",
  "cappuccino-powder",
  "hot-chocolate-powder",
  "ovomaltine",
  "milk-caramel",
  "butter-cookies",
  "tiramisu",
  "cheesecake",
  "chicken-ham",
  "salami",
  "milk-coffee-drink",
  "chai-latte-powder",
  "creamed-spinach",
  "quiche",
  "roesti-ready",
  "potato-croquettes",
  "spaetzli",
];

const ALLOW = [
  // Trace lactose.
  "butter",
  "butter-salted",
  "ghee",
  "clarified-butter",
  "gruyere",
  "emmentaler",
  "appenzeller",
  "sbrinz",
  "tete-de-moine",
  "parmigiano",
  "grana-padano",
  "pecorino-romano",
  "comte",
  "gouda-aged",
  "cheddar-mature",
  "manchego-curado",
  "dark-chocolate",
  // Lactose-free products.
  "lf-milk",
  "lf-milk-drink-protein",
  "lf-yogurt",
  "lf-yogurt-greek",
  "lf-skyr",
  "lf-quark",
  "lf-cottage-cheese",
  "lf-cream",
  "lf-cream-half",
  "lf-whipping-cream",
  "lf-sour-cream",
  "lf-creme-fraiche",
  "lf-cream-cheese",
  "lf-mozzarella",
  "lf-feta",
  "lf-butter",
  "lf-ice-cream",
  "lf-milk-chocolate",
  "lf-pudding",
  "lf-kefir",
  "lf-buttermilk",
  "lf-raclette",
  "lf-grated-cheese",
  "lf-coffee-cream",
  "lf-cappuccino",
  "lf-mascarpone",
  // Look like dairy, have no lactose.
  "oat-drink",
  "almond-drink",
  "soy-drink",
  "rice-drink",
  "coconut-drink",
  "pea-drink",
  "coconut-milk",
  "coconut-cream",
  "soy-cream",
  "oat-cream",
  "soy-yogurt",
  "oat-yogurt",
  "coconut-yogurt",
  "soy-skyr-style",
  "vegan-cheese",
  "vegan-cream-cheese",
  "vegan-butter",
  "margarine-plant",
  "cocoa-butter",
  "coconut-butter",
  "peanut-butter",
  "almond-butter",
  "cashew-butter",
  "cocoa-powder",
  "cocoa-nibs",
  "cream-of-tartar",
  "coconut-whip",
  "nutritional-yeast",
  "mayonnaise",
  "hummus",
  "tempeh",
  "seitan",
  "soy-mince",
  "lactic-acid",
  "sodium-lactate",
  "calcium-lactate",
  "lactic-cultures",
  "lactitol",
  "glucose-syrup",
  "dextrose",
  "maltodextrin",
  "eggs",
  "egg-noodles",
  "egg-pasta",
  "vegan-pesto",
  "vegan-ice-cream",
  "sorbet",
  "stock-cube-lf",
  "bresaola",
  "buendnerfleisch",
  "prosciutto",
  "coconut-water",
];

const self: HouseholdMember = { id: "me", name: "Me", isSelf: true };
const rules: Exclusion[] = [{ memberId: "me", kind: "lactose" }];

/** A meal of chicken (enough protein) plus the tricky ingredient. */
const withIngredient = (id: string): Meal => ({
  id: `t-${id}`,
  name: id,
  steps: [],
  minutes: 10,
  servings: 1,
  noCook: false,
  origin: "ai",
  ingredients: [
    { ingredientId: "chicken-breast", qty: 200, unit: "g", role: "pot" },
    { ingredientId: id, qty: 50, unit: "g", role: "pot" },
  ],
});

describe("tricky ingredients (V6)", () => {
  test("the list has at least 200 tricky ingredients and no overlap", () => {
    expect(BLOCK.length + ALLOW.length).toBeGreaterThanOrEqual(200);
    expect(BLOCK.filter((x) => ALLOW.includes(x))).toEqual([]);
  });

  test.each(BLOCK)("%s is blocked for a lactose-intolerant eater", (id) => {
    expect(SEED_INGREDIENTS.some((i) => i.id === id)).toBe(true);
    const r = checkMeal(withIngredient(id), SEED_INGREDIENTS, rules, [self], { slot: "weekend" });
    expect(r.status).toBe("fail");
    expect(r.violations.map((v) => v.rule)).toEqual(["lactose"]);
  });

  test.each(ALLOW)("%s is allowed for a lactose-intolerant eater", (id) => {
    expect(SEED_INGREDIENTS.some((i) => i.id === id)).toBe(true);
    expect(checkMeal(withIngredient(id), SEED_INGREDIENTS, rules, [self], { slot: "weekend" }).status).toBe(
      "pass",
    );
  });

  test.each(["cheese", "milk", "yogurt", "Parmesan", "whey"])(
    "a free-text name '%s' fails closed",
    (name) => {
      expect(
        checkMeal(withIngredient(name), SEED_INGREDIENTS, rules, [self], { slot: "weekend" }).status,
      ).toBe("review");
    },
  );

  test("every seed ingredient with a dairy tag has a deliberate class", () => {
    const dairy = SEED_INGREDIENTS.filter((i) => i.tags.includes("dairy")).map((i) => i.id);
    expect(dairy.filter((id) => !BLOCK.includes(id) && !ALLOW.includes(id))).toEqual([]);
  });
});
