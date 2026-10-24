// SPDX-License-Identifier: AGPL-3.0-or-later
// V7: export, import, account deletion and the magic-link landing page.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { App } from "../src/app";
import { freshDatabase, query, request, signIn, startApp } from "./harness";

let app: App;
let a: { token: string; userId: string };
let b: { token: string; userId: string };
const now = () => new Date().toISOString();

beforeAll(async () => {
  await freshDatabase();
  app = await startApp();
  a = await signIn(app, "a@example.test");
  b = await signIn(app, "b@example.test");
  await request(app, "/sync/upload", {
    method: "POST",
    token: a.token,
    body: JSON.stringify({
      batch: [
        {
          op: "PUT",
          table: "sets",
          id: "set-a1",
          data: {
            session_id: "s1",
            exercise_id: "goblet-squat",
            reps: 10,
            load_kg: 12,
            effort: "good",
            logged_at: now(),
            created_at: now(),
            updated_at: now(),
          },
        },
      ],
    }),
  });
});

afterAll(async () => {
  await app.close();
});

const linkIn = (to: string) =>
  [...app.mailer.sent]
    .reverse()
    .find((m) => m.to === to)
    ?.text.match(/https?:\/\/\S+/)?.[0] ?? "";

describe("magic link", () => {
  test("the mail links to the app landing page, and the page opens the app with the token", async () => {
    await request(app, "/api/auth/sign-in/magic-link", {
      method: "POST",
      body: JSON.stringify({ email: "land@example.test", callbackURL: "/" }),
    });
    const url = new URL(linkIn("land@example.test"));
    expect(url.pathname).toBe("/app/auth/magic");
    const token = url.searchParams.get("token");
    expect(token).toBeTruthy();
    const page = await request(app, url.pathname + url.search);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain(`app.vee.mobile://auth/magic?token=${token}`);
  });

  test("in memory-mail mode, the test route returns the latest link token", async () => {
    const r = await request(app, "/dev/mail/latest?to=land%40example.test");
    const body = (await r.json()) as { token: string };
    expect(body.token).toBe(new URL(linkIn("land@example.test")).searchParams.get("token") ?? "");
  });

  test("the test route does not exist with SMTP mail", async () => {
    const smtp = await startApp({ MAIL_TRANSPORT: "smtp", SMTP_URL: "smtp://localhost:2525" });
    expect((await request(smtp, "/dev/mail/latest?to=x")).status).toBe(404);
    await smtp.close();
  });
});

describe("export", () => {
  test("POST /export mails a link; the link returns JSON with the user's rows only", async () => {
    const r = await request(app, "/export", { method: "POST", token: a.token });
    expect(r.status).toBe(202);
    const link = new URL(linkIn("a@example.test"));
    expect(link.pathname).toMatch(/^\/export\/[0-9a-f]{64}$/);
    const json = (await (await request(app, link.pathname)).json()) as {
      userId: string;
      tables: Record<string, { id: string; user_id: string }[]>;
    };
    expect(json.userId).toBe(a.userId);
    expect(json.tables.sets?.map((s) => s.id)).toEqual(["set-a1"]);
    expect(
      Object.values(json.tables)
        .flat()
        .every((row) => row.user_id === a.userId),
    ).toBe(true);
  });

  test("the CSV of sets has a header and one row per set", async () => {
    const link = new URL(linkIn("a@example.test"));
    const csv = await (await request(app, `${link.pathname}/sets.csv`)).text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("logged_at,session_id,exercise_id,side,reps,seconds,load_kg,effort");
    expect(lines).toHaveLength(2);
  });

  test("an unknown or expired export id is 404", async () => {
    expect((await request(app, `/export/${"0".repeat(64)}`)).status).toBe(404);
    const link = new URL(linkIn("a@example.test"));
    await query("UPDATE exports SET expires_at = now() - interval '1 minute'");
    expect((await request(app, link.pathname)).status).toBe(404);
  });

  test("export needs a session", async () => {
    expect((await request(app, "/export", { method: "POST" })).status).toBe(401);
  });
});

describe("import", () => {
  const STRONG =
    "Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE\n2026-10-12 18:05:00;Evening;45m;Pull Up;1;0;5;0;0;;;\n2026-10-12 18:05:00;Evening;45m;Pull Up;2;0;4;0;0;;;\n";

  test("POST /import/strong writes sessions and sets for the caller", async () => {
    const r = await request(app, "/import/strong", {
      method: "POST",
      token: b.token,
      headers: { "content-type": "text/csv" },
      body: STRONG,
    });
    expect(await r.json()).toEqual({ sessions: 1, sets: 2, customExercises: 0 });
    const rows = await query<{ user_id: string; exercise_id: string }>(
      "SELECT user_id, exercise_id FROM sets WHERE user_id = $1",
      [b.userId],
    );
    expect(rows.map((x) => x.exercise_id)).toEqual(["pullup-strict", "pullup-strict"]);
    const sessions = await query<{ status: string; date: string }>(
      "SELECT status, date FROM sessions WHERE user_id = $1",
      [b.userId],
    );
    expect(sessions).toEqual([{ status: "done", date: "2026-10-12" }]);
  });

  test("a format that does not match the file is 400", async () => {
    const r = await request(app, "/import/hevy", {
      method: "POST",
      token: b.token,
      headers: { "content-type": "text/csv" },
      body: STRONG,
    });
    expect(r.status).toBe(400);
  });
});

describe("DELETE /account", () => {
  test("a session older than 10 minutes must sign in again first", async () => {
    await query(`UPDATE "session" SET "createdAt" = now() - interval '11 minutes' WHERE "userId" = $1`, [
      b.userId,
    ]);
    const r = await request(app, "/account", { method: "DELETE", token: b.token });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "reauth-required" });
  });

  test("a fresh session deletes the user and every row; other users keep theirs", async () => {
    const c = await signIn(app, "c@example.test");
    await request(app, "/sync/upload", {
      method: "POST",
      token: c.token,
      body: JSON.stringify({
        batch: [
          {
            op: "PUT",
            table: "kit_items",
            id: "kit-c",
            data: { kind: "band", created_at: now(), updated_at: now() },
          },
        ],
      }),
    });
    const r = await request(app, "/account", { method: "DELETE", token: c.token });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ deleted: true });
    expect(await query("SELECT id FROM kit_items WHERE user_id = $1", [c.userId])).toEqual([]);
    expect(await query(`SELECT id FROM "user" WHERE id = $1`, [c.userId])).toEqual([]);
    expect(await query("SELECT id FROM entitlements WHERE user_id = $1", [c.userId])).toEqual([]);
    expect(await query("SELECT id FROM sets WHERE user_id = $1", [a.userId])).toHaveLength(1);
    const audit = await query<{ action: string }>("SELECT action FROM audit_log WHERE target = $1", [
      c.userId,
    ]);
    expect(audit.map((x) => x.action)).toEqual(["account.delete"]);
    expect((await request(app, "/auth/powersync-token", { token: c.token })).status).toBe(401);
  });
});
