// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "./ui/text";

export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <ScrollView contentContainerClassName="gap-4 p-5">
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        <View className="gap-4">{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View className="rounded-lg border border-border bg-surface p-4">
      <Text variant="muted">{text}</Text>
    </View>
  );
}
