// SPDX-License-Identifier: AGPL-3.0-or-later
// Calls to the API's AI routes. The AI is optional: every failure is a plain
// message, and the rest of the app keeps working (PRD "AI coach").
import { useAccount } from "@/features/account/account";
import { API_URL, HAS_SERVER } from "@/features/account/config";

export type AiResult<T> = { ok: true; value: T } | { ok: false; message: string };

const fail = (message: string): AiResult<never> => ({ ok: false, message });

export async function aiPost<T>(path: string, body: unknown): Promise<AiResult<T>> {
  if (!HAS_SERVER) return fail("This build has no server, so AI is off.");
  const token = useAccount.getState().session?.token;
  if (!token) return fail("AI needs an account. Sign in from Settings.");
  let r: Response;
  try {
    r = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return fail("AI needs a connection. Everything else works offline.");
  }
  const json = (await r.json().catch(() => ({}))) as { error?: string; paused_until?: string } & T;
  if (r.ok) return { ok: true, value: json };
  if (r.status === 402)
    return fail(`AI is paused until ${json.paused_until}. Everything else keeps working.`);
  if (r.status === 401) return fail("Your sign-in has expired. Sign in again from Settings.");
  if (json.error === "plus-required") return fail("AI needs the plus tier.");
  if (json.error === "ai-off") return fail("AI is off on this server.");
  return fail("The AI answer did not pass the checks. Try again later.");
}
