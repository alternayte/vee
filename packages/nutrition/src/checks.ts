// SPDX-License-Identifier: AGPL-3.0-or-later
// Meal checks (invariant I7). No meal reaches the user if it breaks a lactose
// or refusal rule, from the library or from the AI.
import { portionsPerServing } from "./portions";
import { reason } from "./reasons";
import type { Exclusion, HouseholdMember, Ingredient, Meal, Reason } from "./types";

export const WEEKNIGHT_MAX_MIN = 20;
export const NO_COOK_MAX_MIN = 10;
export const MIN_PROTEIN_PALMS = 1;

export type CheckRule =
  | "lactose"
  | "refusal"
  | "shared-pot"
  | "weeknight-time"
  | "no-cook-time"
  | "protein"
  | "unknown-ingredient";

export type Violation = { rule: CheckRule; ingredientId?: string; memberId?: string; reason: Reason };

/** pass: show it. fail: never show it. review: unknown ingredients; hold it back for a person to check. */
export type CheckResult = { status: "pass" | "fail" | "review"; violations: Violation[] };

export type CheckContext = { slot: "weeknight" | "weekend"; eaterId?: string };

function breaks(ing: Ingredient, rules: Exclusion[]): Exclusion | undefined {
  return rules.find((x) => {
    if (x.kind === "lactose") return ing.lactoseClass === "high";
    if (x.ingredientId !== undefined && x.ingredientId === ing.id) return true;
    return x.tag !== undefined && ing.tags.includes(x.tag);
  });
}

export function checkMeal(
  meal: Meal,
  ingredients: Ingredient[],
  exclusions: Exclusion[],
  household: HouseholdMember[],
  ctx: CheckContext,
): CheckResult {
  const violations: Violation[] = [];
  const eater = ctx.eaterId ?? household.find((m) => m.isSelf)?.id;
  const others = household.filter((m) => m.id !== eater);
  let unknown = false;

  for (const mi of meal.ingredients) {
    const ing = ingredients.find((i) => i.id === mi.ingredientId);
    if (!ing) {
      unknown = true;
      violations.push({
        rule: "unknown-ingredient",
        ingredientId: mi.ingredientId,
        reason: reason("CHECK_UNKNOWN", { ingredient: mi.ingredientId }),
      });
      continue;
    }
    const mine = breaks(
      ing,
      exclusions.filter((x) => x.memberId === eater),
    );
    if (mine) {
      const lactose = mine.kind === "lactose";
      violations.push({
        rule: lactose ? "lactose" : "refusal",
        ingredientId: ing.id,
        ...(eater ? { memberId: eater } : {}),
        reason: reason(lactose ? "CHECK_LACTOSE" : "CHECK_REFUSAL", { ingredient: ing.name }),
      });
      continue;
    }
    if (mi.role !== "pot") continue;
    for (const m of others) {
      if (
        breaks(
          ing,
          exclusions.filter((x) => x.memberId === m.id),
        )
      ) {
        violations.push({
          rule: "shared-pot",
          ingredientId: ing.id,
          memberId: m.id,
          reason: reason("CHECK_SHARED_POT", { ingredient: ing.name, member: m.name }),
        });
      }
    }
  }

  if (meal.noCook && meal.minutes > NO_COOK_MAX_MIN) {
    violations.push({
      rule: "no-cook-time",
      reason: reason("CHECK_NO_COOK_TIME", { minutes: meal.minutes, max: NO_COOK_MAX_MIN }),
    });
  } else if (!meal.noCook && ctx.slot === "weeknight" && meal.minutes > WEEKNIGHT_MAX_MIN) {
    violations.push({
      rule: "weeknight-time",
      reason: reason("CHECK_WEEKNIGHT_TIME", { minutes: meal.minutes, max: WEEKNIGHT_MAX_MIN }),
    });
  }

  if (!unknown) {
    const palm = portionsPerServing(meal, ingredients).palm;
    if (palm < MIN_PROTEIN_PALMS) {
      violations.push({ rule: "protein", reason: reason("CHECK_PROTEIN", { palm }) });
    }
  }

  const status = unknown ? "review" : violations.length > 0 ? "fail" : "pass";
  return { status, violations };
}
