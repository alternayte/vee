// SPDX-License-Identifier: AGPL-3.0-or-later
// Data rights: export, import and account deletion (SDD "Security and privacy").
import { type ImportFormat, importRows, parseImport } from "@vee/importers";
import { syncedTables, uuidv7 } from "@vee/schema";
import { exportJson, setsCsv } from "@vee/schema/export";
import { sql } from "drizzle-orm";
import type { Db } from "./db";

export const EXPORT_HOURS = 24;
/** Deleting an account needs a sign-in in the last 10 minutes (passkey or magic link). */
export const FRESH_SESSION_MINUTES = 10;

export async function buildExport(db: Db, userId: string): Promise<{ json: string; csv: string }> {
  const tables: Record<string, unknown[]> = {};
  for (const name of Object.keys(syncedTables)) {
    const r = await db.execute(
      sql`SELECT * FROM ${sql.identifier(name)} WHERE user_id = ${userId} ORDER BY id`,
    );
    tables[name] = r.rows;
  }
  return { json: exportJson(tables, userId), csv: setsCsv((tables.sets ?? []) as Record<string, unknown>[]) };
}

export async function createExport(db: Db, userId: string): Promise<string> {
  const id = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const { json, csv } = await buildExport(db, userId);
  const expires = new Date(Date.now() + EXPORT_HOURS * 3600_000).toISOString();
  await db.execute(
    sql`INSERT INTO exports (id, user_id, json, csv, expires_at) VALUES (${id}, ${userId}, ${json}, ${csv}, ${expires})`,
  );
  return id;
}

export async function readExport(db: Db, id: string): Promise<{ json: string; csv: string } | undefined> {
  if (!/^[0-9a-f]{64}$/.test(id)) return undefined;
  const r = await db.execute<{ json: string; csv: string }>(
    sql`SELECT json, csv FROM exports WHERE id = ${id} AND expires_at > now()`,
  );
  return r.rows[0];
}

export class ImportError extends Error {}

export async function importCsv(db: Db, userId: string, format: ImportFormat, text: string) {
  let parsed: ReturnType<typeof parseImport>;
  try {
    parsed = parseImport(text);
  } catch (e) {
    throw new ImportError(e instanceof Error ? e.message : String(e));
  }
  if (parsed.format !== format)
    throw new ImportError(`This file is a ${parsed.format} export, not ${format}.`);
  const rows = importRows(parsed, {
    userId,
    now: new Date().toISOString(),
    newId: uuidv7,
    customId: (slug) => `${userId}:${slug}`,
  });
  await db.transaction(async (tx) => {
    for (const c of rows.custom_exercises) {
      await tx.execute(sql`INSERT INTO custom_exercises (id, user_id, exercise, created_at, updated_at)
        VALUES (${c.id}, ${c.user_id}, ${c.exercise}, ${c.created_at}, ${c.updated_at}) ON CONFLICT (id) DO NOTHING`);
    }
    for (const x of rows.sessions) {
      await tx.execute(sql`INSERT INTO sessions (id, user_id, kind, status, date, created_at, updated_at)
        VALUES (${x.id}, ${x.user_id}, ${x.kind}, ${x.status}, ${x.date}, ${x.created_at}, ${x.updated_at})`);
    }
    for (const x of rows.sets) {
      await tx.execute(sql`INSERT INTO sets (id, user_id, session_id, exercise_id, reps, seconds, load_kg, effort, logged_at, created_at, updated_at)
        VALUES (${x.id}, ${x.user_id}, ${x.session_id}, ${x.exercise_id}, ${x.reps}, ${x.seconds}, ${x.load_kg}, ${x.effort}, ${x.logged_at}, ${x.created_at}, ${x.updated_at})`);
    }
  });
  return {
    sessions: rows.sessions.length,
    sets: rows.sets.length,
    customExercises: parsed.customExercises.length,
  };
}

/** Removes every row of the user and the auth records. Only the audit entry stays. */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const name of Object.keys(syncedTables)) {
      await tx.execute(sql`DELETE FROM ${sql.identifier(name)} WHERE user_id = ${userId}`);
    }
    await tx.execute(sql`DELETE FROM exports WHERE user_id = ${userId}`);
    await tx.execute(sql`DELETE FROM ai_usage WHERE user_id = ${userId}`);
    await tx.execute(sql`DELETE FROM "session" WHERE "userId" = ${userId}`);
    await tx.execute(sql`DELETE FROM "account" WHERE "userId" = ${userId}`);
    await tx.execute(sql`DELETE FROM "passkey" WHERE "userId" = ${userId}`);
    await tx.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
    await tx.execute(sql`INSERT INTO audit_log (id, actor_id, action, target, at)
      VALUES (${uuidv7()}, ${userId}, 'account.delete', ${userId}, now())`);
  });
}
