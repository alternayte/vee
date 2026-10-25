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

FROM oven/bun:1.4.3-slim
WORKDIR /repo
COPY package.json bun.lock ./
COPY --from=catalogue /repo/apps/api/package.json apps/api/
COPY --from=catalogue /repo/packages/ai/package.json packages/ai/
COPY --from=catalogue /repo/packages/catalogue/package.json packages/catalogue/
COPY --from=catalogue /repo/packages/engine/package.json packages/engine/
COPY --from=catalogue /repo/packages/importers/package.json packages/importers/
COPY --from=catalogue /repo/packages/nutrition/package.json packages/nutrition/
COPY --from=catalogue /repo/packages/schema/package.json packages/schema/
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
