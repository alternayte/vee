// SPDX-License-Identifier: AGPL-3.0-or-later
import { Tabs } from "expo-router";
import { Apple, ChartLine, CircleDot, ListChecks, MessageSquare } from "lucide-react-native";
import { useTokens } from "@/features/theme/use-tokens";

export default function TabsLayout() {
  const { color } = useTokens();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color["text-muted"],
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border },
        tabBarLabelStyle: { fontFamily: "Inter_500Medium" },
        sceneStyle: { backgroundColor: color.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Today", tabBarIcon: ({ color: c }) => <CircleDot color={c} /> }}
      />
      <Tabs.Screen
        name="plan"
        options={{ title: "Plan", tabBarIcon: ({ color: c }) => <ListChecks color={c} /> }}
      />
      <Tabs.Screen
        name="body"
        options={{ title: "Body", tabBarIcon: ({ color: c }) => <ChartLine color={c} /> }}
      />
      <Tabs.Screen
        name="food"
        options={{ title: "Food", tabBarIcon: ({ color: c }) => <Apple color={c} /> }}
      />
      <Tabs.Screen
        name="coach"
        options={{ title: "Coach", tabBarIcon: ({ color: c }) => <MessageSquare color={c} /> }}
      />
    </Tabs>
  );
}
