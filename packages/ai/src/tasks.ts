// SPDX-License-Identifier: AGPL-3.0-or-later
// The AI tasks (SDD "AI layer"). Each builds the minimised input, calls the
// gateway, and checks the answer. The engine supplies every number and
// checks every plan change (I4); the AI writes words and parameters only.
import {
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
import { DINNER_PROTEINS } from "@vee/nutrition/seed";
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
  const days = p?.templates ?? [];
  // The changes the engine accepts now (I4), so the model picks from them.
  const passes = (c: PlanChange) => p !== undefined && validateProposal(input, c).ok;
  return {
    week: { from, to },
    training,
    food,
    weight,
    minutesPerSession: input.profile.minutesPerSession,
    plan: days.map((t) => ({
      dayType: t.dayType,
      name: t.name,
      minutes: t.estimatedMinutes,
      items: t.items.map((i) => ({ exerciseId: i.exerciseId, family: i.family, role: i.role, sets: i.sets })),
    })),
    swapOptions: days
      .flatMap((t) =>
        t.items.map((i) => ({
          dayType: t.dayType,
          family: i.family,
          current: i.exerciseId,
          options: input.catalogue.exercises
            .filter(
              (e) =>
                e.family === i.family &&
                e.id !== i.exerciseId &&
                passes({ kind: "swap", dayType: t.dayType, family: i.family, to: e.id }),
            )
            .map((e) => e.id),
        })),
      )
      .filter((o) => o.options.length > 0),
    setsOptions: days.flatMap((t) =>
      t.items
        .filter((i) =>
          passes({ kind: "sets", dayType: t.dayType, exerciseId: i.exerciseId, sets: i.sets + 1 }),
        )
        .map((i) => ({ dayType: t.dayType, exerciseId: i.exerciseId, sets: i.sets + 1 })),
    ),
    deloadAllowed: passes({ kind: "deload" }),
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

/** Proposals that parse and pass the engine check. The rest are dropped, not shown. */
function checkedProposals(input: EngineInput, out: WeeklyReviewOut): ReviewProposal[] {
  const kept: ReviewProposal[] = [];
  for (const p of out.proposals) {
    const change = PlanChangeSchema.safeParse(p.change);
    if (!change.success || !p.why) continue;
    const v = validateProposal(input, change.data as PlanChange);
    if (v.ok) kept.push({ change: change.data as PlanChange, why: p.why, reasons: v.reasons });
  }
  return kept;
}

/**
 * Exercises the text names that are not in the plan or in a kept swap: a
 * change in the words without a card (H4).
 */
function unplannedExercises(input: EngineInput, text: string, kept: ReviewProposal[]): string[] {
  const names = (ids: string[]) =>
    input.catalogue.exercises.filter((e) => ids.includes(e.id)).map((e) => e.names.en.toLowerCase());
  const allowed = [
    ...names((input.programme?.templates ?? []).flatMap((t) => t.items.map((i) => i.exerciseId))),
    ...names(input.history.progress.map((s) => s.exerciseId ?? "")),
    ...names(kept.flatMap((p) => (p.change.kind === "swap" ? [p.change.to] : []))),
  ];
  const lower = text.toLowerCase();
  return input.catalogue.exercises
    .map((e) => e.names.en)
    .filter((n) => lower.includes(n.toLowerCase()))
    .filter((n) => !allowed.some((a) => a.includes(n.toLowerCase())));
}

const SETS_CHANGE = /\b(add|more|extra|fewer|remove|drop|cut)\b[^.]*\bsets?\b/i;
/** Load, reps and rungs come from the engine; the focus must not change them. */
const TARGET_CHANGE =
  /\b(add|more|increase|raise|heavier|lower|reduce|less|lighter|step)\b[^.]*\b(load|weight|kg|reps?|rungs?)\b/i;

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
      ...(() => {
        const kept = checkedProposals(input, out);
        const unplanned = unplannedExercises(input, `${out.words} ${out.focus}`, kept);
        // Why the engine dropped a card, so the retry can fix the words that need it.
        const refused = out.proposals
          .flatMap((p) => {
            const change = PlanChangeSchema.safeParse(p.change);
            const v = change.success ? validateProposal(input, change.data as PlanChange) : undefined;
            return v && !v.ok ? [`The engine refuses a proposal: ${v.reason.text}`] : [];
          })
          .join(" ");
        return [
          ...(unplanned.length
            ? [
                `The text names ${unplanned.join(", ")}, which is not in the plan. Name it only with a valid swap proposal. ${refused}`.trim(),
              ]
            : []),
          ...(TARGET_CHANGE.test(out.focus)
            ? ['"focus" changes a load, reps or a rung. The app sets these. Give a different focus.']
            : []),
          ...(SETS_CHANGE.test(out.focus) && !kept.some((p) => p.change.kind === "sets")
            ? [
                `"focus" changes sets, but no valid sets proposal goes with it. Remove it or propose it. ${refused}`.trim(),
              ]
            : []),
        ];
      })(),
    ],
  });
  if (!r.ok) return { numbers, proposals: [], usage: r.usage, error: r.error };
  const proposals = checkedProposals(input, r.output);
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

const RULE_CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

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
      ...(RULE_CODE.test(out.text) ? ['"text" has a rule code. Do not name the "ruleId".'] : []),
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
  /** The meals the user has now: seed meals and stored meals. */
  library: { name: string; ingredientIds: string[] }[];
};

/** The ingredient in the meal with the most of this portion: its main protein or carb. */
function main(ids: string[], ingredients: Ingredient[], portion: "palm" | "cupped") {
  const best = ingredients
    .filter((i) => ids.includes(i.id) && (i.per100?.[portion] ?? 0) > 0)
    .sort((a, b) => (b.per100?.[portion] ?? 0) - (a.per100?.[portion] ?? 0))[0];
  return best?.id;
}

/** Plain phrases for an ingredient: its id and its name before a comma or bracket. */
const phrases = (i: Ingredient) => [
  i.id.replace(/-/g, " "),
  (i.name.split(/[,(]/)[0] ?? "").trim().toLowerCase(),
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const said = (text: string, phrase: string) =>
  phrase.length > 2 && new RegExp(`\\b${escapeRegex(phrase)}(e?s)?\\b`).test(text);

/** Ingredients the name or the steps name that are not in the meal. */
function missingIngredients(text: string, out: MealDraft, ingredients: Ingredient[]): string[] {
  const lower = text.toLowerCase();
  const used = ingredients
    .filter((i) => out.ingredients.some((x) => x.ingredientId === i.id))
    .flatMap(phrases);
  return ingredients
    .flatMap((i) => phrases(i).map((p) => ({ i, p })))
    .filter(({ p }) => said(lower, p) && !used.some((u) => u.includes(p)))
    .map(({ i }) => i.name)
    .filter((n, k, all) => all.indexOf(n) === k);
}

/** Checks the meal rules do not cover: servings, the name, the steps and the library (H4). */
export function draftProblems(out: MealDraft, c: MealContext, protein?: string): string[] {
  const problems: string[] = [];
  if (protein && !out.ingredients.some((i) => i.ingredientId === protein))
    problems.push(`"ingredients" has no ${protein}. Build the meal around "protein".`);
  if (out.minutes > c.maxMinutes) problems.push(`"minutes" is ${out.minutes}. The limit is ${c.maxMinutes}.`);
  if (out.servings < c.household.length)
    problems.push(`"servings" is ${out.servings}. The household has ${c.household.length} people.`);
  const inName = missingIngredients(out.name, out, c.ingredients);
  if (inName.length) problems.push(`The name has ${inName.join(", ")}, which is not in "ingredients".`);
  const inSteps = missingIngredients(out.steps.join(" "), out, c.ingredients);
  if (inSteps.length) problems.push(`The steps use ${inSteps.join(", ")}, which is not in "ingredients".`);
  if (c.library.some((m) => m.name.toLowerCase() === out.name.toLowerCase()))
    problems.push(`"${out.name}" is already in the library. Draft a different meal.`);
  return problems;
}

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

/**
 * The main protein for the draft, at random from the allowed dinner proteins.
 * The model alone gave the same meal on every tap (H4).
 */
function pickProtein(allowed: Ingredient[], random: () => number): string | undefined {
  const ok = DINNER_PROTEINS.filter((id) => allowed.some((i) => i.id === id));
  return ok[Math.floor(random() * ok.length)];
}

export async function mealDraft(
  gw: Gateway,
  route: Route,
  c: MealContext,
  newId: () => string,
  random: () => number = Math.random,
) {
  const allowed = allowedIngredients(c);
  const protein = pickProtein(allowed, random);
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
    householdSize: c.household.length,
    ...(protein ? { protein } : {}),
    library: c.library.map((m) => ({
      name: m.name,
      protein: main(m.ingredientIds, c.ingredients, "palm"),
      carb: main(m.ingredientIds, c.ingredients, "cupped"),
    })),
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
      const own = draftProblems(out, c, protein);
      if (own.length) return own;
      const slot = out.minutes <= WEEKNIGHT_MAX_MIN || out.noCook ? "weeknight" : "weekend";
      const check = checkMeal(toMeal(out), c.ingredients, c.exclusions, c.household, { slot });
      return check.status === "pass" ? [] : check.violations.map((v) => v.reason.text);
    },
  });
  return r.ok ? { ...r, output: toMeal(r.output) } : r;
}
