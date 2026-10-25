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

# V7: API tests against a throwaway Postgres 17 container
test-api:
    #!/usr/bin/env bash
    set -euo pipefail
    docker rm -f vee-test-pg >/dev/null 2>&1 || true
    docker run -d --rm --name vee-test-pg -e POSTGRES_PASSWORD=vee -p 54391:5432 postgres:17 \
        -c wal_level=logical >/dev/null
    trap 'docker rm -f vee-test-pg >/dev/null 2>&1 || true' EXIT
    until docker exec vee-test-pg pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 0.5; done
    TEST_DATABASE_URL=postgres://postgres:vee@localhost:54391/postgres bun test apps/api/test/

# V8: sync tests against Postgres and the PowerSync service in Docker
test-sync:
    #!/usr/bin/env bash
    set -euo pipefail
    compose="docker compose -f infra/compose.test.yaml"
    $compose down -v >/dev/null 2>&1 || true
    $compose up -d --wait postgres >/dev/null
    $compose up -d powersync >/dev/null
    trap '$compose down -v >/dev/null 2>&1 || true' EXIT
    cd apps/api && node node_modules/vitest/vitest.mjs run test-sync --testTimeout 120000 --hookTimeout 180000

# Android release APK for arm64 (bundles the JavaScript, so no Metro server)
apk: catalogue
    cd apps/mobile && CI=1 bunx expo prebuild -p android --clean
    cd apps/mobile/android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain

# V9 account flow backend: Postgres, PowerSync and the API with test mail.
# The emulator reaches the host at 10.0.2.2. Build the APK for it with
# EXPO_PUBLIC_API_URL=http://10.0.2.2:3998 EXPO_PUBLIC_POWERSYNC_URL=http://10.0.2.2:8089 just apk
e2e-server:
    #!/usr/bin/env bash
    set -euo pipefail
    compose="docker compose -f infra/compose.test.yaml"
    $compose down -v >/dev/null 2>&1 || true
    $compose up -d --wait postgres >/dev/null
    $compose up -d powersync >/dev/null
    trap '$compose down -v >/dev/null 2>&1 || true' EXIT
    DATABASE_URL=postgres://postgres:vee@localhost:54392/vee \
    BETTER_AUTH_SECRET=e2e-secret-e2e-secret-e2e-secret-e2e \
    BASE_URL=http://10.0.2.2:3998 PORT=3998 PASSKEY_RP_ID=10.0.2.2 MAIL_TRANSPORT=memory \
        bun apps/api/src/main.ts

# V9: Maestro flows on a running emulator. `just e2e smoke` runs one flow.
e2e flow="":
    #!/usr/bin/env bash
    set -euo pipefail
    adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
    # A sleeping screen has no window content, so Maestro sees nothing.
    adb shell svc power stayon true
    adb shell input keyevent KEYCODE_WAKEUP
    adb shell wm dismiss-keyguard
    if [ -z "{{flow}}" ]; then
        maestro test apps/mobile/e2e
    else
        maestro test "apps/mobile/e2e/{{flow}}.yaml"
    fi

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
