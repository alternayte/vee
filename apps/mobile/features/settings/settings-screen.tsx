// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings: account, sync and your data. Everything except sign-in works
// with no account and no connection.

import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import { ui_prefs } from "@vee/schema";
import { eq } from "drizzle-orm";
import * as LocalAuthentication from "expo-local-authentication";
import { Link } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Alert, Linking, Pressable, Switch, View } from "react-native";
import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { AccountError, deleteAccount, requestLink, signOut, useAccount } from "@/features/account/account";
import { HAS_SERVER } from "@/features/account/config";
import { LOCK_KEY, setBodyLock } from "@/features/body/screens";
import { db, powersync } from "@/features/db/database";
import { REMINDERS, setReminder } from "@/features/reminders/schedule";
import { useTokens } from "@/features/theme/use-tokens";
import { importCsvFile, shareExportJson, shareSetsCsv } from "./data";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const messageOf = (e: unknown) =>
  e instanceof AccountError || e instanceof Error ? e.message : "Something went wrong. Try again.";

function confirm(title: string, text: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, text, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

function AccountSection() {
  const { status, session } = useAccount();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(undefined);
    try {
      await fn();
    } catch (e) {
      setMessage(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (!HAS_SERVER) {
    return <Text variant="muted">This build has no server. Your data stays on this phone.</Text>;
  }

  if (status === "signed-in" && session) {
    return (
      <>
        <Text testID="account-email">Signed in as {session.email}</Text>
        <Button
          label="Sign out"
          variant="secondary"
          disabled={busy}
          onPress={() =>
            run(async () => {
              const pending = (await powersync.getUploadQueueStats()).count;
              const text =
                pending > 0
                  ? `${pending} changes are not uploaded yet. If you sign out now, they are lost. Your other data stays on the server.`
                  : "Your data stays on the server. This phone keeps no copy.";
              if (await confirm("Sign out?", text, "Sign out")) await signOut();
            })
          }
        />
        <Button
          label="Delete account"
          variant="ghost"
          disabled={busy}
          onPress={() =>
            run(async () => {
              const ok = await confirm(
                "Delete your account?",
                "This deletes your account and all your data on the server and on this phone. Export your data first to keep a copy.",
                "Delete",
              );
              if (!ok) return;
              await deleteAccount();
              setMessage("Your account and all your data are deleted from the server.");
            })
          }
        />
        {message && <Text testID="account-message">{message}</Text>}
      </>
    );
  }

  return (
    <>
      <Text variant="muted">
        Sign in to back up your data and use it on more devices. Without an account, everything works on this
        phone.
      </Text>
      <Input
        testID="email-input"
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
      />
      <Button
        label="Send sign-in link"
        disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}
        onPress={() =>
          run(async () => {
            await requestLink(email);
            setSentTo(email.trim());
          })
        }
      />
      {sentTo && !message && (
        <Text testID="account-message">
          We sent a link to {sentTo}. Open it on this phone. It works once, for 10 minutes.
        </Text>
      )}
      {message && <Text testID="account-message">{message}</Text>}
    </>
  );
}

function DataSection() {
  const [message, setMessage] = useState<string>();

  async function run(fn: () => Promise<string | undefined> | Promise<void>) {
    setMessage(undefined);
    try {
      setMessage((await fn()) ?? undefined);
    } catch (e) {
      setMessage(messageOf(e));
    }
  }

  return (
    <>
      <Text variant="muted">Export works with no account and no connection.</Text>
      <Button label="Export all data (JSON)" variant="secondary" onPress={() => run(shareExportJson)} />
      <Button label="Export sets (CSV)" variant="secondary" onPress={() => run(shareSetsCsv)} />
      <Button
        label="Import from Hevy, Strong or FitNotes"
        variant="secondary"
        onPress={() =>
          run(async () => {
            const r = await importCsvFile();
            return r
              ? `Imported ${r.sessions} sessions and ${r.sets} sets. ${r.customExercises} new custom exercises.`
              : undefined;
          })
        }
      />
      {message && <Text testID="data-message">{message}</Text>}
    </>
  );
}

/** One switch per local reminder. Quiet hours (21:30 to 07:30) hold them all back. */
function Reminders() {
  const { data } = useQuery(toCompilableQuery(db.select().from(ui_prefs)));
  const off = new Set(data.filter((r) => r.value === "0").map((r) => r.key));
  return (
    <>
      {REMINDERS.map((r) => (
        <View key={r.key} className="flex-row items-center justify-between gap-3">
          <Text className="flex-1">{r.label}</Text>
          <Switch
            value={!off.has(r.key)}
            accessibilityLabel={r.label}
            onValueChange={(on) => void setReminder(r.key, on)}
          />
        </View>
      ))}
      <Text variant="muted">
        Quiet hours from 21:30 to 07:30. During a session, the rest alert still comes.
      </Text>
      <Text variant="muted">
        For a rest alert on the second, allow "Alarms and reminders" for Vee in the Android settings. Without
        it, Android can send the alert up to a minute late when the screen is off.
      </Text>
      <Button
        label="Open Vee's Android settings"
        variant="ghost"
        onPress={() => void Linking.openSettings()}
      />
    </>
  );
}

/** Locks the Body tab and photos behind a fingerprint or face check. */
function BodyLock() {
  const { data } = useQuery(toCompilableQuery(db.select().from(ui_prefs).where(eq(ui_prefs.key, LOCK_KEY))));
  const [message, setMessage] = useState<string>();
  return (
    <>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1">Lock Body and photos</Text>
        <Switch
          value={data.length > 0}
          accessibilityLabel="Lock Body and photos"
          onValueChange={async (on) => {
            if (on && !(await LocalAuthentication.hasHardwareAsync())) {
              setMessage("This phone has no fingerprint or face unlock.");
              return;
            }
            await setBodyLock(on);
          }}
        />
      </View>
      {message && <Text variant="muted">{message}</Text>}
    </>
  );
}

export function SettingsScreen() {
  const { color } = useTokens();
  return (
    <Screen title="Settings" settings={false}>
      <Section title="Account">
        <AccountSection />
      </Section>
      <Link href="/settings/sync" asChild>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Sync"
          className="flex-row items-center justify-between rounded-lg border border-border bg-surface p-4"
        >
          <Text>Sync</Text>
          <ChevronRight color={color["text-muted"]} />
        </Pressable>
      </Link>
      <Link href="/settings/coach" asChild>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Coach"
          className="flex-row items-center justify-between rounded-lg border border-border bg-surface p-4"
        >
          <Text>Coach</Text>
          <ChevronRight color={color["text-muted"]} />
        </Pressable>
      </Link>
      <Section title="Reminders">
        <Reminders />
      </Section>
      <Section title="Privacy">
        <BodyLock />
      </Section>
      <Section title="Your data">
        <DataSection />
      </Section>
    </Screen>
  );
}
