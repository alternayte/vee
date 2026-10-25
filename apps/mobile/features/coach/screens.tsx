// SPDX-License-Identifier: AGPL-3.0-or-later
// The Coach tab (PRD "AI coach"): plan-change cards from every source, and the
// coach chat. The chat reads the user's data only through the server's read
// tools; a change it proposes is a card here, never applied by itself (I4).
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import type { Reason } from "@vee/engine";
import { ai_proposals, chat_messages } from "@vee/schema";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { useState } from "react";
import { View } from "react-native";
import { EmptyState, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/features/account/account";
import { ProposalCard, type StoredChange } from "@/features/ai/proposal-card";
import { db } from "@/features/db/database";
import { clearChat, sendMessage } from "./chat";

const parse = <T,>(s: string | null): T | undefined => (s ? (JSON.parse(s) as T) : undefined);

const SOURCE = {
  review: "Weekly review",
  chat: "Coach chat",
  mcp: "Connected app",
  coach: "Your coach",
} as const;

function Cards() {
  const { data } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(ai_proposals)
        .where(and(eq(ai_proposals.status, "pending"), isNull(ai_proposals.deleted_at)))
        .orderBy(desc(ai_proposals.created_at)),
    ),
  );
  if (data.length === 0) return null;
  return (
    <View className="gap-3">
      <Text variant="heading" accessibilityRole="header">
        Plan changes to check
      </Text>
      {data.map((p) => {
        const change = parse<StoredChange>(p.change);
        if (!change) return null;
        return (
          <View key={p.id} className="gap-1">
            <Text variant="label">{SOURCE[p.source as keyof typeof SOURCE] ?? p.source}</Text>
            <ProposalCard id={p.id} change={change} reasons={parse<Reason[]>(p.validation) ?? []} />
          </View>
        );
      })}
    </View>
  );
}

function Bubble({ from, content, note }: { from: string; content: string; note?: string | null }) {
  const mine = from === "user";
  return (
    <View
      className={`max-w-[90%] gap-1 rounded-lg border border-border p-3 ${mine ? "self-end bg-background" : "self-start bg-surface"}`}
      testID={mine ? "chat-user" : "chat-answer"}
    >
      <Text>{content}</Text>
      {note && <Text variant="muted">{note}</Text>}
    </View>
  );
}

export function CoachScreen() {
  const signedIn = useAccount((s) => s.status === "signed-in");
  const { data: messages } = useQuery(
    toCompilableQuery(db.select().from(chat_messages).orderBy(asc(chat_messages.created_at))),
  );
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string>();
  const [error, setError] = useState<string>();

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming !== undefined) return;
    setDraft("");
    setError(undefined);
    setStreaming("");
    const failed = await sendMessage(text, { text: (d) => setStreaming((s) => (s ?? "") + d) });
    setStreaming(undefined);
    if (failed) setError(failed);
  };

  return (
    <Screen title="Coach">
      <Cards />
      <Text variant="heading" accessibilityRole="header">
        Coach chat
      </Text>
      {!signedIn ? (
        <EmptyState text="The coach chat needs an account, the plus tier and a connection. Sign in from Settings." />
      ) : (
        <>
          {messages.length === 0 && streaming === undefined && (
            <EmptyState text='Ask about your training, food or weight. For example: "Why am I stuck on pull-ups?" The coach reads your logs. It can propose a plan change, and you accept or reject it here.' />
          )}
          {messages.map((m) => (
            <Bubble key={m.id} from={m.role} content={m.content} note={m.note} />
          ))}
          {streaming !== undefined && (
            <Bubble from="assistant" content={streaming || "The coach reads your data…"} />
          )}
          {error && <Text variant="muted">{error}</Text>}
          <Input
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask the coach"
            accessibilityLabel="Message to the coach"
            multiline
            className="h-auto min-h-12 py-3"
            testID="chat-input"
          />
          <View className="flex-row gap-2">
            <Button
              label={streaming !== undefined ? "The coach is answering…" : "Send"}
              disabled={streaming !== undefined || !draft.trim()}
              onPress={() => void send()}
              testID="chat-send"
            />
            {messages.length > 0 && streaming === undefined && (
              <Button label="Clear the chat" variant="ghost" onPress={() => void clearChat()} />
            )}
          </View>
        </>
      )}
    </Screen>
  );
}
