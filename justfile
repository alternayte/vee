# SPDX-License-Identifier: AGPL-3.0-or-later

default:
    @just --list

# V1: types, lint, format and the import-boundary rule
check:
    bunx biome ci .
    bun run typecheck
    bunx turbo run typecheck

# Tests. No target runs all unit tests, properties and golden plans.
# `just test engine` runs one package. `just test engine:props` runs its
# `test:props` script (V3). `just test golden` runs the golden plans (V4).
test target="":
    #!/usr/bin/env bash
    set -euo pipefail
    target="{{target}}"
    if [ -z "$target" ]; then
        bun test tools
        bunx turbo run test test:props test:golden
    elif [ "$target" = "golden" ]; then
        bunx turbo run test:golden --filter=@vee/fixtures
    elif [[ "$target" == *:* ]]; then
        bunx turbo run "test:${target#*:}" --filter="@vee/${target%%:*}"
    else
        bunx turbo run test --filter="@vee/$target"
    fi

# Catalogue validation: build the family YAML into dist/catalogue.v{N}.json
catalogue:
    bunx turbo run build --filter=@vee/catalogue

# V5: 26 simulated weeks per persona
sim:
    bunx turbo run sim --filter=@vee/fixtures

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
