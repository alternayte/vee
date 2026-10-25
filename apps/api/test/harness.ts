// SPDX-License-Identifier: AGPL-3.0-or-later
// Test harness: the real app on a fresh Postgres schema, mail kept in memory.
import pg from "pg";
import { type App, createApp } from "../src/app";
import { readEnv } from "../src/env";

export const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:vee@localhost:54391/postgres";

export const OWNER_EMAIL = "owner@example.test";

export async function freshDatabase(): Promise<void> {
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();
  await c.query("DROP PUBLICATION IF EXISTS powersync");
  await c.query("DROP SCHEMA IF EXISTS public CASCADE");
  await c.query("CREATE SCHEMA public");
  await c.end();
}

export async function startApp(
  over: Record<string, string> = {},
  deps: Parameters<typeof createApp>[1] = {},
): Promise<App> {
  const env = readEnv({
    DATABASE_URL,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
    BASE_URL: "http://localhost:3999",
    PASSKEY_RP_ID: "localhost",
    OWNER_EMAIL,
    MAIL_TRANSPORT: "memory",
    ANDROID_CERT_SHA256: "AA:BB:CC",
    ...over,
  });
  const app = createApp(env, deps);
  await app.migrate();
  return app;
}

export function request(app: App, path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(new Request(`http://localhost:3999${path}`, { ...init, headers }));
}

/** The verify call the app makes with the token from the newest sign-in mail. */
export function verifyPath(app: App, email: string): string {
  const mail = [...app.mailer.sent].reverse().find((m) => m.to === email);
  const token = mail?.text.match(/token=([^\s&]+)/)?.[1];
  if (!token) throw new Error("no magic link in the mail");
  return `/api/auth/magic-link/verify?token=${token}&callbackURL=%2F`;
}

/** Signs in through the magic link flow and returns the bearer session token. */
export async function signIn(app: App, email: string): Promise<{ token: string; userId: string }> {
  const sent = await request(app, "/api/auth/sign-in/magic-link", {
    method: "POST",
    body: JSON.stringify({ email, callbackURL: "/" }),
  });
  if (sent.status !== 200) throw new Error(`magic link request failed: ${sent.status} ${await sent.text()}`);
  const verify = await request(app, verifyPath(app, email), { redirect: "manual" });
  const token = verify.headers.get("set-auth-token");
  if (!token) throw new Error(`no session token: ${verify.status}`);
  const session = await request(app, "/api/auth/get-session", { token });
  const body = (await session.json()) as { user: { id: string } };
  return { token, userId: body.user.id };
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}
