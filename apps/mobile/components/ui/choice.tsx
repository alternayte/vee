// SPDX-License-Identifier: AGPL-3.0-or-later
// A row of options; one or more can be on. Feedback starts on touch-down.
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import { cn } from "@/lib/utils";
import { Text } from "./text";

export type Option<T extends string | number> = { value: T; label: string };

export function Choice<T extends string | number>({
  options,
  selected,
  onToggle,
}: {
  options: Option<T>[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            onPressIn={() => {
              void Haptics.selectionAsync();
              onToggle(o.value);
            }}
            className={cn(
              "h-11 justify-center rounded-lg border px-4",
              on ? "border-accent bg-accent" : "border-border bg-surface",
            )}
          >
            <Text className={on ? "font-inter-semibold text-accent-text" : "text-text"}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
