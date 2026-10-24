// SPDX-License-Identifier: AGPL-3.0-or-later
// The local database: PowerSync (SQLite) with Drizzle on top. It opens with no
// server connection, so every feature works offline and without an account (I10).
import { DrizzleAppSchema, wrapPowerSyncWithDrizzle } from "@powersync/drizzle-driver";
import { PowerSyncDatabase } from "@powersync/react-native";
import { clientSchema, runner_state, syncedTables, ui_prefs } from "@vee/schema";

export const appSchema = new DrizzleAppSchema({
  ...syncedTables,
  runner_state: { tableDefinition: runner_state, options: { localOnly: true } },
  ui_prefs: { tableDefinition: ui_prefs, options: { localOnly: true } },
});

export const powersync = new PowerSyncDatabase({
  schema: appSchema,
  database: { dbFilename: "vee.sqlite" },
});

export const db = wrapPowerSyncWithDrizzle(powersync, { schema: clientSchema });

export type Db = typeof db;
