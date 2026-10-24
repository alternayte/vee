// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Portion } from "@vee/nutrition";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";

export const PORTION_LABEL: Record<Portion, { name: string; unit: string; units: string }> = {
  palm: { name: "Protein", unit: "palm", units: "palms" },
  fist: { name: "Vegetables", unit: "fist", units: "fists" },
  cupped: { name: "Carbs", unit: "cupped hand", units: "cupped hands" },
  thumb: { name: "Fat", unit: "thumb", units: "thumbs" },
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function PortionBar({ portion, done, target }: { portion: Portion; done: number; target: number }) {
  const l = PORTION_LABEL[portion];
  const share = target > 0 ? Math.min(done / target, 1) : 0;
  const met = target > 0 && done >= target;
  return (
    <View
      className="gap-1"
      accessible
      accessibilityLabel={`${l.name}: ${fmt(done)} of ${fmt(target)} ${l.units}`}
    >
      <View className="flex-row justify-between">
        <Text variant="label">{l.name}</Text>
        <Text variant="label" style={{ fontVariant: ["tabular-nums"] }}>
          {fmt(done)} / {fmt(target)}
        </Text>
      </View>
      <View className="h-3 overflow-hidden rounded-full bg-surface-raised">
        <View className={met ? "h-3 bg-good" : "h-3 bg-accent"} style={{ width: `${share * 100}%` }} />
      </View>
    </View>
  );
}

/** Tap: 1 portion. Long press: half a portion. Feedback starts on touch-down. */
export function PortionButton({ portion, onAdd }: { portion: Portion; onAdd: (amount: number) => void }) {
  const l = PORTION_LABEL[portion];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add 1 ${l.unit} of ${l.name.toLowerCase()}`}
      accessibilityHint="Long press to add half"
      className="h-24 flex-1 items-center justify-center rounded-lg border border-border bg-surface active:bg-surface-raised"
      onPressIn={() => void Haptics.selectionAsync()}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onAdd(1);
      }}
      onLongPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onAdd(0.5);
      }}
    >
      <Text variant="heading">+</Text>
      <Text variant="label">{l.name}</Text>
    </Pressable>
  );
}
