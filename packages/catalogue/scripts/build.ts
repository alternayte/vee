// SPDX-License-Identifier: AGPL-3.0-or-later
// Validates the family YAML and writes dist/catalogue.v{N}.json.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOGUE_VERSION } from "../src";
import { loadCatalogue } from "./load";

const r = loadCatalogue();
if (!r.ok) {
  for (const e of r.errors) console.error(`catalogue: ${e.where}: ${e.code}: ${e.message}`);
  process.exit(1);
}

const body = JSON.stringify(r.catalogue);
const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
const out = join(import.meta.dirname, "..", "dist");
mkdirSync(out, { recursive: true });
const path = join(out, `catalogue.v${CATALOGUE_VERSION}.json`);
writeFileSync(path, `${JSON.stringify({ ...r.catalogue, hash }, null, 1)}\n`);
console.log(
  `catalogue: ${r.catalogue.families.length} families, ${r.catalogue.exercises.length} exercises, hash ${hash} → ${path}`,
);
