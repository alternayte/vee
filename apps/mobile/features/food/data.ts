// SPDX-License-Identifier: AGPL-3.0-or-later
// Food data: reads and writes on the local database. The seed library and
// ingredients ship in the bundle; user rows (logs, plans, ratings, lists)
// live in SQLite and sync later.
import { addDays, isoWeek } from "@vee/engine";
import {
  buildList,
  type Exclusion,
  type HouseholdMember,
  type Meal,
  type Moment,
  mergeList,
  type Portion,
  type Portions,
  parseTargets,
  type ShoppingItem,
  startTargets,
} from "@vee/nutrition";
import { type SavedMeal, SEED_INGREDIENTS, SEED_MEALS } from "@vee/nutrition/seed";
import {
  exclusions as exclusionsTable,
  food_logs,
  food_targets,
  household_members,
  meal_ingredients,
  meal_plans,
  meals,
  profiles,
  shopping_items,
  uuidv7,
} from "@vee/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/features/db/database";

const now = () => new Date().toISOString();
const stamps = () => ({ created_at: now(), updated_at: now() });

/** Today in the device's time zone, `YYYY-MM-DD`. */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The eating moment for a time of day. */
export function momentAt(d = new Date()): Moment {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 10.5) return "breakfast";
  if (h < 14.5) return "lunch";
  if (h < 17.5) return "snack";
  return "dinner";
}

export const thisWeek = () => isoWeek(localDate());
export const nextWeek = () => isoWeek(addDays(localDate(), 7));

/** Creates the start targets once. Later changes come from N1 only. */
export async function ensureTargets(): Promise<void> {
  const live = await db.select().from(food_targets).where(isNull(food_targets.deleted_at)).limit(1);
  if (live.length > 0) return;
  const profile = (await db.select().from(profiles).where(isNull(profiles.deleted_at)).limit(1))[0];
  const sex = profile?.sex === "female" ? "female" : "male";
  const t = startTargets({ goal: "lean-gain", sex });
  await db.insert(food_targets).values({
    id: uuidv7(),
    per_moment: JSON.stringify(t.perMoment),
    reason: JSON.stringify(t.reason),
    ...stamps(),
  });
}

export function readTargets(row: { per_moment: string | null } | undefined) {
  return row?.per_moment ? parseTargets(row.per_moment) : undefined;
}

export async function logPortion(
  date: string,
  moment: Moment,
  portion: Portion,
  amount: number,
): Promise<void> {
  const p: Portions = { palm: 0, fist: 0, cupped: 0, thumb: 0 };
  p[portion] = amount;
  await db.insert(food_logs).values({ id: uuidv7(), date, moment, ...p, ...stamps() });
}

export async function logSavedMeal(date: string, meal: SavedMeal): Promise<void> {
  await db.insert(food_logs).values({
    id: uuidv7(),
    date,
    moment: meal.moment,
    saved_meal_id: meal.id,
    ...meal.portions,
    ...stamps(),
  });
}

/** Soft-deletes the newest log of the day. */
export async function undoLastLog(date: string): Promise<boolean> {
  const last = (
    await db
      .select()
      .from(food_logs)
      .where(and(eq(food_logs.date, date), isNull(food_logs.deleted_at)))
      .orderBy(desc(food_logs.id))
      .limit(1)
  )[0];
  if (!last) return false;
  await db.update(food_logs).set({ deleted_at: now(), updated_at: now() }).where(eq(food_logs.id, last.id));
  return true;
}

export async function loadRules(): Promise<{ exclusions: Exclusion[]; household: HouseholdMember[] }> {
  const ex = await db.select().from(exclusionsTable).where(isNull(exclusionsTable.deleted_at));
  const members = await db.select().from(household_members).where(isNull(household_members.deleted_at));
  const household: HouseholdMember[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    isSelf: m.is_self === 1,
  }));
  if (!household.some((m) => m.isSelf)) household.push({ id: "self", name: "You", isSelf: true });
  const selfId = household.find((m) => m.isSelf)?.id ?? "self";
  const exclusions: Exclusion[] = ex.map((x) => ({
    memberId: x.member_id ?? selfId,
    kind: x.kind as Exclusion["kind"],
    ...(x.ingredient_id ? { ingredientId: x.ingredient_id } : {}),
    ...(x.tag ? { tag: x.tag } : {}),
  }));
  return { exclusions, household };
}

/** Meals the user added (accepted AI drafts). Seed meals ship in the bundle. */
let stored: Meal[] = [];

export const libraryMeals = (): Meal[] => [...SEED_MEALS, ...stored];

export async function refreshLibrary(): Promise<Meal[]> {
  const rows = await db
    .select()
    .from(meals)
    .where(and(isNull(meals.deleted_at), inArray(meals.origin, ["ai", "user"])));
  const parts = await db.select().from(meal_ingredients).where(isNull(meal_ingredients.deleted_at));
  stored = rows.map((m) => ({
    id: m.id,
    name: m.name,
    steps: m.steps ? (JSON.parse(m.steps) as string[]) : [],
    minutes: m.minutes ?? 0,
    servings: m.servings ?? 1,
    noCook: m.no_cook === 1,
    origin: m.origin === "ai" ? "ai" : "user",
    ingredients: parts
      .filter((p) => p.meal_id === m.id)
      .map((p) => ({
        ingredientId: p.ingredient_id,
        qty: p.qty ?? 0,
        unit: (p.unit ?? "g") as Meal["ingredients"][number]["unit"],
        role: p.role === "plate_extra" ? "plate_extra" : "pot",
      })),
  }));
  return libraryMeals();
}

/** Stores an accepted AI draft in the library. */
export async function addMeal(meal: Meal): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(meals).values({
      id: meal.id,
      name: meal.name,
      steps: JSON.stringify(meal.steps),
      minutes: meal.minutes,
      servings: meal.servings,
      origin: meal.origin,
      lactose_ok: 1,
      no_cook: meal.noCook ? 1 : 0,
      ...stamps(),
    });
    for (const i of meal.ingredients)
      await tx.insert(meal_ingredients).values({
        id: uuidv7(),
        meal_id: meal.id,
        ingredient_id: i.ingredientId,
        qty: i.qty,
        unit: i.unit,
        role: i.role,
        ...stamps(),
      });
  });
  await refreshLibrary();
}
export const ingredients = () => SEED_INGREDIENTS;
export const mealById = (id: string) => libraryMeals().find((m) => m.id === id);

export async function rateMeal(mealId: string, rating: number): Promise<void> {
  const seed = mealById(mealId);
  const row = (await db.select().from(meals).where(eq(meals.id, mealId)).limit(1))[0];
  if (row) {
    await db.update(meals).set({ rating, updated_at: now() }).where(eq(meals.id, mealId));
    return;
  }
  // A seed meal gets a user row that holds the rating.
  await db.insert(meals).values({
    id: mealId,
    name: seed?.name ?? mealId,
    minutes: seed?.minutes ?? null,
    servings: seed?.servings ?? null,
    origin: "seed",
    rating,
    lactose_ok: 1,
    ...stamps(),
  });
}

export async function setPlan(week: string, mealIds: string[]): Promise<void> {
  const row = (
    await db
      .select()
      .from(meal_plans)
      .where(and(eq(meal_plans.week, week), isNull(meal_plans.deleted_at)))
      .limit(1)
  )[0];
  if (row) {
    await db
      .update(meal_plans)
      .set({ meal_ids: JSON.stringify(mealIds), updated_at: now() })
      .where(eq(meal_plans.id, row.id));
  } else {
    await db
      .insert(meal_plans)
      .values({ id: uuidv7(), week, meal_ids: JSON.stringify(mealIds), ...stamps() });
  }
}

export function planIds(raw: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Builds the week's list from the plan. Unticked items from the old list stay. */
export async function buildShopping(week: string): Promise<number> {
  const plan = (
    await db
      .select()
      .from(meal_plans)
      .where(and(eq(meal_plans.week, week), isNull(meal_plans.deleted_at)))
      .limit(1)
  )[0];
  const ids = planIds(plan?.meal_ids);
  const staples = await stapleIds();
  const fresh = buildList(ids, libraryMeals(), ingredients(), staples);
  const oldRows = await db
    .select()
    .from(shopping_items)
    .where(and(eq(shopping_items.week, week), isNull(shopping_items.deleted_at)));
  const old: ShoppingItem[] = oldRows.map((r) => ({
    ingredientId: r.ingredient_id,
    qty: r.qty ?? 0,
    unit: (r.unit ?? "g") as ShoppingItem["unit"],
    shopSection: ingredients().find((i) => i.id === r.ingredient_id)?.shopSection ?? "pantry",
    checked: r.checked === 1,
  }));
  const merged = mergeList(old, fresh);
  await db.transaction(async (tx) => {
    for (const r of oldRows) {
      await tx
        .update(shopping_items)
        .set({ deleted_at: now(), updated_at: now() })
        .where(eq(shopping_items.id, r.id));
    }
    for (const i of merged) {
      await tx.insert(shopping_items).values({
        id: uuidv7(),
        week,
        ingredient_id: i.ingredientId,
        qty: i.qty,
        unit: i.unit,
        checked: i.checked ? 1 : 0,
        staple: 0,
        ...stamps(),
      });
    }
  });
  return merged.length;
}

export async function setChecked(id: string, checked: boolean): Promise<void> {
  await db
    .update(shopping_items)
    .set({ checked: checked ? 1 : 0, updated_at: now() })
    .where(eq(shopping_items.id, id));
}

/** Staples ("always have") are rows with staple = 1 in the `staples` week. */
export const STAPLE_WEEK = "staples";

export async function stapleIds(): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(shopping_items)
    .where(and(eq(shopping_items.week, STAPLE_WEEK), isNull(shopping_items.deleted_at)));
  return new Set(rows.map((r) => r.ingredient_id));
}

export async function markStaple(ingredientId: string): Promise<void> {
  await db.insert(shopping_items).values({
    id: uuidv7(),
    week: STAPLE_WEEK,
    ingredient_id: ingredientId,
    staple: 1,
    checked: 0,
    ...stamps(),
  });
}
