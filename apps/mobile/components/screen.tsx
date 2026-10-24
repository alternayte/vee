// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "expo-router";
import { Settings } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTokens } from "@/features/theme/use-tokens";
import { Text } from "./ui/text";

export function Screen({
  title,
  children,
  settings = true,
}: {
  title: string;
  children: ReactNode;
  /** Shows the link to Settings next to the title. */
  settings?: boolean;
}) {
  const { color } = useTokens();
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "left", "right"]}>
      <ScrollView contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center justify-between">
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
          {settings && (
            <Link href="/settings" asChild>
              <Pressable accessibilityRole="link" accessibilityLabel="Settings" hitSlop={12}>
                <Settings color={color["text-muted"]} />
              </Pressable>
            </Link>
          )}
        </View>
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
