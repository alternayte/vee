// SPDX-License-Identifier: AGPL-3.0-or-later
// The sign-in link opens here (App Link or app scheme). The app verifies the
// token and keeps the session.
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { verifyLink } from "./account";

export function MagicLinkScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!token) {
      setError("This link has no sign-in token. Ask for a new link.");
      return;
    }
    verifyLink(token)
      .then(() => router.replace("/settings"))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  return (
    <Screen title="Sign in" settings={false}>
      {error ? (
        <>
          <Text testID="magic-error">{error}</Text>
          <Button label="Go to Settings" onPress={() => router.replace("/settings")} />
        </>
      ) : (
        <Text variant="muted">Signing in…</Text>
      )}
    </Screen>
  );
}
