// SPDX-License-Identifier: AGPL-3.0-or-later
// Body data on the phone (PRD "Body and progress"): weigh-ins and
// measurements, the monthly test, destinations and progress photos. A
// weigh-in also runs N1, so the food targets follow the weight trend.
import type { Criterion, TestItem } from "@vee/engine";
import { adjustTargets, type FoodTargets, type WeighIn } from "@vee/nutrition";
import { body_metrics, destinations, food_targets, photos, test_results, tests, uuidv7 } from "@vee/schema";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Directory, File, Paths } from "expo-file-system";
import { db } from "@/features/db/database";
import { localDate, readTargets } from "@/features/food/data";
import { recompute } from "@/features/plan/history";

const now = () => new Date().toISOString();
const stamps = () => ({ created_at: now(), updated_at: now() });

export const MEASURES = ["waist", "chest", "shoulder", "arm"] as const;
export type Measure = (typeof MEASURES)[number];

export async function weighIns(): Promise<WeighIn[]> {
  const rows = await db
    .select({ at: body_metrics.measured_at, kg: body_metrics.value })
    .from(body_metrics)
    .where(and(eq(body_metrics.kind, "weight"), isNull(body_metrics.deleted_at)))
    .orderBy(asc(body_metrics.measured_at));
  return rows.filter((r) => r.kg !== null).map((r) => ({ date: r.at.slice(0, 10), kg: r.kg as number }));
}

/**
 * Runs N1 on the weigh-ins: one cupped hand of carbs more when the 3-week
 * trend is flat, one fewer when it is fast. The new targets replace the old
 * row, with the rule as the reason.
 */
export async function applyN1(today = localDate()): Promise<FoodTargets | undefined> {
  const row = (await db.select().from(food_targets).where(isNull(food_targets.deleted_at)).limit(1))[0];
  const perMoment = readTargets(row);
  if (!row || !perMoment) return undefined;
  const current: FoodTargets = {
    perMoment,
    ...(row.adjusted_at ? { adjustedAt: row.adjusted_at } : {}),
    reason: row.reason ? JSON.parse(row.reason) : { ruleId: "", inputs: {}, text: "" },
  };
  const a = adjustTargets(current, await weighIns(), today);
  if (!a.changed) return undefined;
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(food_targets).set({ deleted_at: at, updated_at: at }).where(eq(food_targets.id, row.id));
    await tx.insert(food_targets).values({
      id: uuidv7(),
      per_moment: JSON.stringify(a.targets.perMoment),
      adjusted_at: a.targets.adjustedAt ?? today,
      reason: JSON.stringify(a.reason),
      ...stamps(),
    });
  });
  return a.targets;
}

export async function addMetric(
  kind: "weight" | Measure,
  value: number,
  source: "manual" | "health_connect" = "manual",
  at = now(),
) {
  await db.insert(body_metrics).values({ id: uuidv7(), kind, value, source, measured_at: at, ...stamps() });
  if (kind === "weight") await applyN1();
}

export async function removeMetric(id: string) {
  await db.update(body_metrics).set({ deleted_at: now(), updated_at: now() }).where(eq(body_metrics.id, id));
}

/** A monthly test. The ladders are rebuilt, so a result can place a rung (at most 2 up at once). */
export async function saveTest(
  results: { item: TestItem; value: number; loadKg?: number }[],
  date = localDate(),
) {
  const testId = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(tests).values({ id: testId, month: date.slice(0, 7), date, ...stamps() });
    for (const r of results)
      await tx.insert(test_results).values({
        id: uuidv7(),
        test_id: testId,
        item: r.item,
        value: r.value,
        load_kg: r.loadKg ?? null,
        ...stamps(),
      });
  });
  const waist = results.find((r) => r.item === "waist");
  if (waist) await addMetric("waist", waist.value);
  await recompute();
}

export async function addDestination(name: string, criteria: Criterion[]) {
  await db
    .insert(destinations)
    .values({ id: uuidv7(), name, criteria: JSON.stringify(criteria), ...stamps() });
}

export async function removeDestination(id: string) {
  await db.update(destinations).set({ deleted_at: now(), updated_at: now() }).where(eq(destinations.id, id));
}

// ── Photos: in app-private storage only (SDD "Photos"). Android file-based
// encryption covers them at rest; they are not in the gallery and never go to
// a model. Photo sync is B20.

export const POSES = ["front", "side", "back"] as const;
export type Pose = (typeof POSES)[number];

const photoDir = () => new Directory(Paths.document, "photos");

export const photoFile = (id: string) => new File(photoDir(), `${id}.jpg`);

/** Moves a captured photo into the app's own storage and records it. */
export async function savePhoto(pose: Pose, sourceUri: string, takenAt = now()): Promise<string> {
  const dir = photoDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const id = uuidv7();
  new File(sourceUri).move(photoFile(id));
  await db.insert(photos).values({ id, pose, taken_at: takenAt, sync_enabled: 0, ...stamps() });
  return id;
}

export async function removePhoto(id: string) {
  const f = photoFile(id);
  if (f.exists) f.delete();
  await db.update(photos).set({ deleted_at: now(), updated_at: now() }).where(eq(photos.id, id));
}

export const photoRows = () =>
  db.select().from(photos).where(isNull(photos.deleted_at)).orderBy(desc(photos.taken_at));
