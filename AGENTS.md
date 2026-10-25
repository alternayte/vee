<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# AGENTS.md

## What this is
Vee is an offline-first training and nutrition app: an Expo Android app, a Hono API and a pure planning engine in one Bun and Turborepo monorepo.
The engine decides every plan change; the AI layer only explains and proposes, and the engine checks each proposal.

## Run
- `just apk` builds the release APK. Set the EXPO_PUBLIC_* variables in the same command; a Gradle-only rebuild keeps the old JavaScript bundle.
- `just e2e-server` starts Postgres, PowerSync and the API for the emulator, which reaches the host at 10.0.2.2.
- `just catalogue` builds the exercise catalogue; the API, the app and the tests read its output.

## Test
- `just check` is the gate (Biome, tsc, the pure-package import rule).
- `just test` runs unit tests, properties and golden plans; `just test engine` runs one package.
- `just test-api` (V7) and `just test-sync` (V8) need Docker.
- `just eval` (V12) calls the real model and needs OPENROUTER_API_KEY in `infra/.env`.
- `just e2e` (V9) runs the Maestro flows in `apps/mobile/e2e` on a running emulator.
- `just leak` and `just spdx` run in the pre-commit hook; `just hooks` installs it.

## Stack rules
- The product docs (PRD, SDD, BUILD, PROGRESS, DECISIONS) live in the private repo linked at `.internal`. Read them there; the leak guard refuses them in this repo.
- Build steps follow `.internal/BUILD.md`, one branch per step.

## Domain words
- stalled: a movement with 3 or more sessions without progress, the same threshold as rule P5. Avoid: stuck, plateau.
