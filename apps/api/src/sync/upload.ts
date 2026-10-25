// SPDX-License-Identifier: AGPL-3.0-or-later
// POST /sync/upload (SDD "Write path"). Each operation is checked against the
// table's schema and the caller's ownership. Valid operations apply in one
// transaction; each refused operation comes back with a typed code, so the
// app can keep the row and show it in Settings → Sync. Nothing is dropped
// without a code (I5).
import { syncedTables } from "@vee/schema";
import { sql } from "drizzle-orm";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { COACH_SCOPES } from "../coach";
import type { Db } from "../db";

/** Tables only the server writes. Clients read them through sync. */
export const READ_ONLY_TABLES = new Set(["entitlements", "reviews", "comments"]);

/**
 * Tables the server creates and the client may only partly change. A client
 * cannot make a coach link (only an invite can), cannot forge a coach card or
 * a coach's approval, and can change only these columns.
 */
const PATCH_ONLY: Record<
  string,
  { columns: Set<string>; check?: (d: Record<string, unknown>) => string | undefined }
> = {
  coach_links: {
    columns: new Set(["scopes", "status", "auto_apply", "updated_at"]),
    check: (d) => {
      if (d.status !== undefined && d.status !== "revoked") return "a client can only set status to revoked";
      if (d.scopes !== undefined) {
        const s = JSON.parse(String(d.scopes ?? "[]")) as unknown;
        if (!Array.isArray(s) || s.some((x) => !COACH_SCOPES.includes(x as never))) return "unknown scope";
      }
      if (d.auto_apply !== undefined && d.auto_apply !== 0 && d.auto_apply !== 1)
        return "auto_apply is 0 or 1";
      return undefined;
    },
  },
  ai_proposals: {
    columns: new Set(["status", "updated_at"]),
    check: (d) =>
      d.status !== undefined && !["accepted", "rejected", "refused"].includes(String(d.status))
        ? "status is accepted, rejected or refused"
        : undefined,
  },
};

export type RejectCode =
  | "unknown-table"
  | "read-only"
  | "invalid"
  | "forbidden"
  | "forbidden-owner"
  | "not-found";

export type Rejected = { index: number; table: string; id: string; code: RejectCode; message: string };

export const BatchSchema = z.object({
  batch: z
    .array(
      z.object({
        op: z.enum(["PUT", "PATCH", "DELETE"]),
        table: z.string().min(1).max(64),
        id: z.string().min(1).max(64),
        data: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(1000),
});

export type Op = z.infer<typeof BatchSchema>["batch"][number];

type TableRules = { columns: string[]; put: z.ZodType; patch: z.ZodType };

function columnSchema(type: string): z.ZodType {
  if (type === "integer") return z.number().int();
  if (type === "real") return z.number();
  return z.string().max(1_000_000);
}

function rulesFor(t: SQLiteTable): TableRules {
  const cols = getTableConfig(t).columns.filter((c) => c.name !== "id");
  const put: Record<string, z.ZodType> = {};
  const patch: Record<string, z.ZodType> = {};
  for (const c of cols) {
    const base = columnSchema(c.getSQLType());
    const required = c.notNull && c.name !== "user_id";
    put[c.name] = required ? base : base.nullable().optional();
    patch[c.name] = c.notNull ? base.optional() : base.nullable().optional();
  }
  return { columns: cols.map((c) => c.name), put: z.object(put).strict(), patch: z.object(patch).strict() };
}

const RULES: Record<string, TableRules> = Object.fromEntries(
  Object.entries(syncedTables).map(([name, t]) => [name, rulesFor(t)]),
);

type Valid = { index: number; op: Op; data: Record<string, unknown> };

function check(op: Op, index: number, userId: string): Valid | Rejected {
  const reject = (code: RejectCode, message: string): Rejected => ({
    index,
    table: op.table,
    id: op.id,
    code,
    message,
  });
  const rules = RULES[op.table];
  if (!rules) return reject("unknown-table", `no synced table ${op.table}`);
  if (READ_ONLY_TABLES.has(op.table)) return reject("read-only", `${op.table} is written by the server only`);
  const only = PATCH_ONLY[op.table];
  if (only && op.op !== "PATCH")
    return reject("read-only", `${op.table}: the server creates and removes rows`);
  if (op.op === "DELETE") return { index, op, data: {} };
  const parsed = (op.op === "PUT" ? rules.put : rules.patch).safeParse(op.data ?? {});
  if (!parsed.success)
    return reject("invalid", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const data = parsed.data as Record<string, unknown>;
  if (only) {
    const extra = Object.keys(data).filter((c) => !only.columns.has(c));
    if (extra.length) return reject("read-only", `${op.table}: a client cannot change ${extra.join(", ")}`);
    const bad = only.check?.(data);
    if (bad) return reject("invalid", bad);
  }
  if (data.user_id !== undefined && data.user_id !== null && data.user_id !== userId) {
    return reject("forbidden-owner", "user_id must be the caller");
  }
  return { index, op, data: { ...data, user_id: userId } };
}

export async function applyBatch(
  db: Db,
  userId: string,
  ops: Op[],
): Promise<{ applied: number; rejected: Rejected[] }> {
  const rejected: Rejected[] = [];
  const valid: Valid[] = [];
  ops.forEach((op, i) => {
    const r = check(op, i, userId);
    if ("code" in r) rejected.push(r);
    else valid.push(r);
  });

  let applied = 0;
  await db.transaction(async (tx) => {
    for (const v of valid) {
      const t = sql.identifier(v.op.table);
      const owner = await tx.execute<{ user_id: string | null }>(
        sql`SELECT user_id FROM ${t} WHERE id = ${v.op.id} FOR UPDATE`,
      );
      const row = owner.rows[0];
      const reject = (code: RejectCode, message: string) =>
        rejected.push({ index: v.index, table: v.op.table, id: v.op.id, code, message });
      if (row && row.user_id !== userId) {
        reject("forbidden", "the row belongs to another user");
        continue;
      }
      if (!row && v.op.op !== "PUT") {
        reject("not-found", "no row with this id");
        continue;
      }
      if (v.op.table === "messages") {
        const bad = await messageGuard(tx, v, userId, Boolean(row));
        if (bad) {
          reject("forbidden", bad);
          continue;
        }
      }
      try {
        // A savepoint per operation: a refused write does not undo the others.
        await tx.transaction(async (sp) => {
          if (v.op.op === "DELETE") {
            await sp.execute(sql`DELETE FROM ${t} WHERE id = ${v.op.id} AND user_id = ${userId}`);
            return;
          }
          const cols = Object.keys(v.data);
          if (v.op.op === "PATCH") {
            const sets = sql.join(
              cols.map((c) => sql`${sql.identifier(c)} = ${v.data[c]}`),
              sql`, `,
            );
            await sp.execute(sql`UPDATE ${t} SET ${sets} WHERE id = ${v.op.id} AND user_id = ${userId}`);
            return;
          }
          const names = sql.join([sql.identifier("id"), ...cols.map((c) => sql.identifier(c))], sql`, `);
          const values = sql.join([sql`${v.op.id}`, ...cols.map((c) => sql`${v.data[c]}`)], sql`, `);
          const updates = sql.join(
            cols.map((c) => sql`${sql.identifier(c)} = EXCLUDED.${sql.identifier(c)}`),
            sql`, `,
          );
          await sp.execute(
            sql`INSERT INTO ${t} (${names}) VALUES (${values}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
          );
        });
        applied++;
      } catch (e) {
        reject("invalid", e instanceof Error ? e.message : String(e));
      }
    }
  });
  rejected.sort((x, y) => x.index - y.index);
  return { applied, rejected };
}

/**
 * A client writes only their own messages, on their own active coach link.
 * Coach messages share the client's user_id (so they sync down) but stay the
 * coach's: the client cannot edit or delete them.
 */
async function messageGuard(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  v: Valid,
  userId: string,
  exists: boolean,
): Promise<string | undefined> {
  if (exists) {
    const r = await tx.execute<{ author_id: string }>(
      sql`SELECT author_id FROM messages WHERE id = ${v.op.id}`,
    );
    if (r.rows[0]?.author_id !== userId) return "only the author can change a message";
    if (v.data.author_id !== undefined && v.data.author_id !== userId) return "author_id must be the caller";
    if (v.data.coach_link_id !== undefined) return "a message cannot move to another link";
    return undefined;
  }
  if (v.data.author_id !== userId) return "author_id must be the caller";
  const link = await tx.execute(
    sql`SELECT 1 FROM coach_links WHERE id = ${String(v.data.coach_link_id)} AND client_id = ${userId} AND status = 'active' AND deleted_at IS NULL`,
  );
  return link.rows.length ? undefined : "no active coach link with this id";
}
