// SPDX-License-Identifier: AGPL-3.0-or-later
import { PgBoss } from "pg-boss";
import { dueReviews } from "./ai";
import { createApp } from "./app";
import { readEnv } from "./env";

const WEEKLY_REVIEW = "weekly-review";
const env = readEnv();
const app = createApp(env);
await app.migrate();
Bun.serve({ port: env.PORT, fetch: app.fetch });

// Jobs (SDD "Jobs"): every hour, write the review for each user whose local
// time is Sunday 18:00.
const boss = new PgBoss(env.DATABASE_URL);
boss.on("error", (e) => console.error(JSON.stringify({ msg: "pg-boss", error: String(e) })));
await boss.start();
await boss.createQueue(WEEKLY_REVIEW);
await boss.schedule(WEEKLY_REVIEW, "0 * * * *");
await boss.work(WEEKLY_REVIEW, async () => {
  for (const due of await dueReviews(app.pool)) {
    try {
      await app.ai.review(due.userId, new Date(), due.to);
    } catch (e) {
      console.error(JSON.stringify({ msg: "weekly review failed", userId: due.userId, error: String(e) }));
    }
  }
});
console.log(JSON.stringify({ msg: "api listening", port: env.PORT }));
