// SPDX-License-Identifier: AGPL-3.0-or-later
// Leak guard (invariant I9). Stops private docs, secrets and real-person data
// from entering the public repo.
//
//   bun tools/leak-guard.ts            scan all tracked and untracked files (CI)
//   bun tools/leak-guard.ts --staged   scan the staged versions (pre-commit)
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { listFiles, readStaged, stagedFiles } from "./git";

export type Rule = "private-path" | "private-name" | "private-marker" | "secret" | "env-file" | "leak-term";

export type Violation = { path: string; rule: Rule; line?: number };

// Built at runtime so this file does not carry the marker.
const MARKER = ["vee-internal", "private"].join(":");

const PRIVATE_NAME = /^(PRD|SDD|PROGRESS|DECISIONS|BUILD)/;

const SECRETS: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9]{32,}/, // OpenRouter
  /sk-ant-[A-Za-z0-9_-]{20,}/, // Anthropic
  /sk-proj-[A-Za-z0-9_-]{20,}/, // OpenAI
  /\b[sr]k_live_[A-Za-z0-9]{16,}/, // Stripe
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key
  /\bgh[pousr]_[A-Za-z0-9]{36,}/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{40,}/, // GitHub fine-grained token
  /\bAIza[0-9A-Za-z_-]{35}/, // Google API key
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const REQUIRED_IGNORES = [".internal", ".internal/", "*.internal.*"];

export function scanFile(path: string, content: string, terms: string[]): Violation[] {
  const out: Violation[] = [];
  const name = basename(path);

  if (path === ".internal" || path.startsWith(".internal/") || /\.internal\./.test(name)) {
    out.push({ path, rule: "private-path" });
  }
  if (PRIVATE_NAME.test(name)) out.push({ path, rule: "private-name" });
  if (/^\.env(\..+)?$/.test(name) && name !== ".env.example") out.push({ path, rule: "env-file" });

  if (content.includes("\u0000")) return out;

  const lines = content.split("\n");
  lines.forEach((text, i) => {
    const line = i + 1;
    if (text.includes(MARKER)) out.push({ path, rule: "private-marker", line });
    if (SECRETS.some((re) => re.test(text))) out.push({ path, rule: "secret", line });
    const lower = text.toLowerCase();
    if (terms.some((t) => lower.includes(t))) out.push({ path, rule: "leak-term", line });
  });
  return out;
}

export function parseTerms(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => l.toLowerCase());
}

export function checkGitignore(text: string): string[] {
  const lines = new Set(text.split("\n").map((l) => l.trim()));
  return REQUIRED_IGNORES.filter((l) => !lines.has(l));
}

function main(): number {
  const staged = process.argv.includes("--staged");
  const termsPath = ".internal/leak-terms.txt";
  const terms = existsSync(termsPath) ? parseTerms(readFileSync(termsPath, "utf8")) : [];
  if (staged && !existsSync(termsPath)) {
    console.error(`leak-guard: ${termsPath} not found. Real-person terms are not checked.`);
  }

  const files = staged ? stagedFiles() : listFiles();
  const read = (p: string) => (staged ? readStaged(p) : readFileSync(p, "utf8"));
  const violations = files.flatMap((p) => scanFile(p, read(p), terms));

  const gitignore =
    staged && files.includes(".gitignore") ? readStaged(".gitignore") : readFileSync(".gitignore", "utf8");
  const missing = checkGitignore(gitignore);

  for (const v of violations) {
    console.error(`leak-guard: ${v.path}${v.line ? `:${v.line}` : ""}: ${v.rule}`);
  }
  for (const l of missing) console.error(`leak-guard: .gitignore: missing line "${l}"`);

  if (violations.length > 0 || missing.length > 0) return 1;
  console.log(`leak-guard: ${files.length} files clean`);
  return 0;
}

if (import.meta.main) process.exit(main());
