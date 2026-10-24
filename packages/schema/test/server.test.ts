// SPDX-License-Identifier: AGPL-3.0-or-later
import { getTableConfig as pgConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, test } from "vitest";
import { syncedTables } from "../src";
import { ddlFor, pgSynced, serverSchema } from "../src/server";

describe("server schema", () => {
  test("every synced client table has a Postgres table with the same columns", () => {
    for (const [name, t] of Object.entries(syncedTables)) {
      const pg = pgSynced[name as keyof typeof pgSynced];
      const client = sqliteConfig(t)
        .columns.map((c) => c.name)
        .sort();
      expect(
        pgConfig(pg)
          .columns.map((c) => c.name)
          .sort(),
        name,
      ).toEqual(client);
    }
  });

  test("types map text → text, integer → integer, real → double precision", () => {
    const cols = pgConfig(pgSynced.sets).columns;
    const type = (n: string) => cols.find((c) => c.name === n)?.getSQLType();
    expect([type("id"), type("reps"), type("load_kg")]).toEqual(["text", "integer", "double precision"]);
  });

  test("DDL creates the table, adds every column and indexes user_id", () => {
    const sql = ddlFor(pgSynced.sets);
    expect(sql[0]).toBe('CREATE TABLE IF NOT EXISTS "sets" ("id" text PRIMARY KEY)');
    expect(sql).toContain('ALTER TABLE "sets" ADD COLUMN IF NOT EXISTS "effort" text NOT NULL');
    expect(sql).toContain('ALTER TABLE "sets" ADD COLUMN IF NOT EXISTS "load_kg" double precision');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "sets_user_id_idx" ON "sets" ("user_id")');
  });

  test("server-only tables are not synced", () => {
    expect(Object.keys(serverSchema)).toEqual(expect.arrayContaining(["ai_usage", "audit_log"]));
    expect(Object.keys(syncedTables)).not.toContain("ai_usage");
  });
});
