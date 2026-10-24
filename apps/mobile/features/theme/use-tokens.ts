// SPDX-License-Identifier: AGPL-3.0-or-later
// Token colours for native props that do not take a className (tab bar,
// status bar, navigation theme).
import { colors, type ThemeName } from "@vee/tokens";
import { useColorScheme } from "react-native";

export function useTokens() {
  const theme: ThemeName = useColorScheme() === "light" ? "light" : "dark";
  return { theme, color: colors[theme] };
}
