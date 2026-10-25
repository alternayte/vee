// SPDX-License-Identifier: AGPL-3.0-or-later
// Output schemas per task (SDD "AI layer" table). The gateway sends them as
// JSON Schema and checks the answer with Zod.
import { JOINTS } from "@vee/catalogue";
import { z } from "zod";

const DayType = z.enum(["A", "B", "C", "D"]);

export const PlanChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("swap"), dayType: DayType, family: z.string(), to: z.string() }),
  z.object({ kind: z.literal("sets"), dayType: DayType, exerciseId: z.string(), sets: z.number().int() }),
  z.object({ kind: z.literal("deload") }),
]);

export const WeeklyReviewOut = z.object({
  words: z.string().min(1),
  focus: z.string().min(1),
  // A malformed change is dropped later, like a change the engine refuses,
  // so one bad proposal does not cost the whole review.
  proposals: z
    .array(z.object({ change: z.record(z.string(), z.unknown()), why: z.string().optional() }))
    .max(3),
});
export type WeeklyReviewOut = z.infer<typeof WeeklyReviewOut>;

/** What the model is asked for. An empty answer came back for the open `change` object. */
export const WeeklyReviewWire = WeeklyReviewOut.extend({
  proposals: z.array(z.object({ change: PlanChangeSchema, why: z.string().min(1) })).max(3),
});

export const AdjustTodayOut = z.object({
  minutes: z.number().int().min(10).max(90).optional(),
  flags: z.array(z.object({ joint: z.enum(JOINTS), severity: z.enum(["mild", "acute"]) })).optional(),
  focus: z.array(z.string()).optional(),
  note: z.string().optional(),
});
export type AdjustTodayOut = z.infer<typeof AdjustTodayOut>;

export const ExplainMoreOut = z.object({ text: z.string().min(1) });
export type ExplainMoreOut = z.infer<typeof ExplainMoreOut>;

export const MealDraftOut = z.object({
  name: z.string().min(1),
  minutes: z.number().int().min(1).max(180),
  servings: z.number().int().min(1).max(8),
  noCook: z.boolean(),
  steps: z.array(z.string().min(1)).min(1).max(12),
  ingredients: z
    .array(
      z.object({
        ingredientId: z.string(),
        qty: z.number().positive(),
        unit: z.enum(["g", "ml", "piece"]),
        role: z.enum(["pot", "plate_extra"]),
      }),
    )
    .min(2)
    .max(20),
});
export type MealDraftOut = z.infer<typeof MealDraftOut>;

export const LIMITS = { reviewWords: 120, reviewMinWords: 25, explainWords: 80, proposals: 3 } as const;
