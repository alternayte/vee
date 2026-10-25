// SPDX-License-Identifier: AGPL-3.0-or-later
import { Stack } from "expo-router";
import { useTokens } from "@/features/theme/use-tokens";

export default function PlanLayout() {
  const { color } = useTokens();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.background },
        animation: "slide_from_right",
        animationDuration: 180,
      }}
    />
  );
}
