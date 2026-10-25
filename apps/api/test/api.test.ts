// SPDX-License-Identifier: AGPL-3.0-or-later
// V7: API against Postgres. Authz: every write as another user is refused.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import type { App } from "../src/app";
import { freshDatabase, OWNER_EMAIL, query, request, signIn, startApp, verifyPath } from "./harness";

let app: App;
let a: { token: string; userId: string };
let b: { token: string; userId: string };
const now = () => new Date().toISOString();

beforeAll(async () => {
  await freshDatabase();
  app = await startApp();
  a = await signIn(app, OWNER_EMAIL);
  b = await signIn(app, "other@example.test");
});

afterAll(async () => {
  await app.close();
});

const upload = (token: string | undefined, batch: unknown[]) =>
  request(app, "/sync/upload", {
    method: "POST",
    body: JSON.stringify({ batch }),
    ...(token ? { token } : {}),
  });

const kit = (id: string, extra: Record<string, unknown> = {}) => ({
  op: "PUT",
  table: "kit_items",
  id,
  data: {
    kind: "dial_db",
    params: '{"min":2,"max":24,"step":2}',
    count: 1,
    created_at: now(),
    updated_at: now(),
    ...extra,
  },
});

describe("public routes", () => {
  test("health checks the database", async () => {
    const r = await request(app, "/health");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, db: true });
  });

  test("assetlinks names the app and its signing keys", async () => {
    const r = await request(app, "/.well-known/assetlinks.json");
    expect(await r.json()).toEqual([
      {
        relation: [
          "delegate_permission/common.handle_all_urls",
          "delegate_permission/common.get_login_creds",
        ],
        target: {
          namespace: "android_app",
          package_name: "app.vee.mobile",
          sha256_cert_fingerprints: ["AA:BB:CC"],
        },
      },
    ]);
  });
});

describe("auth", () => {
  test("no session: 401 on private routes", async () => {
    expect((await upload(undefined, [])).status).toBe(401);
    expect((await request(app, "/auth/powersync-token")).status).toBe(401);
    expect((await upload("not-a-token", [])).status).toBe(401);
  });

  test("a magic link works once", async () => {
    await request(app, "/api/auth/sign-in/magic-link", {
      method: "POST",
      body: JSON.stringify({ email: "once@example.test", callbackURL: "/" }),
    });
    const path = verifyPath(app, "once@example.test");
    const first = await request(app, path, { redirect: "manual" });
    expect(first.headers.get("set-auth-token")).toBeTruthy();
    const second = await request(app, path, { redirect: "manual" });
    expect(second.headers.get("set-auth-token")).toBeNull();
  });

  test("the owner email gets the owner tier; others get plus", async () => {
    const rows = await query<{ user_id: string; tier: string }>("SELECT user_id, tier FROM entitlements");
    expect(rows.find((r) => r.user_id === a.userId)?.tier).toBe("owner");
    expect(rows.find((r) => r.user_id === b.userId)?.tier).toBe("plus");
  });

  test("the PowerSync token is a 15-minute JWT for the user, signed with the JWKS", async () => {
    const r = await request(app, "/auth/powersync-token", { token: a.token });
    expect(r.status).toBe(200);
    const { token } = (await r.json()) as { token: string };
    const jwks = (await (await request(app, "/api/auth/jwks")).json()) as Parameters<
      typeof createLocalJWKSet
    >[0];
    const { payload, protectedHeader } = await jwtVerify(token, createLocalJWKSet(jwks), {
      audience: "powersync",
      issuer: "http://localhost:3999",
    });
    expect(payload.sub).toBe(a.userId);
    expect(protectedHeader.alg).toBe("RS256");
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);
  });
});

describe("POST /sync/upload", () => {
  test("PUT stores the row with the caller as owner", async () => {
    const r = await upload(a.token, [kit("k-a1")]);
    expect(await r.json()).toEqual({ applied: 1, rejected: [] });
    const rows = await query("SELECT user_id, kind, count FROM kit_items WHERE id = 'k-a1'");
    expect(rows).toEqual([{ user_id: a.userId, kind: "dial_db", count: 1 }]);
  });

  test("the PowerSync JWT is accepted too", async () => {
    const { token } = (await (await request(app, "/auth/powersync-token", { token: a.token })).json()) as {
      token: string;
    };
    expect(decodeJwt(token).sub).toBe(a.userId);
    expect(await (await upload(token, [kit("k-a-jwt")])).json()).toEqual({ applied: 1, rejected: [] });
  });

  test("another user cannot PATCH, PUT over or DELETE the row", async () => {
    const r = await upload(b.token, [
      { op: "PATCH", table: "kit_items", id: "k-a1", data: { count: 9 } },
      kit("k-a1"),
      { op: "DELETE", table: "kit_items", id: "k-a1" },
    ]);
    const body = (await r.json()) as { applied: number; rejected: { index: number; code: string }[] };
    expect(body.applied).toBe(0);
    expect(body.rejected.map((x) => [x.index, x.code])).toEqual([
      [0, "forbidden"],
      [1, "forbidden"],
      [2, "forbidden"],
    ]);
    expect(await query("SELECT user_id, count FROM kit_items WHERE id = 'k-a1'")).toEqual([
      { user_id: a.userId, count: 1 },
    ]);
  });

  test("a row cannot name another user as owner", async () => {
    const body = (await (await upload(a.token, [kit("k-a2", { user_id: b.userId })])).json()) as {
      rejected: { code: string }[];
    };
    expect(body.rejected.map((x) => x.code)).toEqual(["forbidden-owner"]);
  });

  test("unknown and read-only tables are refused", async () => {
    const body = (await (
      await upload(a.token, [
        { op: "PUT", table: "users", id: "x", data: {} },
        {
          op: "PUT",
          table: "entitlements",
          id: "x",
          data: { tier: "owner", created_at: now(), updated_at: now() },
        },
        {
          op: "PUT",
          table: "reviews",
          id: "x",
          data: { week: "2026-W45", created_at: now(), updated_at: now() },
        },
      ])
    ).json()) as { rejected: { code: string }[] };
    expect(body.rejected.map((x) => x.code)).toEqual(["unknown-table", "read-only", "read-only"]);
  });

  test("a value of the wrong type or a missing required column is invalid", async () => {
    const body = (await (
      await upload(a.token, [
        kit("k-bad", { count: "two" }),
        { op: "PUT", table: "kit_items", id: "k-bad2", data: {} },
      ])
    ).json()) as { rejected: { code: string }[] };
    expect(body.rejected.map((x) => x.code)).toEqual(["invalid", "invalid"]);
  });

  test("unknown columns are invalid", async () => {
    const body = (await (await upload(a.token, [kit("k-bad3", { colour: "red" })])).json()) as {
      rejected: { code: string }[];
    };
    expect(body.rejected.map((x) => x.code)).toEqual(["invalid"]);
  });

  test("valid ops apply even when others in the batch are refused", async () => {
    const r = await upload(a.token, [kit("k-a3"), { op: "PUT", table: "nope", id: "x", data: {} }]);
    expect(await r.json()).toMatchObject({ applied: 1, rejected: [{ index: 1, code: "unknown-table" }] });
    expect(await query("SELECT id FROM kit_items WHERE id = 'k-a3'")).toHaveLength(1);
  });

  test("PATCH changes only the given columns (field-level merge)", async () => {
    await upload(a.token, [kit("k-merge")]);
    await upload(a.token, [{ op: "PATCH", table: "kit_items", id: "k-merge", data: { count: 2 } }]);
    await upload(a.token, [
      { op: "PATCH", table: "kit_items", id: "k-merge", data: { params: '{"min":4}' } },
    ]);
    expect(await query("SELECT count, params, kind FROM kit_items WHERE id = 'k-merge'")).toEqual([
      { count: 2, params: '{"min":4}', kind: "dial_db" },
    ]);
  });

  test("PATCH on a missing row is not-found", async () => {
    const body = (await (
      await upload(a.token, [{ op: "PATCH", table: "kit_items", id: "missing", data: { count: 1 } }])
    ).json()) as { rejected: { code: string }[] };
    expect(body.rejected.map((x) => x.code)).toEqual(["not-found"]);
  });

  test("the owner can DELETE", async () => {
    await upload(a.token, [kit("k-del")]);
    expect(await (await upload(a.token, [{ op: "DELETE", table: "kit_items", id: "k-del" }])).json()).toEqual(
      {
        applied: 1,
        rejected: [],
      },
    );
    expect(await query("SELECT id FROM kit_items WHERE id = 'k-del'")).toHaveLength(0);
  });

  test("a malformed body is 400", async () => {
    const r = await request(app, "/sync/upload", { method: "POST", body: "{nope", token: a.token });
    expect(r.status).toBe(400);
  });
});

describe("migrations", () => {
  test("two API starts at the same time both migrate without error", async () => {
    const [x, y] = await Promise.all([startApp(), startApp()]);
    await Promise.all([x.close(), y.close()]);
  });
});

test("an empty variable from compose counts as not set", async () => {
  const { readEnv } = await import("../src/env");
  const env = readEnv({
    DATABASE_URL: "postgres://x@localhost/x",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BASE_URL: "https://vee.example.test",
    PASSKEY_RP_ID: "vee.example.test",
    MAIL_TRANSPORT: "memory",
    COACH_URL: "",
    OPENROUTER_API_KEY: "",
  });
  expect(env.COACH_URL).toBeUndefined();
  expect(env.OPENROUTER_API_KEY).toBeUndefined();
});
