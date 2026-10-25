// SPDX-License-Identifier: AGPL-3.0-or-later
// The AI tasks (SDD "AI layer"). Each builds the minimised input, calls the
// gateway, and checks the answer. The engine supplies every number and
// checks every plan change (I4); the AI writes words and parameters only.
import {
  checkAllowed,
  type EngineInput,
  type PlanChange,
  type Reason,
  type SessionTemplate,
  trainingWeek,
  validateProposal,
} from "@vee/engine";
import {
  checkMeal,
  type Exclusion,
  type HouseholdMember,
  type Ingredient,
  type Meal,
  MIN_PROTEIN_PALMS,
  WEEKNIGHT_MAX_MIN,
} from "@vee/nutrition";
import type { FoodWeek } from "./food";
import type { Gateway, Route, Usage } from "./gateway";
import { inventedNumbers, wordCount } from "./numbers";
import { prompt, type TaskName } from "./prompts";
import {
  type AdjustTodayOut as AdjustToday,
  AdjustTodayOut,
  ExplainMoreOut,
  LIMITS,
  type MealDraftOut as MealDraft,
  MealDraftOut,
  PlanChangeSchema,
  WeeklyReviewOut,
  WeeklyReviewWire,
} from "./schemas";
import type { ReviewNumbers } from "./types";

/**
 * Per attempt. Tasks the user waits for: 20 s. The weekly review is a job,
 * and a meal draft at high effort takes longer (V12: p90 about 16 s), so 60 s.
 */
export const TIMEOUT_MS: Record<TaskName, number> = {
  weekly_review: 60_000,
  explain_more: 20_000,
  adjust_today: 20_000,
  meal_draft: 60_000,
};

export type Routes = Record<TaskName, Route>;

const PLACEHOLDER = /placeholder|lorem ipsum|\bTODO\b|\.\.\.$|\[[a-z ]+\]/i;

function numbersProblem(where: string, text: string, input: unknown): string[] {
  const bad = inventedNumbers(text, input);
  return bad.length === 0
    ? []
    : [`${where} has numbers that are not in the input: ${bad.join(", ")}. Use only numbers from the input.`];
}

// ── weekly_review ──────────────────────────────────────────────────────────

export function reviewNumbers(
  input: EngineInput,
  from: string,
  to: string,
  food: FoodWeek,
  weight: ReviewNumbers["weight"],
): ReviewNumbers {
  const { from: _f, to: _t, ...training } = trainingWeek(input, from, to);
  const p = input.programme;
  const owned = (family: string) => input.history.progress.find((s) => s.family === family)?.rung ?? 1;
  return {
    week: { from, to },
    training,
    food,
    weight,
    minutesPerSession: input.profile.minutesPerSession,
    plan: (p?.templates ?? []).map((t) => ({
      dayType: t.dayType,
      name: t.name,
      minutes: t.estimatedMinutes,
      items: t.items.map((i) => ({ exerciseId: i.exerciseId, family: i.family, role: i.role, sets: i.sets })),
    })),
    swapOptions: (p?.templates ?? []).flatMap((t) =>
      t.items.map((i) => ({
        dayType: t.dayType,
        family: i.family,
        current: i.exerciseId,
        options: input.catalogue.exercises
          .filter(
            (e) =>
              e.family === i.family &&
              e.id !== i.exerciseId &&
              e.rung <= owned(i.family) &&
              checkAllowed(e, input.kit, input.flags, input.today).ok,
          )
          .map((e) => e.id),
      })),
    ),
  };
}

export type ReviewProposal = { change: PlanChange; why: string; reasons: Reason[] };

export type Review = {
  numbers: ReviewNumbers;
  /** Undefined when the model failed twice: the review shows the numbers without words. */
  words?: string;
  focus?: string;
  proposals: ReviewProposal[];
  model?: string;
  usage: Usage[];
  error?: string;
};

export async function weeklyReview(
  gw: Gateway,
  route: Route,
  input: EngineInput,
  numbers: ReviewNumbers,
): Promise<Review> {
  const r = await gw.run({
    name: "weekly_review",
    system: prompt("weekly_review"),
    input: numbers,
    schema: WeeklyReviewOut,
    wireSchema: WeeklyReviewWire,
    route,
    timeoutMs: TIMEOUT_MS.weekly_review,
    validate: (out) => [
      ...(wordCount(out.words) < LIMITS.reviewMinWords
        ? [
            `"words" has ${wordCount(out.words)} words. Write the review: at least ${LIMITS.reviewMinWords} words.`,
          ]
        : []),
      ...(wordCount(out.focus) < 4 ? ['"focus" must be one full sentence.'] : []),
      ...(PLACEHOLDER.test(`${out.words} ${out.focus}`)
        ? ["The answer has placeholder text. Write the real review."]
        : []),
      ...(wordCount(out.words) > LIMITS.reviewWords
        ? [`"words" has ${wordCount(out.words)} words. The limit is ${LIMITS.reviewWords}.`]
        : []),
      ...numbersProblem('"words"', out.words, numbers),
      ...numbersProblem('"focus"', out.focus, numbers),
      ...out.proposals.flatMap((p, n) => numbersProblem(`proposal ${n + 1} "why"`, p.why ?? "", numbers)),
    ],
  });
  if (!r.ok) return { numbers, proposals: [], usage: r.usage, error: r.error };
  // A proposal that fails the engine check is dropped, not shown.
  const proposals: ReviewProposal[] = [];
  for (const p of r.output.proposals) {
    const change = PlanChangeSchema.safeParse(p.change);
    if (!change.success || !p.why) continue;
    const v = validateProposal(input, change.data as PlanChange);
    if (v.ok) proposals.push({ change: change.data as PlanChange, why: p.why, reasons: v.reasons });
  }
  return {
    numbers,
    words: r.output.words,
    focus: r.output.focus,
    proposals,
    model: r.usage.at(-1)?.model ?? route.model,
    usage: r.usage,
  };
}

// ── explain_more ───────────────────────────────────────────────────────────

export async function explainMore(gw: Gateway, route: Route, reasons: Reason[]) {
  const input = reasons.map((r) => ({ ruleId: r.ruleId, inputs: r.inputs, text: r.text }));
  return gw.run({
    name: "explain_more",
    system: prompt("explain_more"),
    input,
    schema: ExplainMoreOut,
    route,
    timeoutMs: TIMEOUT_MS.explain_more,
    validate: (out) => [
      ...(wordCount(out.text) > LIMITS.explainWords
        ? [`"text" has ${wordCount(out.text)} words. The limit is ${LIMITS.explainWords}.`]
        : []),
      ...numbersProblem('"text"', out.text, input),
    ],
  });
}

// ── adjust_today ───────────────────────────────────────────────────────────

const JOINT_LIST = ["shoulder", "elbow", "wrist", "knee", "lower-back"];

export async function adjustToday(gw: Gateway, route: Route, text: string, template: SessionTemplate) {
  const families = [...new Set(template.items.map((i) => i.family))];
  const input = {
    text,
    template: {
      dayType: template.dayType,
      name: template.name,
      minutes: template.estimatedMinutes,
      items: template.items.map((i) => ({ family: i.family, exerciseId: i.exerciseId, sets: i.sets })),
    },
    joints: JOINT_LIST,
    families,
  };
  return gw.run<AdjustToday>({
    name: "adjust_today",
    system: prompt("adjust_today"),
    input,
    schema: AdjustTodayOut,
    route,
    timeoutMs: TIMEOUT_MS.adjust_today,
    validate: (out) => [
      ...(out.focus ?? [])
        .filter((f) => !families.includes(f))
        .map((f) => `"focus" has "${f}", which is not in "families".`),
    ],
  });
}

// ── meal_draft ─────────────────────────────────────────────────────────────

export type MealContext = {
  ingredients: Ingredient[];
  exclusions: Exclusion[];
  household: HouseholdMember[];
  maxMinutes: number;
  recent: string[];
};

/** Ingredients no household member excludes, so a shared pot is safe. */
function allowedIngredients(c: MealContext): Ingredient[] {
  return c.ingredients.filter(
    (ing) =>
      !c.exclusions.some((x) =>
        x.kind === "lactose"
          ? ing.lactoseClass === "high"
          : x.ingredientId === ing.id || (x.tag !== undefined && ing.tags.includes(x.tag)),
      ),
  );
}

export async function mealDraft(gw: Gateway, route: Route, c: MealContext, newId: () => string) {
  const allowed = allowedIngredients(c);
  const input = {
    ingredients: allowed.map((i) => ({
      id: i.id,
      name: i.name,
      tags: i.tags,
      ...(i.per100?.palm ? { proteinPalmsPer100: i.per100.palm } : {}),
      ...(i.pieceG ? { gramsPerPiece: i.pieceG } : {}),
    })),
    exclusions: c.exclusions.map((x) => ({
      member: c.household.find((m) => m.id === x.memberId)?.name ?? x.memberId,
      kind: x.kind,
      ...(x.tag ? { tag: x.tag } : {}),
      ...(x.ingredientId ? { ingredient: x.ingredientId } : {}),
    })),
    maxMinutes: c.maxMinutes,
    proteinPalmsPerServing: MIN_PROTEIN_PALMS,
    recent: c.recent,
  };
  const toMeal = (out: MealDraft): Meal => ({ id: newId(), origin: "ai", ...out });
  const r = await gw.run({
    name: "meal_draft",
    system: prompt("meal_draft"),
    input,
    schema: MealDraftOut,
    route,
    timeoutMs: TIMEOUT_MS.meal_draft,
    validate: (out) => {
      if (out.minutes > c.maxMinutes) return [`"minutes" is ${out.minutes}. The limit is ${c.maxMinutes}.`];
      const slot = out.minutes <= WEEKNIGHT_MAX_MIN || out.noCook ? "weeknight" : "weekend";
      const check = checkMeal(toMeal(out), c.ingredients, c.exclusions, c.household, { slot });
      return check.status === "pass" ? [] : check.violations.map((v) => v.reason.text);
    },
  });
  return r.ok ? { ...r, output: toMeal(r.output) } : r;
}
