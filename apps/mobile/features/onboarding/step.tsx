// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";
import { View } from "react-native";
import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";

export const STEPS = ["body", "kit", "time", "goal", "flags", "baseline"] as const;

export function Step({
  step,
  title,
  intro,
  children,
  next,
  nextLabel = "Next",
  canNext = true,
}: {
  step: (typeof STEPS)[number];
  title: string;
  intro?: string;
  children: ReactNode;
  next: () => void;
  nextLabel?: string;
  canNext?: boolean;
}) {
  return (
    <Screen title={title} settings={false}>
      <Text variant="label">
        Step {STEPS.indexOf(step) + 1} of {STEPS.length}
      </Text>
      {intro && <Text variant="muted">{intro}</Text>}
      {children}
      <Button label={nextLabel} disabled={!canNext} className={canNext ? "" : "opacity-40"} onPress={next} />
    </Screen>
  );
}

export function Field({
  label,
  unit,
  value,
  onChange,
  testID,
}: {
  label: string;
  unit?: string;
  value: string;
  onChange: (t: string) => void;
  testID?: string;
}) {
  return (
    <View className="gap-1">
      <Text variant="label">{unit ? `${label} (${unit})` : label}</Text>
      <Input
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        inputMode="decimal"
      />
    </View>
  );
}
