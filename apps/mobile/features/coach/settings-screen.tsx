// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings → Coach: connect to a coach with an invite code, pick what they may
// see, and change or remove it at any time (PRD "Consent"). The coach sees
// only these scopes, and each of their reads shows here as the last access.
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import { coach_links } from "@vee/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { useState } from "react";
import { Alert, Switch, View } from "react-native";
import { EmptyState, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/features/account/account";
import { db } from "@/features/db/database";
import { acceptInvite, previewInvite, revoke, SCOPES, type Scope, setAutoApply, setScopes } from "./links";

const SCOPE_TEXT: Record<Scope, string> = {
  training: "Sessions, sets, check-ins, tests and your plan. Your coach can also propose plan changes.",
  food: "Your food logs and portion targets.",
  body: "Your weight and measurements.",
  photos: "Your progress photos, when photo sync is on.",
};

const toggle = (list: Scope[], s: Scope) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]);

function Connect() {
  const [code, setCode] = useState("");
  const [coach, setCoach] = useState<string>();
  const [scopes, setPicked] = useState<Scope[]>(["training"]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!coach) {
    return (
      <View className="gap-3">
        <Text variant="muted">Your coach gives you a code. Enter it here.</Text>
        <Input
          value={code}
          onChangeText={setCode}
          placeholder="ABCD-EFGH"
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Invite code"
          testID="invite-code"
        />
        <Button
          label={busy ? "Checking…" : "Check the code"}
          disabled={busy || code.trim().length < 4}
          onPress={async () => {
            setBusy(true);
            setMessage(undefined);
            const r = await previewInvite(code);
            if (r.ok) setCoach(r.value.coachName);
            else setMessage(r.message);
            setBusy(false);
          }}
        />
        {message && <Text variant="muted">{message}</Text>}
      </View>
    );
  }
  return (
    <View className="gap-3">
      <Text>
        Connect to {coach}. Select what {coach} can see:
      </Text>
      <Choice options={[...SCOPES]} selected={scopes} onToggle={(s) => setPicked((x) => toggle(x, s))} />
      {scopes.map((s) => (
        <Text key={s} variant="muted">
          {SCOPE_TEXT[s]}
        </Text>
      ))}
      <View className="flex-row gap-2">
        <Button
          label={busy ? "Connecting…" : "Connect"}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            const r = await acceptInvite(code, scopes);
            if (r.ok) {
              setCoach(undefined);
              setCode("");
              setMessage(
                `You are connected to ${r.value.coachName}. The link shows here after the next sync.`,
              );
            } else setMessage(r.message);
            setBusy(false);
          }}
        />
        <Button label="Cancel" variant="ghost" onPress={() => setCoach(undefined)} />
      </View>
      {message && <Text variant="muted">{message}</Text>}
    </View>
  );
}

function LinkCard({ link }: { link: typeof coach_links.$inferSelect }) {
  const name = link.coach_name ?? "Your coach";
  const scopes = (link.scopes ? JSON.parse(link.scopes) : []) as Scope[];
  return (
    <View className="gap-3 rounded-lg border border-border bg-surface p-4" testID="coach-link">
      <Text variant="heading">{name}</Text>
      <Text variant="muted">
        {link.last_access_at
          ? `Last accessed by your coach: ${new Date(link.last_access_at).toLocaleString()}`
          : "Your coach has not opened your data yet."}
      </Text>
      <Choice
        options={[...SCOPES]}
        selected={scopes}
        onToggle={(s) => void setScopes(link.id, toggle(scopes, s))}
      />
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1">Apply {name}'s plan changes without asking</Text>
        <Switch
          value={link.auto_apply === 1}
          onValueChange={(on) => void setAutoApply(link.id, on)}
          accessibilityLabel="Apply coach changes without asking"
        />
      </View>
      <Text variant="muted">Vee checks each change against your kit, flags and time first.</Text>
      <Button
        label="Remove this coach"
        variant="secondary"
        onPress={() =>
          Alert.alert(`Remove ${name}?`, `${name} cannot see your data or send messages after this.`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => void revoke(link.id) },
          ])
        }
      />
    </View>
  );
}

export function CoachSettingsScreen() {
  const signedIn = useAccount((s) => s.status === "signed-in");
  const { data: links } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(coach_links)
        .where(and(eq(coach_links.status, "active"), isNull(coach_links.deleted_at)))
        .orderBy(desc(coach_links.created_at)),
    ),
  );
  return (
    <Screen title="Coach" settings={false}>
      {!signedIn ? (
        <EmptyState text="A coach connection needs an account. Sign in from Settings." />
      ) : (
        <>
          {links.map((l) => (
            <LinkCard key={l.id} link={l} />
          ))}
          <Text variant="heading" accessibilityRole="header">
            Connect a coach
          </Text>
          <Connect />
        </>
      )}
    </Screen>
  );
}
