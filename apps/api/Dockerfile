# SPDX-License-Identifier: AGPL-3.0-or-later
# Built from the repo root: docker build -f apps/api/Dockerfile .
FROM oven/bun:1.4.3-slim
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY packages/schema/package.json packages/schema/
RUN bun install --frozen-lockfile --production --filter @vee/api
COPY packages/schema packages/schema
COPY apps/api apps/api
WORKDIR /repo/apps/api
USER bun
EXPOSE 3000
CMD ["bun", "src/main.ts"]
