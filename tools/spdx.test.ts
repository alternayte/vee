// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { hasHeader, needsHeader } from "./spdx";

const HEADER = "SPDX-License-Identifier: AGPL-3.0-or-later";

describe("needsHeader", () => {
  test.each([
    "packages/engine/src/index.ts",
    "apps/mobile/app/index.tsx",
    "tools/figure/pose.py",
    "apps/mobile/modules/vee-live/android/Live.kt",
    "infra/compose.yaml",
    ".github/workflows/ci.yml",
    "justfile",
    ".githooks/pre-commit",
    "apps/coach/src/app.css",
  ])("source file: %s", (path) => {
    expect(needsHeader(path)).toBe(true);
  });

  test.each([
    "package.json",
    "README.md",
    "LICENSE",
    "bun.lock",
    "a.png",
    ".gitignore",
    "apps/mobile/uniwind-types.d.ts",
  ])("not a source file: %s", (path) => {
    expect(needsHeader(path)).toBe(false);
  });
});

describe("hasHeader", () => {
  test("finds the header on line 1", () => {
    expect(hasHeader(`// ${HEADER}\nexport {};\n`)).toBe(true);
  });

  test("finds the header after a shebang", () => {
    expect(hasHeader(`#!/usr/bin/env bash\n# ${HEADER}\n`)).toBe(true);
  });

  test("fails with no header", () => {
    expect(hasHeader("export {};\n")).toBe(false);
  });

  test("fails with a different licence", () => {
    expect(hasHeader("// SPDX-License-Identifier: MIT\n")).toBe(false);
    expect(hasHeader("// SPDX-License-Identifier: AGPL-3.0-only\n")).toBe(false);
  });

  test("fails when the header is below line 5", () => {
    expect(hasHeader(`a\nb\nc\nd\ne\n// ${HEADER}\n`)).toBe(false);
  });
});
