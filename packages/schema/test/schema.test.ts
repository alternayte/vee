// SPDX-License-Identifier: AGPL-3.0-or-later
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, test } from "vitest";
import { clientSchema, localTables, syncedTables, uuidv7 } from "../src";

const tables = Object.entries(clientSchema) as [string, SQLiteTable][];

describe("client schema", () => {
  test.each(tables)("%s uses only text, integer and real columns (PowerSync)", (_name, t) => {
    const types = getTableConfig(t).columns.map((c) => c.getSQLType());
    expect(types.filter((x) => !["text", "integer", "real"].includes(x))).toEqual([]);
  });

  test.each(tables)("%s has no foreign-key, unique or check constraints", (_name, t) => {
    const c = getTableConfig(t);
    expect([c.foreignKeys.length, c.uniqueConstraints.length, c.checks.length]).toEqual([0, 0, 0]);
    expect(c.columns.filter((x) => x.isUnique).map((x) => x.name)).toEqual([]);
  });

  test.each(tables)("%s has a text id primary key", (_name, t) => {
    const id = getTableConfig(t).columns.find((c) => c.name === "id");
    expect(id?.primary).toBe(true);
    expect(id?.getSQLType()).toBe("text");
  });

  test.each(Object.entries(syncedTables) as [string, SQLiteTable][])(
    "synced %s has the common columns",
    (_n, t) => {
      const names = getTableConfig(t).columns.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(["user_id", "created_at", "updated_at", "deleted_at"]));
    },
  );

  test("the table key matches the SQL table name", () => {
    for (const [key, t] of tables) expect(getTableConfig(t).name).toBe(key);
  });

  test("local-only tables are runner_state and ui_prefs", () => {
    expect(Object.keys(localTables).sort()).toEqual(["runner_state", "ui_prefs"]);
  });
});

describe("uuidv7", () => {
  const zeros = (b: Uint8Array<ArrayBuffer>) => b.fill(0);

  test("has version 7 and variant 10", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("starts with the 48-bit millisecond time", () => {
    expect(uuidv7(0x0123456789ab, zeros)).toBe("01234567-89ab-7000-8000-000000000000");
  });

  test("ids made later sort later", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
  });
});
