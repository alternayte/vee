// SPDX-License-Identifier: AGPL-3.0-or-later
import { createApp } from "./app";
import { readEnv } from "./env";

const env = readEnv();
const app = createApp(env);
await app.migrate();
Bun.serve({ port: env.PORT, fetch: app.fetch });
console.log(JSON.stringify({ msg: "api listening", port: env.PORT }));
