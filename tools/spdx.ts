// SPDX-License-Identifier: AGPL-3.0-or-later
// Licence header check (gate V14). Every source file carries the AGPL SPDX
// header in its first 5 lines.
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { listFiles } from "./git";

const HEADER = "SPDX-License-Identifier: AGPL-3.0-or-later";

const HEADER_RE = /SPDX-License-Identifier: AGPL-3\.0-or-later(?![\w.+-])/;

const SOURCE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".kt",
  ".kts",
  ".swift",
  ".sh",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".sql",
]);

const SOURCE_NAMES = new Set(["justfile", "Dockerfile"]);

export function needsHeader(path: string): boolean {
  if (path.startsWith(".githooks/")) return true;
  return SOURCE_EXT.has(extname(path)) || SOURCE_NAMES.has(basename(path));
}

export function hasHeader(content: string): boolean {
  return content.split("\n", 5).some((l) => HEADER_RE.test(l));
}

function main(): number {
  const missing = listFiles()
    .filter(needsHeader)
    .filter((p) => !hasHeader(readFileSync(p, "utf8")));
  for (const p of missing) console.error(`spdx: ${p}: missing "${HEADER}"`);
  if (missing.length > 0) return 1;
  console.log("spdx: all source files have the header");
  return 0;
}

if (import.meta.main) process.exit(main());
