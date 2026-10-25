// SPDX-License-Identifier: AGPL-3.0-or-later
// V7: the AI layer against Postgres with a scripted model (no network).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Catalogue } from "@vee/catalogue";
import catalogueJson from "@vee/catalogue/catalogue.v1.json";
import { ENGINE_VERSION, emptyHistory, generatePlan, type KitItem, V_TAPER_LEAN_GAIN } from "@vee/engine";
import { uuidv7 } from "@vee/schema";
import { programmeRows } from "@vee/schema/engine";
import { dueReviews, localParts, nextMonth } from "../src/ai";
import type { App } from "../src/app";
import { freshDatabase, OWNER_EMAIL, query, request, signIn, startApp } from "./harness";

const catalogue = catalogueJson as unknown as Catalogue;
let app: App;
let owner: { token: string; userId: string };
const answers: unknown[] = [];
let calls = 0;

const fakeModel = (async () => {
  calls++;
  const next = answers.shift();
  if (next === undefined) return new Response("no answer scripted", { status: 500 });
  return new Response(
    JSON.stringify({
      model: "test/model",
      choices: [{ message: { content: typeof next === "string" ? next : JSON.stringify(next) } }],
      usage: { total_tokens: 1000, cost: 0.002 },
    }),
  );
}) as unknown as typeof fetch;

async function insert(table: string, rows: Record<string, unknown>[]) {
  for (const r of rows) {
    const keys = Object.keys(r);
    await query(
      `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
      keys.map((k) => r[k]),
    );
  }
}

/** A profile and the first programme for a user, as the app writes them. */
async function onboard(userId: string) {
  const kit: KitItem[] = [{ id: uuidv7(), kind: "dial_db", count: 1, params: { min: 2, max: 24, step: 2 } }];
  const at = new Date().toISOString();
  await insert("profiles", [
    {
      id: uuidv7(),
      user_id: userId,
      height_cm: 180,
      birth_year: 1989,
      sex: "male",
      timezone: "Europe/Zurich",
      goal_template: "v-taper-lean-gain",
      minutes_per_session: 35,
      created_at: at,
      updated_at: at,
    },
  ]);
  await insert(
    "kit_items",
    kit.map((k) => ({
      id: k.id,
      user_id: userId,
      kind: k.kind,
      count: k.count,
      params: JSON.stringify(k.params),
      created_at: at,
      updated_at: at,
    })),
  );
  const plan = generatePlan(
    {
      profile: {
        heightCm: 180,
        birthYear: 1989,
        sex: "male",
        minutesPerSession: 35,
        goalTemplate: "v-taper-lean-gain",
      },
      kit,
      flags: [],
      catalogue,
      history: emptyHistory(),
      today: at.slice(0, 10),
      engineVersion: ENGINE_VERSION,
    },
    V_TAPER_LEAN_GAIN,
  );
  const rows = programmeRows(plan, { newId: uuidv7, now: at, userId });
  await insert("programmes", rows.programmes);
  await insert("session_templates", rows.session_templates);
  await insert("template_items", rows.template_items);
  return plan;
}

beforeAll(async () => {
  await freshDatabase();
  app = await startApp({ OPENROUTER_API_KEY: "test-key", AI_MONTHLY_CAP_CHF: "1" }, { aiFetch: fakeModel });
  owner = await signIn(app, OWNER_EMAIL);
});

afterAll(async () => {
  await app.close();
});

const post = (path: string, body: unknown, token = owner.token) =>
  request(app, path, { method: "POST", body: JSON.stringify(body), token });

const reason = { ruleId: "P3_HOLD", inputs: { aim: 9, unit: "reps" }, text: "Aim for 9 reps." };

describe("AI routes", () => {
  test("need a session", async () => {
    const r = await request(app, "/ai/explain-more", {
      method: "POST",
      body: JSON.stringify({ reasons: [reason] }),
    });
    expect(r.status).toBe(401);
  });

  test("explain-more answers, records the cost, and serves a repeat from the cache", async () => {
    answers.push({ text: "Beat last time by one rep. Aim for 9 reps." });
    const first = await post("/ai/explain-more", { reasons: [reason] });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { text: string }).text).toMatch(/9 reps/);
    const before = calls;
    const again = await post("/ai/explain-more", { reasons: [reason] });
    expect(again.status).toBe(200);
    expect(calls).toBe(before);
    const usage = await query<{ n: string }>("SELECT count(*) AS n FROM ai_usage WHERE user_id = $1", [
      owner.userId,
    ]);
    expect(Number(usage[0]?.n)).toBe(1);
  });

  test("an answer that fails twice is 502 with the reason", async () => {
    answers.push({ text: "Do 40 reps." }, { text: "Do 40 reps." });
    const r = await post("/ai/explain-more", { reasons: [{ ...reason, ruleId: "P3_OTHER" }] });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { message: string }).message).toMatch(/40/);
  });

  test("adjust-today turns text into parameters", async () => {
    const plan = generatePlan(
      {
        profile: {
          heightCm: 180,
          birthYear: 1989,
          sex: "male",
          minutesPerSession: 35,
          goalTemplate: "v-taper-lean-gain",
        },
        kit: [],
        flags: [],
        catalogue,
        history: emptyHistory(),
        today: "2026-11-02",
        engineVersion: ENGINE_VERSION,
      },
      V_TAPER_LEAN_GAIN,
    );
    answers.push({ minutes: 15, flags: [{ joint: "shoulder", severity: "mild" }] });
    const r = await post("/ai/adjust-today", {
      text: "only 15 min, left shoulder is sore",
      template: plan.templates[0],
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ minutes: 15, flags: [{ joint: "shoulder", severity: "mild" }] });
  });

  test("a free-tier user gets 403", async () => {
    const billing = await startApp(
      { OPENROUTER_API_KEY: "k", BILLING_ENABLED: "true" },
      { aiFetch: fakeModel },
    );
    const free = await signIn(billing, "free@example.test");
    const r = await request(billing, "/ai/explain-more", {
      method: "POST",
      body: JSON.stringify({ reasons: [reason] }),
      token: free.token,
    });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe("plus-required");
    await billing.close();
  });

  test("at the monthly cap, AI pauses until the 1st of next month", async () => {
    await insert("ai_usage", [
      {
        id: uuidv7(),
        user_id: owner.userId,
        task: "test",
        model: "m",
        cost_usd: 2,
        tokens: 0,
        at: new Date().toISOString(),
      },
    ]);
    const r = await post("/ai/explain-more", { reasons: [{ ...reason, ruleId: "P3_CAP" }] });
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ error: "budget", paused_until: nextMonth(new Date()) });
    await query("DELETE FROM ai_usage WHERE task = 'test'");
  });
});

describe("weekly review", () => {
  test("writes the review and only the proposals the engine accepts", async () => {
    const user = await signIn(app, "review@example.test");
    const plan = await onboard(user.userId);
    const row = plan.templates[0]?.items.find((i) => i.family === "row");
    expect(row).toBeDefined();
    answers.push({
      words: "You set up your plan. No sessions are logged yet.",
      focus: "Do session A.",
      proposals: [
        { change: { kind: "sets", dayType: "A", exerciseId: row?.exerciseId, sets: 2 }, why: "Start easy." },
        { change: { kind: "swap", dayType: "A", family: "row", to: "goblet-squat" }, why: "Legs." },
      ],
    });
    const r = await post("/ai/weekly-review", {}, user.token);
    expect(r.status).toBe(200);
    const reviews = await query<{ words: string; numbers: string; model: string }>(
      "SELECT words, numbers, model FROM reviews WHERE user_id = $1",
      [user.userId],
    );
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.words).toMatch(/No sessions/);
    expect(JSON.parse(reviews[0]?.numbers ?? "{}")).toMatchObject({
      focus: "Do session A.",
      training: { mainDone: 0 },
    });
    const proposals = await query<{ change: string; status: string; source: string }>(
      "SELECT change, status, source FROM ai_proposals WHERE user_id = $1",
      [user.userId],
    );
    expect(proposals.map((p) => JSON.parse(p.change).kind)).toEqual(["sets"]);
    expect(proposals[0]).toMatchObject({ status: "pending", source: "review" });
  });

  test("when the model fails, the review keeps the numbers without words", async () => {
    const user = await signIn(app, "fail@example.test");
    await onboard(user.userId);
    answers.push("x", "y");
    const r = await post("/ai/weekly-review", {}, user.token);
    expect(r.status).toBe(200);
    const reviews = await query<{ words: string | null; numbers: string }>(
      "SELECT words, numbers FROM reviews WHERE user_id = $1",
      [user.userId],
    );
    expect(reviews[0]?.words).toBeNull();
    expect(JSON.parse(reviews[0]?.numbers ?? "{}").training).toBeDefined();
  });

  test("the job picks users at Sunday 18:00 local time with no review that week", async () => {
    const user = await signIn(app, "sunday@example.test");
    await onboard(user.userId);
    const sunday18 = new Date("2026-11-08T17:30:00Z"); // 18:30 in Zurich (CET)
    expect(localParts(sunday18, "Europe/Zurich")).toEqual({ date: "2026-11-08", weekday: 0, hour: 18 });
    const due = await dueReviews(app.pool, sunday18);
    expect(due).toContainEqual({ userId: user.userId, to: "2026-11-08" });
    expect(await dueReviews(app.pool, new Date("2026-11-08T15:30:00Z"))).toEqual([]);
  });
});
