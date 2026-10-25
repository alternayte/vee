// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings → Sync: connection, last sync, changes waiting to upload, and
// every change the server refused (I5).
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery, useStatus } from "@powersync/react";
import { sync_errors } from "@vee/schema";
import { desc, eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { EmptyState, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/features/account/account";
import { db, powersync } from "@/features/db/database";

function usePendingCount(): number | undefined {
  const [count, setCount] = useState<number>();
  useEffect(() => {
    let live = true;
    const read = () =>
      void powersync.getUploadQueueStats().then((s) => {
        if (live) setCount(s.count);
      });
    read();
    const t = setInterval(read, 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return count;
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text variant="label">{label}</Text>
      <Text testID={testID}>{value}</Text>
    </View>
  );
}

export function SyncScreen() {
  const signedIn = useAccount((s) => s.status === "signed-in");
  const status = useStatus();
  const pending = usePendingCount();
  const { data: refused } = useQuery(
    toCompilableQuery(db.select().from(sync_errors).orderBy(desc(sync_errors.created_at))),
  );

  const state = !signedIn ? "No account" : status.connected ? "Connected" : "Offline";
  const last = status.lastSyncedAt?.toLocaleString() ?? "Never";

  return (
    <Screen title="Sync" settings={false}>
      <View className="gap-3 rounded-lg border border-border bg-surface p-4">
        <Row label="Status" value={state} testID="sync-state" />
        <Row label="Last sync" value={last} />
        <Row
          label="Waiting to upload"
          value={pending === undefined ? "–" : String(pending)}
          testID="sync-pending"
        />
      </View>
      <Text variant="heading" accessibilityRole="header">
        Refused changes
      </Text>
      {refused.length === 0 ? (
        <EmptyState text="The server accepted every change." />
      ) : (
        refused.map((r) => (
          <View key={r.id} className="gap-2 rounded-lg border border-border bg-surface p-4">
            <Text>
              {r.table_name} · {r.op}
            </Text>
            <Text variant="muted">{r.message}</Text>
            <Text variant="label">
              {r.code} · {new Date(r.created_at).toLocaleString()}
            </Text>
            <Button
              label="Dismiss"
              variant="ghost"
              onPress={async () => {
                await db.delete(sync_errors).where(eq(sync_errors.id, r.id));
              }}
            />
          </View>
        ))
      )}
    </Screen>
  );
}
