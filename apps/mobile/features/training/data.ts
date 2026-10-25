// SPDX-License-Identifier: AGPL-3.0-or-later
// Training data on the local database: maps rows to engine types and back.
// The engine sets every number; this file only stores what it returns.
import type { Joint, Severity } from "@vee/catalogue";
import {
  type DayType,
  ENGINE_VERSION,
  type EngineInput,
  emptyHistory,
  type Flag,
  GOAL_TEMPLATES,
  generatePlan,
  type KitItem,
  type Profile,
  type Programme,
  type ProgressState,
  rebuildProgress,
  type SessionRecord,
  type TestItem,
  type TestResult,
} from "@vee/engine";
import {
  body_metrics,
  flags as flagsTable,
  kit_items,
  profiles,
  programmes,
  progress_state,
  session_templates,
  sessions as sessionsTable,
  template_items,
  test_results,
  tests,
  uuidv7,
} from "@vee/schema";
import {
  ENGINE_TABLES,
  type EngineRows,
  programmeRows,
  progressRows,
  toEngineInput,
  toProgramme,
} from "@vee/schema/engine";
import { and, eq, isNull } from "drizzle-orm";
import { db, powersync } from "@/features/db/database";
import { localDate } from "@/features/food/data";
import { catalogue } from "./catalogue";

const now = () => new Date().toISOString();
const stamps = () => ({ created_at: now(), updated_at: now() });
const json = <T>(s: string | null): T | undefined => (s ? (JSON.parse(s) as T) : undefined);

export type Onboarding = {
  body: { heightCm: number; weightKg: number; birthYear: number; sex: Profile["sex"]; waistCm?: number };
  kit: KitItem[];
  time: { sessionsPerWeek: number; minutesPerSession: number; timeOfDay: "morning" | "midday" | "evening" };
  goalTemplate: string;
  flags: { joint: Joint; severity: Severity }[];
  /** Undefined when the user skips the baseline test. */
  baseline?: { item: TestItem; value: number; loadKg?: number }[];
};

export async function hasProfile(): Promise<boolean> {
  const r = await db.select({ id: profiles.id }).from(profiles).where(isNull(profiles.deleted_at)).limit(1);
  return r.length > 0;
}

/** Every row the engine reads, from the local database. */
async function engineRows(): Promise<EngineRows> {
  const rows = {} as Record<(typeof ENGINE_TABLES)[number], unknown[]>;
  for (const name of ENGINE_TABLES) rows[name] = await powersync.getAll(`SELECT * FROM "${name}"`);
  return rows as unknown as EngineRows;
}

export async function readProgramme(): Promise<(Programme & { id: string }) | undefined> {
  const [p, t, i] = await Promise.all(
    (["programmes", "session_templates", "template_items"] as const).map((n) =>
      powersync.getAll(`SELECT * FROM "${n}"`),
    ),
  );
  return toProgramme(
    p as EngineRows["programmes"],
    t as EngineRows["session_templates"],
    i as EngineRows["template_items"],
  );
}

/** The engine input from the local database. Undefined before onboarding. */
export async function readEngineInput(today = localDate()): Promise<EngineInput | undefined> {
  return toEngineInput(await engineRows(), { catalogue, today, engineVersion: ENGINE_VERSION });
}

/**
 * Saves the onboarding answers and the baseline test, places each ladder, and
 * stores the first programme. One transaction: the app never has half a setup.
 */
export async function completeOnboarding(o: Onboarding, today = localDate()): Promise<Programme> {
  const goal = GOAL_TEMPLATES[o.goalTemplate];
  if (!goal) throw new Error(`unknown goal template ${o.goalTemplate}`);
  const kit = o.kit.map((k) => ({ ...k, id: k.id || uuidv7() }));
  const flags: Flag[] = o.flags.map((f) => ({ ...f, activeFrom: today }));
  const baseline: TestResult[] = (o.baseline ?? []).map((r) => ({ date: today, ...r }));
  const profile: Profile = {
    heightCm: o.body.heightCm,
    birthYear: o.body.birthYear,
    sex: o.body.sex,
    minutesPerSession: o.time.minutesPerSession,
    goalTemplate: o.goalTemplate,
  };
  const input: EngineInput = {
    profile,
    kit,
    flags,
    catalogue,
    history: { ...emptyHistory(), tests: baseline },
    today,
    engineVersion: ENGINE_VERSION,
  };
  const progress = rebuildProgress(input);
  const plan = generatePlan({ ...input, history: { ...input.history, progress } }, goal, 1);

  await db.transaction(async (tx) => {
    await tx.insert(profiles).values({
      id: uuidv7(),
      height_cm: profile.heightCm,
      birth_year: profile.birthYear,
      sex: profile.sex,
      units: "metric",
      locale: "en",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      goal_template: o.goalTemplate,
      minutes_per_session: o.time.minutesPerSession,
      sessions_per_week: o.time.sessionsPerWeek,
      time_of_day: o.time.timeOfDay,
      ...stamps(),
    });
    const at = now();
    const metrics = [
      { kind: "weight", value: o.body.weightKg },
      ...(o.body.waistCm === undefined ? [] : [{ kind: "waist", value: o.body.waistCm }]),
    ];
    for (const m of metrics)
      await tx
        .insert(body_metrics)
        .values({ id: uuidv7(), ...m, source: "manual", measured_at: at, ...stamps() });
    for (const k of kit)
      await tx
        .insert(kit_items)
        .values({ id: k.id, kind: k.kind, count: k.count, params: JSON.stringify(k.params), ...stamps() });
    for (const f of flags)
      await tx.insert(flagsTable).values({
        id: uuidv7(),
        joint: f.joint,
        severity: f.severity,
        active_from: f.activeFrom,
        ...stamps(),
      });
    if (baseline.length > 0) {
      const testId = uuidv7();
      await tx.insert(tests).values({ id: testId, month: today.slice(0, 7), date: today, ...stamps() });
      for (const r of baseline)
        await tx.insert(test_results).values({
          id: uuidv7(),
          test_id: testId,
          item: r.item,
          value: r.value,
          load_kg: r.loadKg ?? null,
          ...stamps(),
        });
    }
    for (const row of progressRows(progress, { newId: uuidv7, now: at }))
      await tx.insert(progress_state).values(row);
    const rows = programmeRows(plan, { newId: uuidv7, now: at });
    for (const row of rows.programmes) await tx.insert(programmes).values(row);
    for (const row of rows.session_templates) await tx.insert(session_templates).values(row);
    for (const row of rows.template_items) await tx.insert(template_items).values(row);
  });
  return plan;
}

/**
 * Stores a changed programme (an accepted proposal): the old days and items
 * are soft-deleted and the new ones written, so the change syncs as rows.
 */
export async function saveProgramme(plan: Programme & { id: string }): Promise<void> {
  const at = now();
  const rows = programmeRows(plan, { newId: uuidv7, now: at, programmeId: plan.id });
  const oldDays = await db
    .select({ id: session_templates.id })
    .from(session_templates)
    .where(and(eq(session_templates.programme_id, plan.id), isNull(session_templates.deleted_at)));
  await db.transaction(async (tx) => {
    for (const d of oldDays) {
      await tx
        .update(template_items)
        .set({ deleted_at: at, updated_at: at })
        .where(and(eq(template_items.template_id, d.id), isNull(template_items.deleted_at)));
      await tx
        .update(session_templates)
        .set({ deleted_at: at, updated_at: at })
        .where(eq(session_templates.id, d.id));
    }
    await tx
      .update(programmes)
      .set({ early_deload_from: plan.earlyDeloadFrom ?? null, updated_at: at })
      .where(eq(programmes.id, plan.id));
    for (const row of rows.session_templates) await tx.insert(session_templates).values(row);
    for (const row of rows.template_items) await tx.insert(template_items).values(row);
  });
}
