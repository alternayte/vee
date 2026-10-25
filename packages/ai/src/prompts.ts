// SPDX-License-Identifier: AGPL-3.0-or-later
// Prompts are versioned files: packages/ai/prompts/{task}.v{N}.md. A prompt
// change bumps N.
import { readFileSync } from "node:fs";

export const PROMPT_VERSIONS = {
  weekly_review: 3,
  explain_more: 2,
  adjust_today: 2,
  meal_draft: 3,
  coach_chat: 1,
} as const;

export type TaskName = keyof typeof PROMPT_VERSIONS;

export function prompt(task: TaskName): string {
  const file = new URL(`../prompts/${task}.v${PROMPT_VERSIONS[task]}.md`, import.meta.url);
  return readFileSync(file, "utf8")
    .replace(/<!--[\s\S]*?-->\s*/g, "")
    .trim();
}
