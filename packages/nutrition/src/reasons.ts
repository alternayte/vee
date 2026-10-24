// SPDX-License-Identifier: AGPL-3.0-or-later
// Reason text per food rule. The engine writes these words; the AI never does.
import type { Reason } from "./types";

const TEMPLATES: Record<string, string> = {
  FOOD_START:
    "These are the standard hand portions for {goal}: {main} of each per main meal and {snack} at the snack.",
  N1_ADD:
    "Your weight trend was flat for 3 weeks ({slope} kg a week), so you get 1 more cupped hand of carbs a day.",
  N1_REMOVE:
    "Your weight goes up faster than 0.25 kg a week ({slope} kg a week), so you get 1 cupped hand of carbs fewer a day.",
  N1_HOLD:
    "Your weight trend is {slope} kg a week. This is inside the target band, so the portions stay the same.",
  N1_GAPS:
    "There are {count} weigh-ins in the last 21 days. The trend needs 8 or more, so the portions stay the same.",
  N1_WAIT: "The portions changed {days} days ago. The next change can come after 14 days.",
  N1_FLOOR: "Your weight goes up fast, but there are no carb portions left to remove.",
  CHECK_LACTOSE: "{ingredient} has lactose.",
  CHECK_REFUSAL: "{ingredient} is on your list of foods to avoid.",
  CHECK_SHARED_POT: "{ingredient} goes in the shared pot, and {member} must not eat it.",
  CHECK_WEEKNIGHT_TIME: "This meal takes {minutes} min. Weeknight meals take {max} min or less.",
  CHECK_NO_COOK_TIME: "This no-cook meal takes {minutes} min. No-cook meals take {max} min or less.",
  CHECK_PROTEIN: "One serving has {palm} palms of protein. A meal needs at least 1.",
  CHECK_UNKNOWN: "{ingredient} is not in the ingredient list, so the meal needs a review.",
};

export function reason(ruleId: string, inputs: Record<string, number | string>): Reason {
  const template = TEMPLATES[ruleId];
  if (template === undefined) throw new Error(`no reason template for ${ruleId}`);
  const text = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = inputs[key];
    if (v === undefined) throw new Error(`reason ${ruleId}: no input "${key}"`);
    return String(v);
  });
  return { ruleId, inputs, text };
}
