// SPDX-License-Identifier: AGPL-3.0-or-later
// The coach chat stream: POST /ai/chat, read server-sent events as they come.
// The conversation stays in the local-only chat_messages table.
import { chat_messages, uuidv7 } from "@vee/schema";
import { asc } from "drizzle-orm";
import { fetch } from "expo/fetch";
import { useAccount } from "@/features/account/account";
import { API_URL, HAS_SERVER } from "@/features/account/config";
import { db } from "@/features/db/database";

/** The turns the server takes with one message (its limit). */
const TURNS = 20;
const MAX_CHARS = 4000;

export const UNCONFIRMED = "This answer has a number that Vee cannot confirm in your data.";

export type ChatEvents = { text: (delta: string) => void };

/** Sends the user's message with the last turns. Returns an error message, or undefined when the answer is stored. */
export async function sendMessage(content: string, on: ChatEvents): Promise<string | undefined> {
  if (!HAS_SERVER) return "This build has no server, so the coach chat is off.";
  const token = useAccount.getState().session?.token;
  if (!token) return "The coach chat needs an account. Sign in from Settings.";
  const now = new Date().toISOString();
  await db.insert(chat_messages).values({ id: uuidv7(), role: "user", content, created_at: now });
  const history = await db.select().from(chat_messages).orderBy(asc(chat_messages.created_at));
  const messages = history.slice(-TURNS).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content.slice(0, MAX_CHARS),
  }));

  let r: Response;
  try {
    r = await fetch(`${API_URL}/ai/chat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ messages }),
    });
  } catch {
    return "The coach chat needs a connection. Everything else works offline.";
  }
  if (!r.ok) {
    const json = (await r.json().catch(() => ({}))) as { error?: string; paused_until?: string };
    if (r.status === 402) return `AI is paused until ${json.paused_until}. Everything else keeps working.`;
    if (r.status === 401) return "Your sign-in has expired. Sign in again from Settings.";
    if (json.error === "plus-required") return "The coach chat needs the plus tier.";
    if (json.error === "ai-off") return "AI is off on this server.";
    return "The coach cannot answer now. Try again later.";
  }

  let answer = "";
  let unconfirmed: string[] = [];
  let failed: string | undefined;
  const reader = r.body?.getReader();
  if (!reader) return "The coach cannot answer now. Try again later.";
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf("\n\n");
    while (end >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "null") as Record<string, unknown> | null;
      if (event === "text" && typeof data?.delta === "string") {
        answer += data.delta;
        on.text(data.delta);
      } else if (event === "done") unconfirmed = (data?.unconfirmed as string[]) ?? [];
      else if (event === "error") failed = String(data?.message ?? "The coach cannot answer now.");
      end = buffer.indexOf("\n\n");
    }
  }
  if (answer.trim()) {
    await db.insert(chat_messages).values({
      id: uuidv7(),
      role: "assistant",
      content: answer,
      note: unconfirmed.length ? UNCONFIRMED : null,
      created_at: new Date().toISOString(),
    });
  }
  return failed;
}

export const clearChat = () => db.delete(chat_messages);
