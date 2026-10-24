// SPDX-License-Identifier: AGPL-3.0-or-later
import "@azure/core-asynciterator-polyfill";
import "react-native-get-random-values";
import "../global.css";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from "@expo-google-fonts/inter";
import { PowerSyncContext } from "@powersync/react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { loadAccount } from "@/features/account/account";
import { powersync } from "@/features/db/database";
import { useTokens } from "@/features/theme/use-tokens";

void SplashScreen.preventAutoHideAsync();
void loadAccount();

export default function RootLayout() {
  const [loaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const { theme, color } = useTokens();

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.background }}>
      <SafeAreaProvider>
        <PowerSyncContext.Provider value={powersync}>
          <StatusBar style={theme === "dark" ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: color.background },
              animation: "fade",
              animationDuration: 160,
            }}
          />
        </PowerSyncContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
