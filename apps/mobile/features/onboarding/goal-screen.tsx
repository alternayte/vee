// SPDX-License-Identifier: AGPL-3.0-or-later
import { GOAL_TEMPLATES } from "@vee/engine";
import { router } from "expo-router";
import { Choice } from "@/components/ui/choice";
import { setDraft, useDraft } from "./draft";
import { Step } from "./step";

const GOAL_NAMES: Record<string, string> = { "v-taper-lean-gain": "V-taper, lean gain" };

export function GoalScreen() {
  const goal = useDraft((s) => s.goalTemplate);
  return (
    <Step
      step="goal"
      title="Your goal"
      intro="Back and side delts get the most work, because they make the V. Legs and core get enough for balance and health."
      next={() => router.push("/welcome/flags")}
    >
      <Choice
        options={Object.keys(GOAL_TEMPLATES).map((id) => ({ value: id, label: GOAL_NAMES[id] ?? id }))}
        selected={[goal]}
        onToggle={(v) => setDraft({ goalTemplate: v })}
      />
    </Step>
  );
}
