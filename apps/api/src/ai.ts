// SPDX-License-Identifier: AGPL-3.0-or-later
// The AI layer on the server (SDD "AI layer"): entitlement and budget checks,
// usage records, and the tasks. The phone never holds the provider key.
import { createHash } from "node:crypto";
import {
  adjustToday,
  type ChatTurn,
  type CoachData,
  coachChat,
  createGateway,
  explainMore,
  foodWeek,
  type Gateway,
  mealDraft,
  type Proposed,
  type Review,
  reviewNumbers,
  runTool,
  SCOPES,
  type Scope,
  toolsFor,
  type Usage,
  weeklyReview,
} from "@vee/ai";
import type { Catalogue } from "@vee/catalogue";
import catalogueJson from "@vee/catalogue/catalogue.v1.json";
import { addDays, ENGINE_VERSION, type Reason, type SessionTemplate } from "@vee/engine";
import {
  type Exclusion,
  type HouseholdMember,
  MIN_WEIGH_INS,
  parseTargets,
  WEEKNIGHT_MAX_MIN,
  weeklySlope,
} from "@vee/nutrition";
import { SEED_INGREDIENTS, SEED_MEALS } from "@vee/nutrition/seed";
import { uuidv7 } from "@vee/schema";
import { ENGINE_TABLES, type EngineRows, toEngineInput } from "@vee/schema/engine";
import type pg from "pg";
import { modelRoutes } from "../config/models";
import type { Env } from "./env";

const catalogue = catalogueJson as unknown as Catalogue;

export type AiRefusal =
  | { status: 403; body: { error: "plus-required" | "ai-off"; message: string } }
  | { status: 402; body: { error: "budget"; paused_until: string; message: string } };

/** The first day of next month, `YYYY-MM-DD`. */
export function nextMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export function createAi(env: Env, pool: pg.Pool, f?: typeof fetch) {
  const routes = modelRoutes(env);
  const gateway: Gateway | undefined = env.OPENROUTER_API_KEY
    ? createGateway({
        apiKey: env.OPENROUTER_API_KEY,
        baseUrl: env.OPENROUTER_BASE_URL,
        ...(f ? { fetch: f } : {}),
      })
    : undefined;

  async function rows(userId: string): Promise<EngineRows> {
    const out = {} as Record<string, unknown[]>;
    for (const name of ENGINE_TABLES) {
      out[name] = (await pool.query(`SELECT * FROM "${name}" WHERE user_id = $1`, [userId])).rows;
    }
    return out as unknown as EngineRows;
  }

  async function spentChf(userId: string, now: Date): Promise<number> {
    const r = await pool.query<{ usd: number | null }>(
      "SELECT sum(cost_usd) AS usd FROM ai_usage WHERE user_id = $1 AND at >= date_trunc('month', $2::timestamptz)",
      [userId, now.toISOString()],
    );
    return (r.rows[0]?.usd ?? 0) * env.AI_CHF_PER_USD;
  }

  /** Undefined when the user may call the AI now. */
  async function refusal(userId: string, now = new Date()): Promise<AiRefusal | undefined> {
    if (!gateway) return { status: 403, body: { error: "ai-off", message: "AI is off on this server." } };
    const tier = (
      await pool.query<{ tier: string }>(
        "SELECT tier FROM entitlements WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [userId],
      )
    ).rows[0]?.tier;
    if (tier !== "plus" && tier !== "owner" && tier !== "coach")
      return { status: 403, body: { error: "plus-required", message: "AI needs the plus tier." } };
    if ((await spentChf(userId, now)) >= env.AI_MONTHLY_CAP_CHF) {
      const until = nextMonth(now);
      return {
        status: 402,
        body: { error: "budget", paused_until: until, message: `AI is paused until ${until}.` },
      };
    }
    return undefined;
  }

  async function record(userId: string, task: string, usage: Usage[]) {
    for (const u of usage) {
      await pool.query(
        "INSERT INTO ai_usage (id, user_id, task, model, cost_usd, tokens, at) VALUES ($1, $2, $3, $4, $5, $6, now())",
        [uuidv7(), userId, task, u.model, u.costUsd, u.tokens],
      );
    }
  }

  const need = () => {
    if (!gateway) throw new Error("AI is off");
    return gateway;
  };

  async function today(userId: string, now: Date): Promise<string> {
    const tz = (
      await pool.query<{ timezone: string | null }>(
        "SELECT timezone FROM profiles WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1",
        [userId],
      )
    ).rows[0]?.timezone;
    return localParts(now, tz ?? "UTC").date;
  }

  async function foodLogs(userId: string, from: string, to: string) {
    return (
      await pool.query<{
        date: string;
        palm: number | null;
        fist: number | null;
        cupped: number | null;
        thumb: number | null;
      }>(
        "SELECT date, palm, fist, cupped, thumb FROM food_logs WHERE user_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3",
        [userId, from, to],
      )
    ).rows.map((l) => ({
      date: l.date,
      portions: { palm: l.palm ?? 0, fist: l.fist ?? 0, cupped: l.cupped ?? 0, thumb: l.thumb ?? 0 },
    }));
  }

  async function foodTargets(userId: string) {
    const row = (
      await pool.query<{ per_moment: string | null }>(
        "SELECT per_moment FROM food_targets WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
        [userId],
      )
    ).rows[0];
    return row?.per_moment ? parseTargets(row.per_moment) : undefined;
  }

  async function weighIns(userId: string, since: string) {
    return (
      await pool.query<{ measured_at: string; value: number }>(
        "SELECT measured_at, value FROM body_metrics WHERE user_id = $1 AND kind = 'weight' AND deleted_at IS NULL AND value IS NOT NULL AND measured_at >= $2 ORDER BY measured_at",
        [userId, since],
      )
    ).rows.map((w) => ({ date: w.measured_at.slice(0, 10), kg: w.value }));
  }

  /** What the coach tools read for one user. Undefined without a programme. */
  async function snapshot(userId: string, now: Date): Promise<CoachData | undefined> {
    const end = await today(userId, now);
    const input = toEngineInput(await rows(userId), { catalogue, today: end, engineVersion: ENGINE_VERSION });
    if (!input?.programme) return undefined;
    const since = addDays(end, -120);
    const reviews = (
      await pool.query<{ week: string; words: string | null; numbers: string | null }>(
        "SELECT week, words, numbers FROM reviews WHERE user_id = $1 AND deleted_at IS NULL ORDER BY week DESC LIMIT 6",
        [userId],
      )
    ).rows.map((r) => {
      const focus = r.numbers ? (JSON.parse(r.numbers) as { focus?: string }).focus : undefined;
      return { week: r.week, ...(r.words ? { words: r.words } : {}), ...(focus ? { focus } : {}) };
    });
    const perMoment = await foodTargets(userId);
    return {
      input,
      food: { logs: await foodLogs(userId, since, end), ...(perMoment ? { perMoment } : {}) },
      weighIns: await weighIns(userId, since),
      reviews,
    };
  }

  /** A pending proposal card for the user. The engine has accepted the change. */
  async function propose(userId: string, source: "chat" | "mcp", p: Proposed): Promise<string> {
    const id = uuidv7();
    const at = new Date().toISOString();
    await pool.query(
      `INSERT INTO ai_proposals (id, user_id, source, change, validation, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6)`,
      [id, userId, source, JSON.stringify({ ...p.change, why: p.why }), JSON.stringify(p.reasons), at],
    );
    return id;
  }

  return {
    refusal,
    snapshot,

    /** Coach chat (streamed through the callbacks). Undefined when the user has no programme. */
    async chat(
      userId: string,
      turns: ChatTurn[],
      on: { text: (d: string) => void; proposal: (p: Proposed & { id: string }) => void },
      now = new Date(),
    ) {
      const data = await snapshot(userId, now);
      if (!data) return undefined;
      const r = await coachChat(need(), routes.coach_chat, {
        data,
        // The chat in the app reads everything the user owns; MCP tokens carry their own scopes.
        scopes: SCOPES,
        turns,
        ctx: { propose: (p) => propose(userId, "chat", p) },
        onText: on.text,
        onProposal: on.proposal,
      });
      await record(userId, "coach_chat", r.usage);
      return r;
    },

    /** One coach tool for an MCP client with these scopes. */
    async tool(userId: string, name: string, args: unknown, scopes: readonly Scope[], now = new Date()) {
      const t = toolsFor(scopes).find((x) => x.name === name);
      if (!t) return { error: `No tool "${name}" for the granted scopes.` };
      const data = await snapshot(userId, now);
      if (!data) return { error: "No plan yet. Finish onboarding in the app first." };
      return runTool(data, t, args, { propose: (p) => propose(userId, "mcp", p) });
    },

    async explain(userId: string, reasons: Reason[]) {
      const key = createHash("sha256")
        .update(JSON.stringify(reasons.map((r) => [r.ruleId, r.inputs])))
        .digest("hex");
      const hit = await pool.query<{ output: string }>("SELECT output FROM ai_cache WHERE id = $1", [key]);
      if (hit.rows[0])
        return { ok: true as const, output: JSON.parse(hit.rows[0].output) as { text: string } };
      const r = await explainMore(need(), routes.explain_more, reasons);
      await record(userId, "explain_more", r.usage);
      if (r.ok)
        await pool.query(
          "INSERT INTO ai_cache (id, task, output, at) VALUES ($1, 'explain_more', $2, now()) ON CONFLICT (id) DO NOTHING",
          [key, JSON.stringify(r.output)],
        );
      return r;
    },

    async adjust(userId: string, text: string, template: SessionTemplate) {
      const r = await adjustToday(need(), routes.adjust_today, text, template);
      await record(userId, "adjust_today", r.usage);
      return r;
    },

    async meal(userId: string, maxMinutes = WEEKNIGHT_MAX_MIN) {
      const members = (
        await pool.query<{ id: string; name: string; is_self: number | null }>(
          "SELECT id, name, is_self FROM household_members WHERE user_id = $1 AND deleted_at IS NULL",
          [userId],
        )
      ).rows;
      const household: HouseholdMember[] = members.map((m) => ({
        id: m.id,
        name: m.name,
        isSelf: m.is_self === 1,
      }));
      if (!household.some((m) => m.isSelf)) household.push({ id: "self", name: "You", isSelf: true });
      const selfId = household.find((m) => m.isSelf)?.id ?? "self";
      const ex = (
        await pool.query<{
          member_id: string | null;
          kind: string;
          ingredient_id: string | null;
          tag: string | null;
        }>(
          "SELECT member_id, kind, ingredient_id, tag FROM exclusions WHERE user_id = $1 AND deleted_at IS NULL",
          [userId],
        )
      ).rows;
      const exclusions: Exclusion[] = ex.map((x) => ({
        memberId: x.member_id ?? selfId,
        kind: x.kind as Exclusion["kind"],
        ...(x.ingredient_id ? { ingredientId: x.ingredient_id } : {}),
        ...(x.tag ? { tag: x.tag } : {}),
      }));
      // The library is lactose-free for the user (PRD), so AI meals are too.
      if (!exclusions.some((x) => x.memberId === selfId && x.kind === "lactose"))
        exclusions.push({ memberId: selfId, kind: "lactose" });
      const stored = (
        await pool.query<{ name: string; ingredient_ids: string[] }>(
          `SELECT m.name, coalesce(array_agg(mi.ingredient_id) FILTER (WHERE mi.ingredient_id IS NOT NULL), '{}') AS ingredient_ids
             FROM meals m
             LEFT JOIN meal_ingredients mi ON mi.meal_id = m.id AND mi.deleted_at IS NULL
            WHERE m.user_id = $1 AND m.deleted_at IS NULL
            GROUP BY m.id, m.name`,
          [userId],
        )
      ).rows;
      const library = [
        ...SEED_MEALS.map((m) => ({ name: m.name, ingredientIds: m.ingredients.map((i) => i.ingredientId) })),
        ...stored.map((m) => ({ name: m.name, ingredientIds: m.ingredient_ids })),
      ];
      const r = await mealDraft(
        need(),
        routes.meal_draft,
        { ingredients: SEED_INGREDIENTS, exclusions, household, maxMinutes, library },
        uuidv7,
      );
      await record(userId, "meal_draft", r.usage);
      return r;
    },

    /**
     * Writes the review of the 7 days that end on `to` (the user's local date),
     * with its proposals. Returns undefined when the user has no programme.
     */
    async review(userId: string, now = new Date(), to?: string): Promise<Review | undefined> {
      const end = to ?? (await today(userId, now));
      const from = addDays(end, -6);
      const input = toEngineInput(await rows(userId), {
        catalogue,
        today: end,
        engineVersion: ENGINE_VERSION,
      });
      if (!input?.programme) return undefined;
      const days = Array.from({ length: 7 }, (_, n) => addDays(from, n));
      const logs = await foodLogs(userId, from, end);
      const perMoment = await foodTargets(userId);
      const weights = await weighIns(userId, addDays(end, -21));
      const numbers = reviewNumbers(input, from, end, foodWeek(logs, perMoment, days), {
        weighIns: weights.length,
        slopeKgPerWeek: weights.length >= MIN_WEIGH_INS ? Math.round(weeklySlope(weights) * 100) / 100 : null,
      });
      const stop = await refusal(userId, now);
      const review: Review = stop
        ? { numbers, proposals: [], usage: [], error: stop.body.error }
        : await weeklyReview(need(), routes.weekly_review, input, numbers);
      await record(userId, "weekly_review", review.usage);
      await writeReview(pool, userId, review);
      return review;
    },
  };
}

export type Ai = ReturnType<typeof createAi>;

async function writeReview(pool: pg.Pool, userId: string, r: Review) {
  const at = new Date().toISOString();
  const week = r.numbers.week.to;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO reviews (id, user_id, week, numbers, words, model, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [
        uuidv7(),
        userId,
        week,
        JSON.stringify({ ...r.numbers, ...(r.focus ? { focus: r.focus } : {}) }),
        r.words ?? null,
        r.model ?? null,
        at,
      ],
    );
    for (const p of r.proposals) {
      await client.query(
        `INSERT INTO ai_proposals (id, user_id, source, change, validation, status, created_at, updated_at)
         VALUES ($1, $2, 'review', $3, $4, 'pending', $5, $5)`,
        [uuidv7(), userId, JSON.stringify({ ...p.change, why: p.why, week }), JSON.stringify(p.reasons), at],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Local date, weekday (0 = Sunday) and hour in a time zone. */
export function localParts(now: Date, timeZone: string): { date: string; weekday: number; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday, hour: Number(parts.hour) };
}

export const REVIEW_HOUR = 18;

/** Users whose local time is Sunday 18:00–18:59 and who have no review for this week yet. */
export async function dueReviews(pool: pg.Pool, now = new Date()): Promise<{ userId: string; to: string }[]> {
  const users = (
    await pool.query<{ user_id: string; timezone: string | null }>(
      "SELECT DISTINCT ON (user_id) user_id, timezone FROM profiles WHERE deleted_at IS NULL AND user_id IS NOT NULL ORDER BY user_id, updated_at DESC",
    )
  ).rows;
  const out: { userId: string; to: string }[] = [];
  for (const u of users) {
    const local = localParts(now, u.timezone ?? "UTC");
    if (local.weekday !== 0 || local.hour !== REVIEW_HOUR) continue;
    const done = await pool.query("SELECT 1 FROM reviews WHERE user_id = $1 AND week = $2 LIMIT 1", [
      u.user_id,
      local.date,
    ]);
    if (done.rowCount === 0) out.push({ userId: u.user_id, to: local.date });
  }
  return out;
}
