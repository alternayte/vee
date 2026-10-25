// SPDX-License-Identifier: AGPL-3.0-or-later
import { router } from "expo-router";
import { Choice } from "@/components/ui/choice";
import { Text } from "@/components/ui/text";
import { setDraft, useDraft } from "./draft";
import { Step } from "./step";

const MINUTES = [20, 25, 30, 35, 40, 45, 50, 60];

export function TimeScreen() {
  const time = useDraft((s) => s.time);
  const set = (patch: Partial<typeof time>) => setDraft({ time: { ...time, ...patch } });
  return (
    <Step
      step="time"
      title="Your time"
      intro="Sessions follow a rotation, not fixed weekdays. The next session is the next one you have not done."
      next={() => router.push("/welcome/goal")}
    >
      <Text variant="label">Training days per week</Text>
      <Choice
        options={[3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))}
        selected={[time.sessionsPerWeek]}
        onToggle={(v) => set({ sessionsPerWeek: v })}
      />
      <Text variant="label">Minutes per session</Text>
      <Choice
        options={MINUTES.map((m) => ({ value: m, label: `${m} min` }))}
        selected={[time.minutesPerSession]}
        onToggle={(v) => set({ minutesPerSession: v })}
      />
      <Text variant="label">Usual time of day</Text>
      <Choice
        options={[
          { value: "morning", label: "Morning" },
          { value: "midday", label: "Midday" },
          { value: "evening", label: "Evening" },
        ]}
        selected={[time.timeOfDay]}
        onToggle={(v) => set({ timeOfDay: v })}
      />
    </Step>
  );
}
