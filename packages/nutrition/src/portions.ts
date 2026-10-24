// SPDX-License-Identifier: AGPL-3.0-or-later
import { type Ingredient, type Meal, type MealIngredient, PORTIONS, type Portions } from "./types";

export const zeroPortions = (): Portions => ({ palm: 0, fist: 0, cupped: 0, thumb: 0 });

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Grams (or ml) of one meal ingredient. Pieces convert with the ingredient's piece weight. */
export function amountIn100(mi: MealIngredient, ing: Ingredient): number {
  if (mi.unit === "piece") return ((ing.pieceG ?? 0) * mi.qty) / 100;
  return mi.qty / 100;
}

export function portionsOf(mi: MealIngredient, ing: Ingredient): Portions {
  const out = zeroPortions();
  const n = amountIn100(mi, ing);
  for (const p of PORTIONS) out[p] = (ing.per100?.[p] ?? 0) * n;
  return out;
}

/** Hand portions in one serving. Plate extras count, because the eater gets them. */
export function portionsPerServing(meal: Meal, ingredients: Ingredient[]): Portions {
  const total = zeroPortions();
  for (const mi of meal.ingredients) {
    const ing = ingredients.find((i) => i.id === mi.ingredientId);
    if (!ing) continue;
    const share = mi.role === "pot" ? meal.servings : 1;
    const p = portionsOf(mi, ing);
    for (const k of PORTIONS) total[k] += p[k] / share;
  }
  for (const k of PORTIONS) total[k] = round2(total[k]);
  return total;
}
