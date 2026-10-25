// SPDX-License-Identifier: AGPL-3.0-or-later
import { Redirect, Tabs } from "expo-router";
import { Apple, ChartLine, CircleDot, ListChecks, MessageSquare } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useCoachAutoApply } from "@/features/coach/auto-apply";
import { scheduleAll } from "@/features/reminders/schedule";
import { useTokens } from "@/features/theme/use-tokens";
import { hasProfile } from "@/features/training/data";

export default function TabsLayout() {
  const { color } = useTokens();
  const [onboarded, setOnboarded] = useState<boolean>();
  useCoachAutoApply();
  // Reminders follow the data: re-made on start and each time the app comes to the front.
  useEffect(() => {
    void scheduleAll();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void scheduleAll();
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    void hasProfile().then(setOnboarded);
  }, []);
  if (onboarded === undefined) return null;
  if (!onboarded) return <Redirect href="/welcome" />;
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
