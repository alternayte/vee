// SPDX-License-Identifier: AGPL-3.0-or-later
// Push for coach messages, comments and changes, straight to FCM HTTP v1
// (SDD "Notifications"). A push carries no message text: the app shows the
// text when it opens and syncs. Push is off without FCM_SERVICE_ACCOUNT.
import { importPKCS8, SignJWT } from "jose";
import type pg from "pg";
import { z } from "zod";

const ServiceAccount = z.object({
  project_id: z.string(),
  client_email: z.string(),
  private_key: z.string(),
  token_uri: z.string().url().default("https://oauth2.googleapis.com/token"),
});

export type Push = { send(userId: string, title: string): Promise<void> };

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export function createPush(pool: pg.Pool, serviceAccount: string | undefined, f: typeof fetch = fetch): Push {
  if (!serviceAccount) return { send: async () => undefined };
  const sa = ServiceAccount.parse(JSON.parse(serviceAccount));
  let cached: { token: string; until: number } | undefined;

  async function accessToken(): Promise<string> {
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const key = await importPKCS8(sa.private_key, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(sa.client_email)
      .setAudience(sa.token_uri)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const r = await f(sa.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!r.ok) throw new Error(`FCM auth failed: ${r.status}`);
    const body = (await r.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, until: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  return {
    /** Sends to every device of the user. A failure is logged; it never fails the request that caused it. */
    async send(userId, title) {
      try {
        const tokens = (
          await pool.query<{ id: string; token: string }>(
            "SELECT id, token FROM push_tokens WHERE user_id = $1",
            [userId],
          )
        ).rows;
        if (tokens.length === 0) return;
        const bearer = await accessToken();
        for (const t of tokens) {
          const r = await f(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
            method: "POST",
            headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
            body: JSON.stringify({
              message: {
                token: t.token,
                notification: { title },
                android: { priority: "high", notification: { channel_id: "coach" } },
              },
            }),
          });
          // FCM answers 404 UNREGISTERED for a token the device no longer has.
          if (r.status === 404) await pool.query("DELETE FROM push_tokens WHERE id = $1", [t.id]);
          else if (!r.ok) console.error(JSON.stringify({ msg: "push failed", status: r.status }));
        }
      } catch (e) {
        console.error(
          JSON.stringify({ msg: "push failed", error: e instanceof Error ? e.message : String(e) }),
        );
      }
    },
  };
}
