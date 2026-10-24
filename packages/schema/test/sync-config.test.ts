// SPDX-License-Identifier: AGPL-3.0-or-later
// The schema, the Postgres DDL and the PowerSync sync config stay in step.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { syncedTables } from "../src";
import { syncConfigYaml } from "../src/sync-config";

describe("sync config", () => {
  test("the committed sync-config.yaml matches the schema", () => {
    const committed = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "infra", "powersync", "sync-config.yaml"),
      "utf8",
    );
    expect(committed).toBe(syncConfigYaml());
  });

  test("every synced table is in a stream, filtered by the caller", () => {
    const yaml = syncConfigYaml();
    for (const t of Object.keys(syncedTables)) {
      expect(yaml).toContain(`SELECT * FROM ${t} WHERE user_id = auth.user_id()`);
    }
  });

  test("local-only tables are not streamed", () => {
    expect(syncConfigYaml()).not.toMatch(/runner_state|ui_prefs/);
  });
});
