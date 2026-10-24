// SPDX-License-Identifier: AGPL-3.0-or-later
// Reason text per rule (invariant I3). The engine writes these words; the AI never does.
import type { Reason } from "./types";

const TEMPLATES: Record<string, string> = {
  PLAN_PICK:
    "This is rung {rung} of the {familyName} ladder. It is your current rung, and your kit and flags allow it.",
  PLAN_PICK_LOWER:
    "Your kit or flags do not allow rung {owned} of the {familyName} ladder. Rung {rung} is the nearest rung below.",
  PLAN_NO_OPTION: "Your kit and flags allow no {familyName} exercise. This slot is empty.",
  SETS_BASE: "This {role} movement starts at {sets} sets.",
  SETS_FILL: "{group} needs {target} sets in week {week}. The plan adds {added} here.",
  TARGET_DEFAULT: "{low} to {high} {unit} is the standard range for this exercise.",
  LOAD_START: "{load} kg is the lightest load that your kit allows. You start here.",
  LOAD_STATE: "{load} kg is your current load.",
  LOAD_SNAP: "Your kit cannot set {was} kg. {load} kg is the nearest lower load.",
  TIME_CUT_DROP: "{exercise} is removed to fit {minutes} min.",
  TIME_CUT_PAIR: "Accessories alternate in pairs with shorter rest to fit {minutes} min.",
  TIME_CUT_ACCESSORY_SETS: "Accessory sets go down to 2 to fit {minutes} min.",
  TIME_CUT_MAIN_SETS: "Main sets go down by 1 to fit {minutes} min.",
  TIME_CUT_FIRST_MAIN_SETS: "Sets on the first movement go down by 1 to fit {minutes} min.",
};

export function reason(ruleId: string, inputs: Record<string, number | string>): Reason {
  const template = TEMPLATES[ruleId];
  if (template === undefined) throw new Error(`no reason template for ${ruleId}`);
  const text = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = inputs[key];
    if (v === undefined) throw new Error(`reason ${ruleId}: no input "${key}"`);
    return String(v);
  });
  return { ruleId, inputs, text: text.charAt(0).toUpperCase() + text.slice(1) };
}
