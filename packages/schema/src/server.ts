// SPDX-License-Identifier: AGPL-3.0-or-later
// Server schema (Postgres). Synced tables come from the client schema, so the
// two dialects cannot drift: each SQLite column maps to one Postgres column.
// Server-only tables follow.

import {
  doublePrecision,
  getTableConfig as getPgConfig,
  index,
  integer,
  type PgColumnBuilderBase,
  type PgTable,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { syncedTables } from "./client";

function pgColumn(c: SQLiteColumn): PgColumnBuilderBase {
  const t = c.getSQLType();
  const base = t === "integer" ? integer(c.name) : t === "real" ? doublePrecision(c.name) : text(c.name);
  if (c.primary) return base.primaryKey();
  return c.notNull ? base.notNull() : base;
}

function toPg<T extends SQLiteTable>(t: T) {
  const cfg = getTableConfig(t);
  const columns = Object.fromEntries(cfg.columns.map((c) => [c.name, pgColumn(c)]));
  return pgTable(cfg.name, columns, (table) => [index(`${cfg.name}_user_id_idx`).on(table.user_id as never)]);
}

type Synced = typeof syncedTables;

export const pgSynced = Object.fromEntries(
  Object.entries(syncedTables).map(([name, t]) => [name, toPg(t)]),
) as { [K in keyof Synced]: ReturnType<typeof toPg<Synced[K]>> };

/** AI spend per call (SDD "Budget"). */
export const ai_usage = pgTable("ai_usage", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull(),
  task: text("task").notNull(),
  model: text("model").notNull(),
  cost_usd: doublePrecision("cost_usd").notNull(),
  tokens: integer("tokens"),
  at: timestamp("at", { withTimezone: true }).notNull(),
});

/** Coach reads and admin actions (I8). */
export const audit_log = pgTable("audit_log", {
  id: text("id").primaryKey(),
  actor_id: text("actor_id").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
});

/** A full data export behind a 24-hour capability link. */
export const exports = pgTable("exports", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull(),
  json: text("json").notNull(),
  csv: text("csv").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** AI answers that cost nothing to repeat, by a hash of the input (explain_more). */
export const ai_cache = pgTable("ai_cache", {
  id: text("id").primaryKey(),
  task: text("task").notNull(),
  output: text("output").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
});

export const serverSchema = { ...pgSynced, ai_usage, ai_cache, audit_log, exports };

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Additive DDL for one table: create it with its primary key, then add each
 * column that is missing, then the indexes. Safe to run on every start.
 */
export function ddlFor(t: PgTable): string[] {
  const cfg = getPgConfig(t);
  const pk = cfg.columns.find((c) => c.primary);
  if (!pk) throw new Error(`table ${cfg.name} has no primary key`);
  const out = [`CREATE TABLE IF NOT EXISTS ${q(cfg.name)} (${q(pk.name)} ${pk.getSQLType()} PRIMARY KEY)`];
  for (const c of cfg.columns) {
    if (c.primary) continue;
    out.push(
      `ALTER TABLE ${q(cfg.name)} ADD COLUMN IF NOT EXISTS ${q(c.name)} ${c.getSQLType()}${c.notNull ? " NOT NULL" : ""}`,
    );
  }
  for (const i of cfg.indexes) {
    const cols = i.config.columns.map((c) => q((c as { name: string }).name)).join(", ");
    out.push(`CREATE INDEX IF NOT EXISTS ${q(i.config.name ?? "")} ON ${q(cfg.name)} (${cols})`);
  }
  return out;
}
