# SPDX-License-Identifier: AGPL-3.0-or-later

default:
    @just --list

# V1: types, lint, format and the import-boundary rule
check:
    bunx biome ci .
    bun run typecheck
    bunx turbo run typecheck

# V2 and later: tests. No target runs all; a target runs one package, e.g. `just test engine`
test target="":
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "{{target}}" ]; then
        bun test tools
        bunx turbo run test
    else
        bunx turbo run test --filter="@vee/{{target}}"
    fi

# Catalogue validation: build the family YAML into dist/catalogue.v{N}.json
catalogue:
    bunx turbo run build --filter=@vee/catalogue

# V13: leak guard over all files (CI mode)
leak:
    bun tools/leak-guard.ts

# V14: SPDX licence headers
spdx:
    bun tools/spdx.ts

# All fast gates
verify: check catalogue test leak spdx

# Install the pre-commit hook
hooks:
    git config core.hooksPath .githooks

# Apply Biome formatting and safe fixes
fmt:
    bunx biome check --write .
