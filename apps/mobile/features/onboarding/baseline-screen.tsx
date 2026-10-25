// SPDX-License-Identifier: AGPL-3.0-or-later
// Baseline test (PRD "Onboarding"): optional on day one. The results set the
// starting rung on each ladder. Without it, every ladder starts at its lowest
// rung that kit and flags allow.
import { loadOptions, type TestItem } from "@vee/engine";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Text } from "@/components/ui/text";
import { catalogue } from "@/features/training/catalogue";
import { completeOnboarding } from "@/features/training/data";
import { num, useDraft } from "./draft";
import { Field, Step } from "./step";

const ITEMS: { item: TestItem; label: string; unit: string; how: string }[] = [
  {
    item: "hang",
    label: "Dead hang",
    unit: "seconds",
    how: "Hang from the bar with straight arms. Stop when your grip fails.",
  },
  {
    item: "pullups",
    label: "Pull-ups",
    unit: "reps",
    how: "Strict reps from a dead hang, chin above the bar. Zero is a valid result.",
  },
  {
    item: "pushups",
    label: "Push-ups",
    unit: "reps",
    how: "Chest to a fist's height from the floor, body straight. Stop at the first bad rep.",
  },
  {
    item: "dip_hold",
    label: "Dip support hold",
    unit: "seconds",
    how: "Hold yourself up on straight arms on the dip handles.",
  },
  {
    item: "goblet_squat",
    label: "Goblet squats",
    unit: "reps",
    how: "Hold one dumbbell at your chest. Squat until your hips are below your knees.",
  },
  {
    item: "plank",
    label: "Plank",
    unit: "seconds",
    how: "Forearms and toes on the floor, body straight. Stop when your hips drop.",
  },
];

export function BaselineScreen() {
  const draft = useDraft();
  const [testing, setTesting] = useState<boolean>();
  const [values, setValues] = useState<Partial<Record<TestItem, string>>>({});
  const [squatKg, setSquatKg] = useState<number>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const goblet = catalogue.exercises.find((e) => e.id === "goblet-squat");
  const loads = goblet ? loadOptions(goblet, draft.kit) : [];

  type Result = { item: TestItem; value: number; loadKg?: number };
  const results = ITEMS.flatMap(({ item }): Result[] => {
    const v = num(values[item] ?? "");
    if (v === undefined || v < 0) return [];
    if (item === "goblet_squat") return squatKg === undefined ? [] : [{ item, value: v, loadKg: squatKg }];
    return [{ item, value: v }];
  });

  async function finish(withTest: boolean) {
    const b = draft.body;
    if (!b.heightCm || !b.weightKg || !b.birthYear || !b.sex) {
      router.replace("/welcome/body");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await completeOnboarding({
        ...draft,
        body: {
          heightCm: b.heightCm,
          weightKg: b.weightKg,
          birthYear: b.birthYear,
          sex: b.sex,
          ...(b.waistCm ? { waistCm: b.waistCm } : {}),
        },
        ...(withTest && results.length > 0 ? { baseline: results } : {}),
      });
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Step
      step="baseline"
      title="Baseline test"
      intro="The test takes about 10 minutes. It puts you on the right rung of each ladder. If you skip it, each ladder starts at its first rung and moves up as you log sessions."
      nextLabel={testing ? "Save results and make my plan" : "Skip the test and make my plan"}
      canNext={!busy && (!testing || results.length > 0)}
      next={() => void finish(testing === true)}
    >
      <Choice
        options={[
          { value: "test", label: "Do the test now" },
          { value: "skip", label: "Skip it" },
        ]}
        selected={testing === undefined ? [] : [testing ? "test" : "skip"]}
        onToggle={(v) => setTesting(v === "test")}
      />
      {testing &&
        ITEMS.filter((i) => i.item !== "goblet_squat" || loads.length > 0).map((i) => (
          <View key={i.item} className="gap-2 rounded-lg border border-border bg-surface p-4">
            <Text>{i.label}</Text>
            <Text variant="muted">{i.how}</Text>
            {i.item === "goblet_squat" && (
              <Choice
                options={loads.map((kg) => ({ value: kg, label: `${kg} kg` }))}
                selected={squatKg === undefined ? [] : [squatKg]}
                onToggle={setSquatKg}
              />
            )}
            <Field
              label={i.label}
              unit={i.unit}
              value={values[i.item] ?? ""}
              onChange={(t) => setValues((s) => ({ ...s, [i.item]: t }))}
              testID={`test-${i.item}`}
            />
          </View>
        ))}
      {testing && <Text variant="muted">Leave a field empty to skip that item.</Text>}
      {error && <Text testID="onboarding-error">{error}</Text>}
      {busy && <Button label="Making your plan…" disabled variant="secondary" />}
    </Step>
  );
}
