// SPDX-License-Identifier: AGPL-3.0-or-later
import { router } from "expo-router";
import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

export function WelcomeScreen() {
  return (
    <Screen title="Welcome to Vee" settings={false}>
      <Text>
        Vee plans each session from your body, your kit and your time. It tells you why each number is what it
        is.
      </Text>
      <Text variant="muted">
        Setup takes about 5 minutes, plus 10 minutes if you do the baseline test now.
      </Text>
      <Text variant="muted">Everything stays on this phone. An account is optional.</Text>
      <Button label="Start" onPress={() => router.push("/welcome/body")} />
    </Screen>
  );
}
