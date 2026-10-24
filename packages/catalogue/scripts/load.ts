// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads the family YAML files and builds the catalogue.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { type BuildResult, buildCatalogue } from "../src";

export const FAMILIES_DIR = join(import.meta.dirname, "..", "src", "families");

export function loadCatalogue(dir = FAMILIES_DIR): BuildResult {
  const names = readdirSync(dir)
    .filter((n) => n.endsWith(".yaml"))
    .sort();
  const r = buildCatalogue(names.map((n) => parse(readFileSync(join(dir, n), "utf8"))));
  if (r.ok) return r;
  // Name the file for errors that only know its index.
  const errors = r.errors.map((e) => ({
    ...e,
    where: e.where.replace(/^file (\d+)/, (_m, i: string) => names[Number(i)] ?? `file ${i}`),
  }));
  return { ok: false, errors };
}
