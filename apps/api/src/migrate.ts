// SPDX-License-Identifier: AGPL-3.0-or-later
// Migrations run on API start, inside a lock (SDD "Migrations"). App tables
// come from the shared schema as additive DDL; Better Auth runs its own.
import { ddlFor, pgSynced, serverSchema } from "@vee/schema/server";
import { getMigrations } from "better-auth/db/migration";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import type pg from "pg";
import type { Auth } from "./auth";

/** Any constant; every API process takes the same lock. */
const MIGRATION_LOCK = 704_212_345;
export const PUBLICATION = "powersync";
/** PowerSync's bucket storage database (PS_STORAGE_URI). The API makes it, so no init script is needed. */
export const POWERSYNC_STORAGE_DB = "powersync_storage";

export async function migrate(pool: pg.Pool, auth: Auth): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    const storage = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      POWERSYNC_STORAGE_DB,
    ]);
    if (storage.rowCount === 0) await client.query(`CREATE DATABASE "${POWERSYNC_STORAGE_DB}"`);
    for (const t of Object.values(serverSchema) as PgTable[]) {
      for (const sql of ddlFor(t)) await client.query(sql);
    }
    await ensurePublication(client);
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

/** The publication PowerSync replicates: every synced table, and nothing else. */
async function ensurePublication(client: pg.PoolClient): Promise<void> {
  const names = Object.values(pgSynced).map((t) => getTableConfig(t as PgTable).name);
  const exists = await client.query("SELECT 1 FROM pg_publication WHERE pubname = $1", [PUBLICATION]);
  if (exists.rowCount === 0) {
    await client.query(
      `CREATE PUBLICATION ${PUBLICATION} FOR TABLE ${names.map((n) => `"${n}"`).join(", ")}`,
    );
    return;
  }
  const have = await client.query("SELECT tablename FROM pg_publication_tables WHERE pubname = $1", [
    PUBLICATION,
  ]);
  const present = new Set(have.rows.map((r: { tablename: string }) => r.tablename));
  for (const n of names.filter((x) => !present.has(x))) {
    await client.query(`ALTER PUBLICATION ${PUBLICATION} ADD TABLE "${n}"`);
  }
}
