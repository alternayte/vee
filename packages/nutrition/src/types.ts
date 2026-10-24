// SPDX-License-Identifier: AGPL-3.0-or-later

/** Hand portions: palm of protein, fist of vegetables, cupped hand of carbs, thumb of fat. */
export const PORTIONS = ["palm", "fist", "cupped", "thumb"] as const;
export type Portion = (typeof PORTIONS)[number];
export type Portions = Record<Portion, number>;

export const MOMENTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Moment = (typeof MOMENTS)[number];

/**
 * - none: no lactose.
 * - trace: very little lactose (butter, ghee, aged hard cheese). Allowed.
 * - high: enough lactose to break a lactose-free rule. Uncertain items are high.
 * - lactose_free_product: a dairy product made lactose-free. Allowed.
 */
export type LactoseClass = "none" | "trace" | "high" | "lactose_free_product";

export const SHOP_SECTIONS = [
  "produce",
  "meat-fish",
  "dairy-eggs",
  "free-from",
  "bakery",
  "pantry",
  "frozen",
  "spices",
  "drinks",
] as const;
export type ShopSection = (typeof SHOP_SECTIONS)[number];

export type Unit = "g" | "ml" | "piece";

export type Ingredient = {
  id: string;
  name: string;
  shopSection: ShopSection;
  lactoseClass: LactoseClass;
  /** Hand portions in 100 g or 100 ml. Counted items use `pieceG` to convert. */
  per100?: Partial<Portions>;
  /** Grams in one piece, for ingredients bought or counted in pieces. */
  pieceG?: number;
  tags: string[];
};

export type MealIngredient = {
  ingredientId: string;
  qty: number;
  unit: Unit;
  /** pot: cooked for the household. plate_extra: added to one plate only. */
  role: "pot" | "plate_extra";
};

export type Meal = {
  id: string;
  name: string;
  steps: string[];
  minutes: number;
  servings: number;
  /** A no-cook meal: assemble only. */
  noCook: boolean;
  origin: "seed" | "user" | "ai";
  ingredients: MealIngredient[];
};

export type ExclusionKind = "allergy" | "refuse" | "lactose";

/** One rule for one household member. `lactose` needs no ingredient or tag. */
export type Exclusion = { memberId: string; kind: ExclusionKind; ingredientId?: string; tag?: string };

export type HouseholdMember = { id: string; name: string; isSelf: boolean };

export type Reason = { ruleId: string; inputs: Record<string, number | string>; text: string };
