// SPDX-License-Identifier: AGPL-3.0-or-later
// Human coaching (SDD "Coach access"). A coach reads a client only through an
// active coach_links row, only the scopes the client granted, and every read
// writes one audit_log row (I8). A coach's plan change is a card the engine
// checks (I4); the phone applies it, never the server.
import { createHash, randomInt } from "node:crypto";
import { type CoachData, PlanChangeSchema, runTool, TOOLS } from "@vee/ai";
import {
  addDays,
  type PlanChange,
  readinessMode,
  readinessScore,
  STALL_SESSIONS,
  validateProposal,
} from "@vee/engine";
import { uuidv7 } from "@vee/schema";
import type pg from "pg";
import { z } from "zod";
import type { Ai } from "./ai";
import type { Push } from "./push";

export const COACH_SCOPES = ["training", "food", "body", "photos"] as const;
export type CoachScope = (typeof COACH_SCOPES)[number];
export const INVITE_DAYS = 7;

/** Crockford base32 without the letters people misread. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const hash = (code: string) =>
  createHash("sha256")
    .update(code.replace(/[^A-Z0-9]/gi, "").toUpperCase())
    .digest("hex");

export const CommentBody = z.object({
  targetType: z.enum(["session", "set"]),
  targetId: z.string().min(1).max(64),
  body: z.string().min(1).max(4000),
});
export const MessageBody = z.object({ body: z.string().min(1).max(4000) });
export const ChangeBody = z.object({ change: PlanChangeSchema, why: z.string().min(1).max(500) });
export const DecisionBody = z.object({ decision: z.enum(["approve", "reject"]) });
export const AcceptBody = z.object({
  code: z.string().min(4).max(20),
  scopes: z.array(z.enum(COACH_SCOPES)).max(4),
});

type Link = {
  id: string;
  coach_id: string;
  client_id: string;
  scopes: CoachScope[];
  status: string;
  coach_name: string | null;
};

export type Refused = { status: 403 | 404 | 409; error: string; message: string };
const refused = (status: Refused["status"], error: string, message: string): Refused => ({
  status,
  error,
  message,
});
export const isRefused = (x: unknown): x is Refused =>
  typeof x === "object" && x !== null && "status" in x && "error" in x;

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const read = (data: CoachData, name: string, args: unknown = {}) =>
  runTool(data, tool(name), args, { propose: async () => "" });

const exerciseName = (data: CoachData, id: string) =>
  data.input.catalogue.exercises.find((e) => e.id === id)?.names.en ?? id;

/** Sessions with their sets and ids, newest first, so the coach can comment on either. */
function sessionLog(data: CoachData, days: number) {
  const since = addDays(data.input.today, -days);
  const h = data.input.history;
  return h.sessions
    .filter((s) => s.date >= since)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((s) => ({
      id: s.id,
      date: s.date,
      kind: s.kind,
      ...(s.dayType ? { day: s.dayType } : {}),
      status: s.status,
      ...(s.readinessMode ? { readiness: s.readinessMode } : {}),
      sets: h.sets
        .filter((x) => x.sessionId === s.id && !x.deletedAt)
        .map((x) => ({
          id: x.id,
          exercise: exerciseName(data, x.exerciseId),
          ...(x.reps !== undefined ? { reps: x.reps } : {}),
          ...(x.seconds !== undefined ? { seconds: x.seconds } : {}),
          ...(x.loadKg !== undefined ? { kg: x.loadKg } : {}),
          ...(x.side ? { side: x.side } : {}),
          effort: x.effort,
        })),
    }));
}

export function createCoach(pool: pg.Pool, ai: Ai, push: Push) {
  async function tierOf(userId: string): Promise<string | undefined> {
    return (
      await pool.query<{ tier: string }>(
        "SELECT tier FROM entitlements WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [userId],
      )
    ).rows[0]?.tier;
  }

  async function audit(actorId: string, action: string, target: string) {
    await pool.query(
      "INSERT INTO audit_log (id, actor_id, action, target, at) VALUES ($1, $2, $3, $4, now())",
      [uuidv7(), actorId, action, target],
    );
  }

  async function nameOf(userId: string) {
    const u = (
      await pool.query<{ name: string | null; email: string }>(
        'SELECT name, email FROM "user" WHERE id = $1',
        [userId],
      )
    ).rows[0];
    return u?.name || u?.email || "Your coach";
  }

  /**
   * The one coach-access check (I8): an active link, and the scope when the
   * request needs one. Every allowed request writes its audit row and the
   * link's last access, so the client sees it in Settings.
   */
  async function access(
    coachId: string,
    clientId: string,
    action: string,
    scope?: CoachScope,
  ): Promise<Link | Refused> {
    const link = (
      await pool.query<{
        id: string;
        coach_id: string;
        client_id: string;
        scopes: string | null;
        status: string;
        coach_name: string | null;
      }>(
        "SELECT id, coach_id, client_id, scopes, status, coach_name FROM coach_links WHERE coach_id = $1 AND client_id = $2 AND status = 'active' AND deleted_at IS NULL LIMIT 1",
        [coachId, clientId],
      )
    ).rows[0];
    if (!link) return refused(403, "no-link", "This person is not your client, or they removed the link.");
    const scopes = (link.scopes ? JSON.parse(link.scopes) : []) as CoachScope[];
    if (scope && !scopes.includes(scope))
      return refused(403, "scope", `The client did not share ${scope} data with you.`);
    await audit(coachId, action, clientId);
    await pool.query("UPDATE coach_links SET last_access_at = $1, updated_at = $1 WHERE id = $2", [
      new Date().toISOString(),
      link.id,
    ]);
    return { ...link, scopes };
  }

  async function messages(linkId: string) {
    return (
      await pool.query<{ id: string; author_id: string; body: string | null; created_at: string }>(
        "SELECT id, author_id, body, created_at FROM messages WHERE coach_link_id = $1 AND deleted_at IS NULL ORDER BY created_at",
        [linkId],
      )
    ).rows;
  }

  /** What needs the coach's eyes first: misses, low check-ins, stalls, cards and client messages since the coach's last one. */
  function attention(data: CoachData | undefined, scopes: CoachScope[], pending: number, unread: number) {
    const out = { skipped: 0, lowReadiness: 0, stalled: 0, pendingCards: pending, unreadMessages: unread };
    if (data && scopes.includes("training")) {
      const since = addDays(data.input.today, -6);
      const h = data.input.history;
      out.skipped = h.sessions.filter((s) => s.date >= since && s.status === "skipped").length;
      out.lowReadiness = h.checkins.filter(
        (c) => c.date >= since && readinessMode(readinessScore(c)) !== "full",
      ).length;
      out.stalled = h.progress.filter((s) => (s.streaks?.stall ?? 0) >= STALL_SESSIONS).length;
    }
    return {
      ...out,
      score:
        out.skipped * 2 + out.lowReadiness + out.stalled * 2 + out.pendingCards * 3 + out.unreadMessages * 3,
    };
  }

  return {
    tierOf,

    /** Owner only: give or take the coach tier (billing off). */
    async setCoach(
      ownerId: string,
      email: string,
      coach: boolean,
    ): Promise<Refused | { userId: string; tier: string }> {
      if ((await tierOf(ownerId)) !== "owner")
        return refused(403, "owner-only", "Only the instance owner can do this.");
      const user = (
        await pool.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email) = lower($1)', [email])
      ).rows[0];
      if (!user)
        return refused(404, "no-user", "No account has this email. The person must sign in once first.");
      const current = await tierOf(user.id);
      if (current === "owner") return refused(409, "owner", "The owner can coach already.");
      const tier = coach ? "coach" : "plus";
      const now = new Date().toISOString();
      await pool.query(
        "INSERT INTO entitlements (id, user_id, tier, source, created_at, updated_at) VALUES ($1, $2, $3, 'instance_owner', $4, $4)",
        [uuidv7(), user.id, tier, now],
      );
      await audit(ownerId, coach ? "grant_coach" : "remove_coach", user.id);
      return { userId: user.id, tier };
    },

    async invite(coachId: string) {
      const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
      const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
      const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000);
      await pool.query(
        "INSERT INTO coach_invites (id, coach_id, code_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, now())",
        [uuidv7(), coachId, hash(code), expires.toISOString()],
      );
      return { code, expiresAt: expires.toISOString() };
    },

    /** The coach's name for an invite code, so the client knows who they connect to. */
    async preview(code: string): Promise<Refused | { coachName: string }> {
      const inv = (
        await pool.query<{ coach_id: string }>(
          "SELECT coach_id FROM coach_invites WHERE code_hash = $1 AND used_by IS NULL AND expires_at > now()",
          [hash(code)],
        )
      ).rows[0];
      if (!inv) return refused(404, "bad-code", "This code is not valid. It is used, expired or mistyped.");
      return { coachName: await nameOf(inv.coach_id) };
    },

    /** The client accepts an invite with the scopes they pick. The link syncs to their phone. */
    async accept(
      clientId: string,
      code: string,
      scopes: CoachScope[],
    ): Promise<Refused | { linkId: string; coachName: string }> {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const inv = (
          await c.query<{ id: string; coach_id: string }>(
            "SELECT id, coach_id FROM coach_invites WHERE code_hash = $1 AND used_by IS NULL AND expires_at > now() FOR UPDATE",
            [hash(code)],
          )
        ).rows[0];
        if (!inv) {
          await c.query("ROLLBACK");
          return refused(404, "bad-code", "This code is not valid. It is used, expired or mistyped.");
        }
        if (inv.coach_id === clientId) {
          await c.query("ROLLBACK");
          return refused(409, "self", "You cannot be your own coach.");
        }
        const existing = await c.query(
          "SELECT 1 FROM coach_links WHERE coach_id = $1 AND client_id = $2 AND status = 'active' AND deleted_at IS NULL",
          [inv.coach_id, clientId],
        );
        if (existing.rowCount) {
          await c.query("ROLLBACK");
          return refused(409, "linked", "This coach is already your coach.");
        }
        const coachName = await nameOf(inv.coach_id);
        const linkId = uuidv7();
        const now = new Date().toISOString();
        await c.query(
          `INSERT INTO coach_links (id, user_id, coach_id, client_id, coach_name, scopes, status, auto_apply, created_at, updated_at)
           VALUES ($1, $2, $3, $2, $4, $5, 'active', 0, $6, $6)`,
          [linkId, clientId, inv.coach_id, coachName, JSON.stringify(scopes), now],
        );
        await c.query("UPDATE coach_invites SET used_by = $1 WHERE id = $2", [clientId, inv.id]);
        await c.query("COMMIT");
        await audit(clientId, "accept_invite", inv.coach_id);
        return { linkId, coachName };
      } catch (e) {
        await c.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },

    /** The client list, most attention first. One audit row per client read. */
    async clients(coachId: string) {
      const links = (
        await pool.query<{ client_id: string }>(
          "SELECT client_id FROM coach_links WHERE coach_id = $1 AND status = 'active' AND deleted_at IS NULL",
          [coachId],
        )
      ).rows;
      const out = [];
      for (const { client_id } of links) {
        const link = await access(coachId, client_id, "list");
        if (isRefused(link)) continue;
        const data = link.scopes.includes("training") ? await ai.snapshot(client_id, new Date()) : undefined;
        const pending = link.scopes.includes("training")
          ? Number(
              (
                await pool.query<{ n: string }>(
                  "SELECT count(*) AS n FROM ai_proposals WHERE user_id = $1 AND status = 'pending' AND deleted_at IS NULL",
                  [client_id],
                )
              ).rows[0]?.n ?? 0,
            )
          : 0;
        const thread = await messages(link.id);
        const lastCoach = thread.findLast((m) => m.author_id === coachId)?.created_at ?? "";
        const unread = thread.filter((m) => m.author_id !== coachId && m.created_at > lastCoach).length;
        out.push({
          clientId: client_id,
          name: await nameOf(client_id),
          scopes: link.scopes,
          attention: attention(data, link.scopes, pending, unread),
        });
      }
      return out.sort((a, b) => b.attention.score - a.attention.score);
    },

    /** One client: only the granted scopes. */
    async client(coachId: string, clientId: string) {
      const link = await access(coachId, clientId, "read");
      if (isRefused(link)) return link;
      const data = await ai.snapshot(clientId, new Date());
      const has = (s: CoachScope) => link.scopes.includes(s);
      const today = data?.input.today;
      return {
        clientId,
        name: await nameOf(clientId),
        scopes: link.scopes,
        ...(data && has("training")
          ? {
              training: {
                summary: await read(data, "get_sessions", { from: addDays(today ?? "", -27) }),
                sessions: sessionLog(data, 55),
                comments: (
                  await pool.query(
                    "SELECT id, target_type, target_id, body, created_at FROM comments WHERE user_id = $1 AND author_id = $2 AND deleted_at IS NULL ORDER BY created_at",
                    [clientId, coachId],
                  )
                ).rows,
                ladders: await read(data, "get_progress_state"),
                checkins: await read(data, "get_checkins"),
                tests: await read(data, "get_tests"),
                plan: await read(data, "get_plan"),
                reviews: await read(data, "list_reviews"),
                cards: (
                  await pool.query(
                    "SELECT id, source, change, validation, status, approved_by, created_at FROM ai_proposals WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 30",
                    [clientId],
                  )
                ).rows.map((r) => ({
                  ...r,
                  change: JSON.parse(r.change ?? "null"),
                  validation: JSON.parse(r.validation ?? "[]"),
                })),
              },
            }
          : {}),
        ...(data && has("food") ? { food: await read(data, "get_food_summary") } : {}),
        ...(data && has("body") ? { body: await read(data, "get_weight_trend") } : {}),
        ...(data ? {} : { note: "The client has no plan yet." }),
      };
    },

    /** The coach's own plan change: a card on the client's phone. */
    async change(coachId: string, clientId: string, change: PlanChange, why: string) {
      const link = await access(coachId, clientId, "propose", "training");
      if (isRefused(link)) return link;
      const data = await ai.snapshot(clientId, new Date());
      if (!data) return refused(409, "no-plan", "The client has no plan yet.");
      const v = validateProposal(data.input, change);
      if (!v.ok) return refused(409, "refused", v.reason.text);
      const id = uuidv7();
      const now = new Date().toISOString();
      await pool.query(
        `INSERT INTO ai_proposals (id, user_id, source, change, validation, status, approved_by, created_at, updated_at)
         VALUES ($1, $2, 'coach', $3, $4, 'pending', $5, $6, $6)`,
        [id, clientId, JSON.stringify({ ...change, why }), JSON.stringify(v.reasons), coachId, now],
      );
      await push.send(clientId, "Your coach proposes a plan change");
      return { id, reasons: v.reasons };
    },

    /** Approve or reject a pending AI proposal. Approval keeps the card; the client decides. */
    async decide(coachId: string, clientId: string, proposalId: string, decision: "approve" | "reject") {
      const link = await access(coachId, clientId, "decide", "training");
      if (isRefused(link)) return link;
      const now = new Date().toISOString();
      const r =
        decision === "reject"
          ? await pool.query(
              "UPDATE ai_proposals SET status = 'rejected', updated_at = $3 WHERE id = $1 AND user_id = $2 AND status = 'pending' AND source <> 'coach'",
              [proposalId, clientId, now],
            )
          : await pool.query(
              "UPDATE ai_proposals SET approved_by = $3, updated_at = $4 WHERE id = $1 AND user_id = $2 AND status = 'pending' AND source <> 'coach'",
              [proposalId, clientId, coachId, now],
            );
      if (!r.rowCount) return refused(404, "no-card", "No pending AI card with this id for this client.");
      if (decision === "approve") await push.send(clientId, "Your coach approves a plan change");
      return { decision };
    },

    async thread(coachId: string, clientId: string) {
      const link = await access(coachId, clientId, "messages");
      if (isRefused(link)) return link;
      return { messages: await messages(link.id) };
    },

    async message(coachId: string, clientId: string, body: string) {
      const link = await access(coachId, clientId, "message");
      if (isRefused(link)) return link;
      const id = uuidv7();
      const now = new Date().toISOString();
      await pool.query(
        "INSERT INTO messages (id, user_id, coach_link_id, author_id, body, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)",
        [id, clientId, link.id, coachId, body, now],
      );
      await push.send(clientId, "New message from your coach");
      return { id };
    },

    /** A comment on one of the client's sessions or sets. */
    async comment(coachId: string, clientId: string, c: z.infer<typeof CommentBody>) {
      const link = await access(coachId, clientId, "comment", "training");
      if (isRefused(link)) return link;
      const table = c.targetType === "session" ? "sessions" : "sets";
      const owned = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND user_id = $2`, [
        c.targetId,
        clientId,
      ]);
      if (!owned.rowCount)
        return refused(404, "no-target", `No ${c.targetType} with this id for this client.`);
      const id = uuidv7();
      const now = new Date().toISOString();
      await pool.query(
        "INSERT INTO comments (id, user_id, target_type, target_id, author_id, body, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)",
        [id, clientId, c.targetType, c.targetId, coachId, c.body, now],
      );
      await push.send(clientId, "Your coach commented");
      return { id };
    },
  };
}

export type Coach = ReturnType<typeof createCoach>;
