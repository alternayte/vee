// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { checkGitignore, parseTerms, scanFile } from "./leak-guard";

// Build the marker at runtime so this file does not carry it.
const MARKER = ["vee-internal", "private"].join(":");

describe("scanFile", () => {
  test("passes a clean source file", () => {
    expect(scanFile("packages/engine/src/index.ts", "export const a = 1;\n", [])).toEqual([]);
  });

  test("fails a path under .internal", () => {
    const v = scanFile(".internal/notes.txt", "hello", []);
    expect(v.map((x) => x.rule)).toContain("private-path");
  });

  test.each(["PRD.md", "docs/SDD.md", "PROGRESS.md", "a/DECISIONS.txt", "BUILD.md"])(
    "fails a private doc name: %s",
    (path) => {
      expect(scanFile(path, "x", []).map((x) => x.rule)).toContain("private-name");
    },
  );

  test("passes names that only contain a private word", () => {
    expect(scanFile("tools/build-apk.ts", "x", [])).toEqual([]);
    expect(scanFile("docs/progress-bar.md", "x", [])).toEqual([]);
  });

  test("fails content with the private marker", () => {
    const v = scanFile("notes.md", `# Title\n${MARKER}\n`, []);
    expect(v).toEqual([{ path: "notes.md", rule: "private-marker", line: 2 }]);
  });

  test.each([
    ["OpenRouter key", `const k = "sk-or-v1-${"a".repeat(64)}";`],
    ["Anthropic key", `KEY=sk-ant-api03-${"b".repeat(40)}`],
    ["Stripe live key", `stripe = "sk_live_${"c".repeat(24)}"`],
    ["Stripe restricted key", `rk_live_${"d".repeat(24)}`],
    ["AWS access key", ["AKIA", "ABCDEFGHIJKLMNOP"].join("")],
    ["GitHub token", `ghp_${"e".repeat(36)}`],
    ["GitHub fine-grained token", `github_pat_${"f".repeat(60)}`],
    ["private key block", `-----BEGIN ${"OPENSSH"} PRIVATE KEY-----`],
    ["Google API key", `AIza${"g".repeat(35)}`],
    ["Slack token", `xoxb-${"1".repeat(12)}-abc`],
  ])("fails a secret: %s", (_name, content) => {
    expect(scanFile("src/x.ts", content, []).map((x) => x.rule)).toContain("secret");
  });

  test("fails a .env file but passes .env.example", () => {
    expect(scanFile("infra/.env", "A=1", []).map((x) => x.rule)).toContain("env-file");
    expect(scanFile("infra/.env.production", "A=1", []).map((x) => x.rule)).toContain("env-file");
    expect(scanFile("infra/.env.example", "A=1", [])).toEqual([]);
  });

  test("fails a real-person term, case-insensitive", () => {
    const v = scanFile("packages/fixtures/p.json", '{"name":"Jane Roe"}', ["jane roe"]);
    expect(v).toEqual([{ path: "packages/fixtures/p.json", rule: "leak-term", line: 1 }]);
  });

  test("does not report the term itself", () => {
    const v = scanFile("a.txt", "Jane Roe", ["jane roe"]);
    expect(JSON.stringify(v)).not.toContain("jane");
  });

  test("skips content checks on binary files", () => {
    expect(scanFile("a.png", `\u0000${MARKER}`, [])).toEqual([]);
  });
});

describe("parseTerms", () => {
  test("drops blank lines and comments, trims, lowercases", () => {
    expect(parseTerms("# comment\n\n  Jane Roe  \n71.4\n")).toEqual(["jane roe", "71.4"]);
  });
});

describe("checkGitignore", () => {
  test("passes when all three lines exist", () => {
    expect(checkGitignore(".internal\n.internal/\n*.internal.*\nnode_modules\n")).toEqual([]);
  });

  test("names each missing line", () => {
    expect(checkGitignore(".internal\nnode_modules\n")).toEqual([".internal/", "*.internal.*"]);
  });
});
