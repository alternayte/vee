// SPDX-License-Identifier: AGPL-3.0-or-later
// Reason text per rule (invariant I3). The engine writes these words; the AI never does.
import type { Reason } from "./types";

const TEMPLATES: Record<string, string> = {
  PLAN_PICK:
    "This is rung {rung} of the {familyName} ladder. It is your current rung, and your kit and flags allow it.",
  PLAN_PICK_LOWER:
    "Your kit or flags do not allow rung {owned} of the {familyName} ladder. Rung {rung} is the nearest rung below.",
  PLAN_PICK_START:
    "Your kit or flags do not allow the first rungs of the {familyName} ladder. You start at rung {rung}, the lowest rung they allow.",
  PLAN_NO_OPTION: "Your kit and flags allow no {familyName} exercise. This slot is empty.",
  SETS_BASE: "This {role} movement starts at {sets} sets.",
  SETS_FILL: "{group} needs {target} sets in week {week}. The plan adds {added} here.",
  TARGET_DEFAULT: "{low} to {high} {unit} is the standard range for this exercise.",
  LOAD_START: "{load} kg is the lightest load that your kit allows. You start here.",
  LOAD_STATE: "{load} kg is your current load.",
  LOAD_SNAP: "Your kit cannot set {was} kg. {load} kg is the nearest lower load.",
  P1_MISS:
    "A set was below {low} {unit} at Hard or Failed. One more session with a miss moves this down one step.",
  P2_ONCE: "You hit {high} {unit} on all sets at Easy or Good. One more session like this moves you up.",
  P2_CALIBRATE:
    "All sets at {high} reps were Easy in one of your first {sessions} sessions on this exercise, so the dial goes {from} → {to} kg.",
  P2_UP: "{high} {unit} hit twice at Easy or Good, so {change}.",
  P2_RANGE: "{high} {unit} hit twice, so the range goes to the standard {newLow} to {newHigh} {unit}.",
  P2_TOP: "{high} {unit} hit twice, but your kit and flags allow no step up. Stay here and add reps.",
  P3_HOLD: "You are inside the range. Beat last time by 1 on one set: aim for {aim} {unit}.",
  P4_ONCE: "You held {hold} s on all sets. One more session like this adds 5 s.",
  P4_HOLD_UP: "You held {hold} s twice, so the hold goes to {next} s.",
  P4_RUNG: "You held {hold} s twice at the {cap} s cap, so {change}.",
  P5_SWAP: "No gain in {sessions} sessions, so the exercise changes to {exercise}.",
  P5_STALL: "No gain in {sessions} sessions. If 2 movements stall at the same time, a deload starts.",
  P6_BACK_OFF: "Misses in 2 sessions in a row, so {change}.",
  P6_FLOOR: "Misses in 2 sessions in a row. This is the easiest step, so you stay here.",
  P7_HOLD: "This session was {mode}, so progression does not change.",
  MICRO_HOLD: "This micro session counts toward your hold target of {hold} s.",
  MICRO_NONE: "Micro sessions do not change progression.",
  ROTATION_NEXT:
    "{day} ({name}) is next. It is the first session in the rotation that you did not do in this cycle.",
  MICRO_OFFER:
    "Yesterday was a main session. A 10-minute micro session is possible today ({max} a week at most).",
  MICRO_SINGLES:
    "Your best is {best} strict pull-ups. Micro sets use {low} to {high} reps, well below your best.",
  MICRO_HANGS: "Your best hang is {best} s. Micro hangs use {low} to {high} s, well below your best.",
  MICRO_MOBILITY: "Mobility keeps your joints ready for the next main session.",
  PLACE_TEST: "Your {item} result of {value} places you on rung {rung} of the {familyName} ladder.",
  PLACE_LIMIT:
    "Your {item} result of {value} is a big gain. A test moves a ladder up {max} rungs at most, so you go to rung {rung}.",
  SWAP_SAME_RUNG: "{exercise} is on the same rung of the same ladder. Muscle match: {match}%.",
  SWAP_NEAR_RUNG: "{exercise} is one rung away on the same ladder (rung {rung}). Muscle match: {match}%.",
  SWAP_PATTERN: "{exercise} has the same movement pattern and main muscle. Muscle match: {match}%.",
  HOLD_START: "{hold} s is the starting hold for this exercise.",
  HOLD_STATE: "{hold} s is your current hold target.",
  TARGET_PLACEMENT:
    "Your test placed you here at {low} to {high} reps. The standard range comes when you own it.",
  BAND_START: "Use the band {setting}. This is the starting setting.",
  BAND_STATE: "Use the band {setting}. This is your current setting.",
  TEMPO_DEFAULT: "Tempo {tempo}: seconds down, pause, up, pause.",
  TEMPO_STAGE: "Tempo {tempo}. This is step {stage} before the next dial value.",
  SETS_EXTRA: "One set is added before the next dial value: {sets} sets.",
  WARMUP: "Warm-up: one light set of this movement.",
  CLIMB_PULL: "You climbed in the last 48 hours, so vertical pull has one set fewer.",
  DELOAD_SETS: "Deload week: half the sets.",
  READINESS_TRIMMED:
    "Your check-in score is 7 to 10, so each movement has one set fewer and nothing moves up today.",
  READINESS_RECOVERY:
    "Your check-in score is 6 or less. Today is a {minutes}-minute recovery session: mobility and your two main movements at {sets} easy sets.",
  DELOAD_WEEK: "This is a deload week. Sets are half, loads and rungs stay the same, and nothing moves up.",
  DELOAD_EARLY_READINESS: "{low} of your last {of} check-ins were low. A deload week starts now.",
  DELOAD_EARLY_STALL: "{count} movements have stalled: {families}. A deload week starts now.",
  PROPOSAL_SWAP:
    "{exercise} replaces {was} on day {day}. Same ladder, rung {rung}, and your kit and flags allow it.",
  PROPOSAL_SETS: "Sets for {exercise} on day {day} go from {from} to {to}. The day still fits {minutes} min.",
  PROPOSAL_DELOAD: "A deload week starts on {date}. Sets are half, and loads and rungs stay the same.",
  PROPOSAL_NOT_IN_PLAN: "The plan has no {what} on day {day}.",
  PROPOSAL_FAMILY: "{exercise} is not on the {familyName} ladder.",
  PROPOSAL_RUNG: "{exercise} is rung {rung}. You own rung {owned}, so it is too hard now.",
  PROPOSAL_KIT: "Your kit or flags do not allow {exercise}.",
  PROPOSAL_SETS_RANGE: "A {role} movement has 1 to {max} sets.",
  PROPOSAL_TIME: "With {sets} sets, day {day} takes {needed} min. Your sessions are {minutes} min.",
  PROPOSAL_VOLUME: "With {sets} sets, {group} gets {volume} sets a week. The limit for your goal is {limit}.",
  PROPOSAL_DELOAD_RUNNING: "A deload week runs now or is done in this block.",
  PROPOSAL_DELOAD_NOT_NEEDED:
    "A deload needs 2 movements stalled for {needed} sessions or 2 low check-ins. Now {stalled} movements stalled and {low} of your last {of} check-ins were low.",
  PROPOSAL_NOT_STALLED:
    "Sessions without progress for {exercise}: {sessions}. A change needs {needed}, so the plan stays.",
  PROPOSAL_SETS_STEP: "Sets go up by 1 at a time. The movement has {from} sets now.",
  PROPOSAL_UNKNOWN: "Vee does not know the exercise {exercise}.",
  TIME_CUT_DROP: "{exercise} is removed to fit {minutes} min.",
  TIME_CUT_PAIR: "Accessories alternate in pairs with shorter rest to fit {minutes} min.",
  TIME_CUT_ACCESSORY_SETS: "Accessory sets go down to 2 to fit {minutes} min.",
  TIME_CUT_MAIN_SETS: "Main sets go down by 1 to fit {minutes} min.",
  TIME_CUT_FIRST_MAIN_SETS: "Sets on the first movement go down by 1 to fit {minutes} min.",
};

/** The template of a rule's reason, with its {inputs} unfilled. */
export const ruleTemplate = (ruleId: string): string | undefined => TEMPLATES[ruleId];

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
