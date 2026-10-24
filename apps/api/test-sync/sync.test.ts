// SPDX-License-Identifier: AGPL-3.0-or-later
// V8: sync against the real PowerSync service and Postgres (infra/compose.test.yaml).
// Two simulated devices for one user, one device for another user.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { DrizzleAppSchema, wrapPowerSyncWithDrizzle } from "@powersync/drizzle-driver";
import { PowerSyncDatabase } from "@powersync/node";
import {
  clientSchema,
  kit_items,
  runner_state,
  sessions as sessionsTable,
  sets,
  syncedTables,
  ui_prefs,
  uuidv7,
} from "@vee/schema";
import { createConnector, type Rejected } from "@vee/sync";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type App, createApp } from "../src/app";
import { readEnv } from "../src/env";

const API_PORT = 3998;
const API_URL = `http://localhost:${API_PORT}`;
const POWERSYNC_URL = "http://localhost:8089";
const DATABASE_URL = "postgres://postgres:vee@localhost:54392/vee";

const appSchema = new DrizzleAppSchema({
  ...syncedTables,
  runner_state: { tableDefinition: runner_state, options: { localOnly: true } },
  ui_prefs: { tableDefinition: ui_prefs, options: { localOnly: true } },
});

let app: App;
let server: ReturnType<typeof serve>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), "vee-sync-"));
const now = () => new Date().toISOString();

async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 30_000): Promise<T> {
  const until = Date.now() + ms;
  let last: unknown;
  while (Date.now() < until) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}

async function signIn(email: string): Promise<string> {
  await app.fetch(
    new Request(`${API_URL}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/" }),
    }),
  );
  const token0 = app.mailer.sent.at(-1)?.text.match(/token=([^\s&]+)/)?.[1] ?? "";
  const r = await app.fetch(
    new Request(`${API_URL}/api/auth/magic-link/verify?token=${token0}&callbackURL=%2F`, {
      redirect: "manual",
    }),
  );
  const token = r.headers.get("set-auth-token");
  if (!token) throw new Error("no session token");
  return token;
}

type Device = {
  ps: InstanceType<typeof PowerSyncDatabase>;
  db: ReturnType<typeof wrapPowerSyncWithDrizzle<typeof clientSchema>>;
  rejected: Rejected[];
  connect(): Promise<void>;
};

function device(name: string, session: string): Device {
  const ps = new PowerSyncDatabase({
    schema: appSchema,
    database: { dbFilename: `${name}.sqlite`, dbLocation: dir, implementation: { type: "node:sqlite" } },
  });
  const rejected: Rejected[] = [];
  const connector = createConnector({
    apiUrl: API_URL,
    powersyncUrl: POWERSYNC_URL,
    sessionToken: async () => session,
    onRejected: (r) => {
      rejected.push(...r);
    },
  });
  return {
    ps,
    db: wrapPowerSyncWithDrizzle(ps, { schema: clientSchema }),
    rejected,
    connect: () => ps.connect(connector),
  };
}

async function pgQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

let a1: Device;
let a2: Device;
let b1: Device;

beforeAll(async () => {
  app = createApp(
    readEnv({
      DATABASE_URL,
      BETTER_AUTH_SECRET: "sync-test-secret-sync-test-secret-0123",
      BASE_URL: API_URL,
      PASSKEY_RP_ID: "localhost",
      MAIL_TRANSPORT: "memory",
    }),
  );
  await app.migrate();
  server = serve({ port: API_PORT, fetch: app.fetch });
  await waitFor(
    "powersync liveness",
    async () => (await fetch(`${POWERSYNC_URL}/probes/liveness`)).ok,
    60_000,
  );
  const a = await signIn("a@example.test");
  const b = await signIn("b@example.test");
  a1 = device("a1", a);
  a2 = device("a2", a);
  b1 = device("b1", b);
  await Promise.all([a1.connect(), a2.connect(), b1.connect()]);
  await waitFor(
    "first sync",
    async () => a1.ps.currentStatus.hasSynced && a2.ps.currentStatus.hasSynced,
    60_000,
  );
}, 120_000);

afterAll(async () => {
  await Promise.all([a1?.ps.close(), a2?.ps.close(), b1?.ps.close()]);
  await new Promise((r) => server?.close(r));
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

const kitRow = (id: string) => ({
  id,
  kind: "dial_db",
  params: '{"min":2,"max":24,"step":2}',
  count: 1,
  created_at: now(),
  updated_at: now(),
});

describe("V8 sync", () => {
  test("each user gets an entitlement row by sync", async () => {
    const rows = await waitFor("entitlement on a1", async () => {
      const r = await a1.ps.getAll<{ tier: string }>("SELECT tier FROM entitlements");
      return r.length > 0 ? r : undefined;
    });
    expect(rows[0]?.tier).toBe("plus");
  });

  test("a row written on one device reaches the other device", async () => {
    const id = uuidv7();
    await a1.db.insert(kit_items).values(kitRow(id));
    const seen = await waitFor(
      "row on a2",
      async () => (await a2.db.select().from(kit_items).where(eq(kit_items.id, id)))[0],
    );
    expect(seen.kind).toBe("dial_db");
    expect((await pgQuery("SELECT user_id FROM kit_items WHERE id = $1", [id]))[0]).toBeTruthy();
  });

  test("two devices edit different fields of one row and both edits survive", async () => {
    const id = uuidv7();
    await a1.db.insert(kit_items).values(kitRow(id));
    await waitFor(
      "row on a2",
      async () => (await a2.db.select().from(kit_items).where(eq(kit_items.id, id)))[0],
    );
    await Promise.all([
      a1.db.update(kit_items).set({ count: 2 }).where(eq(kit_items.id, id)),
      a2.db.update(kit_items).set({ params: '{"min":4,"max":24,"step":2}' }).where(eq(kit_items.id, id)),
    ]);
    const merged = (d: Device) =>
      waitFor(`merge on ${d === a1 ? "a1" : "a2"}`, async () => {
        const r = (await d.db.select().from(kit_items).where(eq(kit_items.id, id)))[0];
        return r?.count === 2 && r.params === '{"min":4,"max":24,"step":2}' ? r : undefined;
      });
    await Promise.all([merged(a1), merged(a2)]);
    expect(await pgQuery("SELECT count, params FROM kit_items WHERE id = $1", [id])).toEqual([
      { count: 2, params: '{"min":4,"max":24,"step":2}' },
    ]);
  });

  test("a device offline for 7 days uploads its rows when it connects", async () => {
    await a2.ps.disconnect();
    const session = uuidv7();
    const days = [0, 2, 4, 7];
    for (const d of days) {
      const at = new Date(Date.now() - (7 - d) * 86_400_000).toISOString();
      await a2.db.insert(sets).values({
        id: uuidv7(),
        session_id: session,
        exercise_id: "goblet-squat",
        reps: 10,
        effort: "good",
        logged_at: at,
        created_at: at,
        updated_at: at,
      });
    }
    await sleep(1000);
    expect(await pgQuery("SELECT id FROM sets WHERE session_id = $1", [session])).toHaveLength(0);
    await a2.connect();
    await waitFor("offline rows on the server", async () => {
      const r = await pgQuery("SELECT id FROM sets WHERE session_id = $1", [session]);
      return r.length === days.length ? r : undefined;
    });
    await waitFor("offline rows on a1", async () => {
      const r = await a1.db.select().from(sets).where(eq(sets.session_id, session));
      return r.length === days.length ? r : undefined;
    });
  });

  test("another user never receives the rows", async () => {
    const id = uuidv7();
    await a1.db.insert(kit_items).values(kitRow(id));
    await waitFor(
      "row on the server",
      async () => (await pgQuery("SELECT id FROM kit_items WHERE id = $1", [id]))[0],
    );
    const mine = uuidv7();
    await b1.db.insert(kit_items).values(kitRow(mine));
    await waitFor(
      "b1 row on the server",
      async () => (await pgQuery("SELECT id FROM kit_items WHERE id = $1", [mine]))[0],
    );
    await sleep(2000);
    const onB = await b1.ps.getAll<{ id: string }>("SELECT id FROM kit_items");
    expect(onB.map((r) => r.id)).toEqual([mine]);
    const onA = await a1.ps.getAll<{ id: string }>("SELECT id FROM kit_items WHERE id = ?", [mine]);
    expect(onA).toEqual([]);
  });

  test("6 months of history written with no account uploads after sign-in (I10)", async () => {
    const solo = device("solo", "");
    const sessionsMade: string[] = [];
    let setCount = 0;
    const start = Date.now() - 182 * 86_400_000;
    for (let week = 0; week < 26; week++) {
      for (const day of [0, 2, 4, 5]) {
        const at = new Date(start + (week * 7 + day) * 86_400_000).toISOString();
        const sid = uuidv7();
        sessionsMade.push(sid);
        await solo.db.transaction(async (tx) => {
          await tx.insert(sessionsTable).values({
            id: sid,
            kind: "main",
            status: "done",
            date: at.slice(0, 10),
            created_at: at,
            updated_at: at,
          });
          for (let s = 0; s < 12; s++) {
            await tx.insert(sets).values({
              id: uuidv7(),
              session_id: sid,
              exercise_id: s % 2 ? "goblet-squat" : "row-single-arm-db",
              reps: 8 + (s % 5),
              load_kg: 10 + (week % 6) * 2,
              effort: "good",
              logged_at: at,
              created_at: at,
              updated_at: at,
            });
            setCount++;
          }
        });
      }
    }
    const pending = await solo.ps.getAll<{ n: number }>("SELECT count(*) AS n FROM ps_crud");
    expect(pending[0]?.n).toBe(sessionsMade.length + setCount);

    const token = await signIn("solo@example.test");
    const signedIn = device("solo", token);
    await solo.ps.close();
    await signedIn.connect();
    const userId = await waitFor("solo user id", async () => {
      const r = await pgQuery<{ id: string }>(`SELECT id FROM "user" WHERE email = 'solo@example.test'`);
      return r[0]?.id;
    });
    await waitFor(
      "all history on the server",
      async () => {
        const r = await pgQuery<{ n: string }>("SELECT count(*) AS n FROM sets WHERE user_id = $1", [userId]);
        return Number(r[0]?.n) === setCount;
      },
      120_000,
    );
    await waitFor("rows synced back with the owner set", async () => {
      const r = await signedIn.ps.getAll<{ n: number }>("SELECT count(*) AS n FROM sets WHERE user_id = ?", [
        userId,
      ]);
      return r[0]?.n === setCount;
    });
    expect(signedIn.rejected).toEqual([]);
    await signedIn.ps.close();
  }, 180_000);

  test("local-only tables never upload", async () => {
    await a1.db.insert(ui_prefs).values({ id: uuidv7(), key: "theme", value: "dark" });
    await sleep(1000);
    const tables = await pgQuery<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_name IN ('ui_prefs', 'runner_state')",
    );
    expect(tables).toEqual([]);
    expect(a1.rejected).toEqual([]);
  });
});
