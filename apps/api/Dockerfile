# SPDX-License-Identifier: AGPL-3.0-or-later
# Built from the repo root: docker build -f apps/api/Dockerfile .

# The catalogue JSON is a build output (YAML → JSON), so it is made here.
FROM oven/bun:1.4.3-slim AS catalogue
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps apps
COPY packages packages
RUN bun install --frozen-lockfile --filter @vee/catalogue
RUN cd packages/catalogue && bun scripts/build.ts
RUN mkdir /manifests && find apps packages -maxdepth 2 -name package.json -exec cp --parents {} /manifests \;

FROM oven/bun:1.4.3-slim
WORKDIR /repo
COPY package.json bun.lock ./
# Every workspace manifest: the lockfile lists them all.
COPY --from=catalogue /manifests/ ./
RUN bun install --frozen-lockfile --production --filter @vee/api
COPY packages/ai packages/ai
COPY packages/catalogue/src packages/catalogue/src
COPY --from=catalogue /repo/packages/catalogue/dist packages/catalogue/dist
COPY packages/engine/src packages/engine/src
COPY packages/importers/src packages/importers/src
COPY packages/nutrition/src packages/nutrition/src
COPY packages/schema/src packages/schema/src
COPY apps/api apps/api
WORKDIR /repo/apps/api
USER bun
EXPOSE 3000
CMD ["bun", "src/main.ts"]
