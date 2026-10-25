// SPDX-License-Identifier: AGPL-3.0-or-later
// A Drizzle query runs only when it is awaited: `void db.update(...)`, or an
// arrow function that returns the query to a `void` caller, writes nothing.
// This check refuses both forms in the app (it broke revoke, reject, clear
// chat and dismiss in B21).
import { readFileSync } from "node:fs";
import { listFiles } from "./git";

const PATTERNS = [
  /\bvoid\s+(?:db|tx)\s*\.\s*(?:update|insert|delete)\b/g,
  /=>\s*\(?\s*(?:db|tx)\s*\.\s*(?:update|insert|delete)\b/g,
];

/** The 1-based lines in `text` with a write that nothing awaits. */
export function unawaitedWrites(text: string): number[] {
  const lines: number[] = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) lines.push(text.slice(0, m.index).split("\n").length);
  }
  return lines.sort((a, b) => a - b);
}

if (import.meta.main) {
  const bad = listFiles()
    .filter((p) => p.startsWith("apps/mobile/") && /\.(ts|tsx)$/.test(p))
    .flatMap((p) => unawaitedWrites(readFileSync(p, "utf8")).map((l) => `${p}:${l}`));
  if (bad.length) {
    console.error(`drizzle-await: a write that nothing awaits runs never:\n  ${bad.join("\n  ")}`);
    process.exit(1);
  }
  console.log("drizzle-await: every app write is awaited");
}
