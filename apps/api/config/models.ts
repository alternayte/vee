// SPDX-License-Identifier: AGPL-3.0-or-later
// Model routes (SDD "AI layer"). Model IDs come from env; changing one needs
// `just eval` (V12) to pass. Effort: high where no one waits, low where the
// user waits for the answer.
import type { Routes } from "@vee/ai";
import type { Env } from "../src/env";

export function modelRoutes(env: Env): Routes {
  return {
    weekly_review: { model: env.AI_MODEL_WRITER, effort: "high" },
    meal_draft: { model: env.AI_MODEL_STRUCTURED, effort: "high" },
    adjust_today: { model: env.AI_MODEL_STRUCTURED, effort: "low" },
    explain_more: { model: env.AI_MODEL_WRITER, effort: "low" },
  };
}
