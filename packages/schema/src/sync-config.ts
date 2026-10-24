// SPDX-License-Identifier: AGPL-3.0-or-later
// PowerSync sync streams (SDD "Read path"). Generated from the client schema,
// so a new synced table reaches the client and the server in one commit.
import { syncedTables } from "./client";

/** Every user streams their own rows. Entitlements stream on their own and are read-only. */
export function syncConfigYaml(): string {
  const own = Object.keys(syncedTables).filter((t) => t !== "entitlements");
  const q = (t: string) => `      - SELECT * FROM ${t} WHERE user_id = auth.user_id()`;
  return [
    "# SPDX-License-Identifier: AGPL-3.0-or-later",
    "# Generated from packages/schema by `bun run sync-config`. Do not edit.",
    "config:",
    "  edition: 3",
    "streams:",
    "  own:",
    "    auto_subscribe: true",
    "    queries:",
    ...own.map(q),
    "  entitlements:",
    "    auto_subscribe: true",
    "    queries:",
    q("entitlements"),
    "",
  ].join("\n");
}
