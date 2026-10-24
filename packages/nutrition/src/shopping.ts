// SPDX-License-Identifier: AGPL-3.0-or-later
// Shopping list (SDD "Shopping list"): sums the week's ingredients, drops
// staples, groups by shop section.
import { type Ingredient, type Meal, SHOP_SECTIONS, type ShopSection, type Unit } from "./types";

export type ShoppingItem = {
  ingredientId: string;
  qty: number;
  unit: Unit;
  shopSection: ShopSection;
  checked: boolean;
};

const key = (i: { ingredientId: string; unit: Unit }) => `${i.ingredientId}|${i.unit}`;

function sortList(items: ShoppingItem[]): ShoppingItem[] {
  return items.sort(
    (a, b) =>
      SHOP_SECTIONS.indexOf(a.shopSection) - SHOP_SECTIONS.indexOf(b.shopSection) ||
      a.ingredientId.localeCompare(b.ingredientId) ||
      a.unit.localeCompare(b.unit),
  );
}

/** Ingredients for the planned meals, in g, ml or pieces. Each meal id counts once per plan entry. */
export function buildList(
  mealIds: string[],
  meals: Meal[],
  ingredients: Ingredient[],
  staples: Set<string>,
): ShoppingItem[] {
  const out = new Map<string, ShoppingItem>();
  for (const id of mealIds) {
    const meal = meals.find((m) => m.id === id);
    if (!meal) throw new Error(`meal not found: ${id}`);
    for (const mi of meal.ingredients) {
      if (staples.has(mi.ingredientId)) continue;
      const ing = ingredients.find((i) => i.id === mi.ingredientId);
      if (!ing) throw new Error(`ingredient not found: ${mi.ingredientId}`);
      const k = key(mi);
      const prev = out.get(k);
      if (prev) prev.qty += mi.qty;
      else
        out.set(k, {
          ingredientId: mi.ingredientId,
          qty: mi.qty,
          unit: mi.unit,
          shopSection: ing.shopSection,
          checked: false,
        });
    }
  }
  return sortList([...out.values()]);
}

/** A new plan keeps the unticked items of the old list. Ticked items are bought, so they drop. */
export function mergeList(old: ShoppingItem[], fresh: ShoppingItem[]): ShoppingItem[] {
  const out = new Map<string, ShoppingItem>(fresh.map((i) => [key(i), { ...i }]));
  for (const o of old) {
    if (o.checked) continue;
    const prev = out.get(key(o));
    if (prev) prev.qty += o.qty;
    else out.set(key(o), { ...o });
  }
  return sortList([...out.values()]);
}
