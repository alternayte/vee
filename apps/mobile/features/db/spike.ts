// SPDX-License-Identifier: AGPL-3.0-or-later
// B05 spike: runs every query type the app needs against the real native
// database (CRUD, a watched query, transactions with commit and rollback, the
// upload queue, local-only tables). The dev screen shows the result, and the
// V9 smoke flow checks it.
import type { AbstractPowerSyncDatabase } from "@powersync/common";
import { kit_items, sets, ui_prefs, uuidv7 } from "@vee/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./database";

export type Check = { name: string; ok: boolean; detail: string };

const now = () => new Date().toISOString();

async function check(name: string, fn: () => Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function assert(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

export async function runSpike(db: Db, ps: AbstractPowerSyncDatabase): Promise<Check[]> {
  const kitId = uuidv7();
  const sessionId = uuidv7();
  const out: Check[] = [];

  out.push(
    await check("insert and select", async () => {
      await db.insert(kit_items).values({
        id: kitId,
        kind: "dial_db",
        params: JSON.stringify({ min: 2, max: 24, step: 2 }),
        count: 1,
        created_at: now(),
        updated_at: now(),
      });
      const rows = await db.select().from(kit_items).where(eq(kit_items.id, kitId));
      assert(rows.length === 1 && rows[0]?.kind === "dial_db", `expected 1 dial_db row, got ${rows.length}`);
      return "1 row";
    }),
  );

  out.push(
    await check("update", async () => {
      await db.update(kit_items).set({ count: 2, updated_at: now() }).where(eq(kit_items.id, kitId));
      const row = (await db.select().from(kit_items).where(eq(kit_items.id, kitId)))[0];
      assert(row?.count === 2, `count is ${row?.count}`);
      return "count 2";
    }),
  );

  out.push(
    await check("watched query", async () => {
      const controller = new AbortController();
      const seen: number[] = [];
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`watch saw ${JSON.stringify(seen)}`)), 5000);
        db.watch(
          db
            .select()
            .from(sets)
            .where(and(eq(sets.session_id, sessionId), isNull(sets.deleted_at))),
          {
            onResult: (rows) => {
              seen.push(rows.length);
              if (rows.length === 2) {
                clearTimeout(timer);
                resolve();
              }
            },
            onError: reject,
          },
          { signal: controller.signal },
        );
      });
      for (const reps of [8, 9]) {
        await db.insert(sets).values({
          id: uuidv7(),
          session_id: sessionId,
          exercise_id: "goblet-squat",
          reps,
          effort: "good",
          logged_at: now(),
          created_at: now(),
          updated_at: now(),
        });
      }
      await done;
      controller.abort();
      return `results ${seen.join(" → ")}`;
    }),
  );

  out.push(
    await check("transaction commits", async () => {
      await db.transaction(async (tx) => {
        await tx.update(kit_items).set({ count: 1, updated_at: now() }).where(eq(kit_items.id, kitId));
        await tx.insert(sets).values({
          id: uuidv7(),
          session_id: sessionId,
          exercise_id: "goblet-squat",
          reps: 10,
          effort: "easy",
          logged_at: now(),
          created_at: now(),
          updated_at: now(),
        });
      });
      const n = (await db.select().from(sets).where(eq(sets.session_id, sessionId))).length;
      assert(n === 3, `expected 3 sets, got ${n}`);
      return "3 sets";
    }),
  );

  out.push(
    await check("transaction rolls back", async () => {
      let threw = false;
      try {
        await db.transaction(async (tx) => {
          await tx.insert(sets).values({
            id: uuidv7(),
            session_id: sessionId,
            exercise_id: "goblet-squat",
            reps: 11,
            effort: "good",
            logged_at: now(),
            created_at: now(),
            updated_at: now(),
          });
          throw new Error("rollback");
        });
      } catch {
        threw = true;
      }
      const n = (await db.select().from(sets).where(eq(sets.session_id, sessionId))).length;
      assert(threw && n === 3, `threw=${threw}, sets=${n}`);
      return "still 3 sets";
    }),
  );

  out.push(
    await check("soft delete", async () => {
      await db
        .update(sets)
        .set({ deleted_at: now(), updated_at: now() })
        .where(eq(sets.session_id, sessionId));
      const live = await db
        .select()
        .from(sets)
        .where(and(eq(sets.session_id, sessionId), isNull(sets.deleted_at)));
      assert(live.length === 0, `${live.length} live sets`);
      return "0 live sets";
    }),
  );

  out.push(
    await check("delete", async () => {
      await db.delete(kit_items).where(eq(kit_items.id, kitId));
      const n = (await db.select().from(kit_items).where(eq(kit_items.id, kitId))).length;
      assert(n === 0, `${n} rows`);
      return "0 rows";
    }),
  );

  out.push(
    await check("upload queue holds local writes", async () => {
      const batch = await ps.getCrudBatch(1000);
      const ops = batch?.crud ?? [];
      assert(
        ops.some((op) => op.table === "kit_items" && op.id === kitId),
        `no queued op for kit_items ${kitId}`,
      );
      return `${ops.length} queued ops`;
    }),
  );

  out.push(
    await check("local-only table", async () => {
      const id = uuidv7();
      await db.insert(ui_prefs).values({ id, key: "spike", value: "1" });
      const row = (await db.select().from(ui_prefs).where(eq(ui_prefs.id, id)))[0];
      const batch = await ps.getCrudBatch(1000);
      assert(row?.value === "1", "row not found");
      assert(!(batch?.crud ?? []).some((op) => op.table === "ui_prefs"), "ui_prefs is in the upload queue");
      await db.delete(ui_prefs).where(eq(ui_prefs.id, id));
      return "not queued";
    }),
  );

  return out;
}
