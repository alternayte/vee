// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes infra/powersync/sync-config.yaml from the schema.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncConfigYaml } from "../src/sync-config";

writeFileSync(
  join(import.meta.dirname, "..", "..", "..", "infra", "powersync", "sync-config.yaml"),
  syncConfigYaml(),
);
