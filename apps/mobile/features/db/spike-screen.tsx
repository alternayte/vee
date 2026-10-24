// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Screen } from "@/components/screen";
import { Text } from "@/components/ui/text";
import { db, powersync } from "./database";
import { type Check, runSpike } from "./spike";

export function DbSpikeScreen() {
  const [checks, setChecks] = useState<Check[] | undefined>();

  useEffect(() => {
    let live = true;
    void runSpike(db, powersync).then((r) => {
      if (live) setChecks(r);
    });
    return () => {
      live = false;
    };
  }, []);

  const passed = checks?.filter((c) => c.ok).length ?? 0;
  const summary =
    checks === undefined
      ? "Database spike: running"
      : passed === checks.length
        ? "Database spike: all passed"
        : `Database spike: ${checks.length - passed} failed`;

  return (
    <Screen title="Database">
      <Text testID="db-spike-summary" variant="heading">
        {summary}
      </Text>
      {checks?.map((c) => (
        <View key={c.name} className="rounded-md border border-border bg-surface p-3">
          <Text className={c.ok ? "text-good" : "text-critical"}>
            {c.ok ? "Pass" : "Fail"}: {c.name}
          </Text>
          <Text variant="muted">{c.detail}</Text>
        </View>
      ))}
    </Screen>
  );
}
