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
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/features/db/database";
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

async function readProfile(): Promise<Profile | undefined> {
  const p = (await db.select().from(profiles).where(isNull(profiles.deleted_at)).limit(1))[0];
  if (!p?.height_cm || !p.birth_year || !p.minutes_per_session || !p.goal_template) return undefined;
  return {
    heightCm: p.height_cm,
    birthYear: p.birth_year,
    sex: p.sex === "female" ? "female" : "male",
    minutesPerSession: p.minutes_per_session,
    goalTemplate: p.goal_template,
  };
}

async function readKit(): Promise<KitItem[]> {
  const rows = await db.select().from(kit_items).where(isNull(kit_items.deleted_at));
  return rows.map(
    (r) => ({ id: r.id, kind: r.kind, count: r.count ?? 1, params: json(r.params) ?? {} }) as KitItem,
  );
}

async function readFlags(): Promise<Flag[]> {
  const rows = await db.select().from(flagsTable).where(isNull(flagsTable.deleted_at));
  return rows.map((r) => ({
    joint: r.joint as Joint,
    severity: r.severity as Severity,
    activeFrom: r.active_from,
    ...(r.active_to ? { activeTo: r.active_to } : {}),
  }));
}

async function readTests(): Promise<TestResult[]> {
  const rows = await db
    .select({
      date: tests.date,
      item: test_results.item,
      value: test_results.value,
      loadKg: test_results.load_kg,
    })
    .from(test_results)
    .innerJoin(tests, eq(tests.id, test_results.test_id))
    .where(and(isNull(test_results.deleted_at), isNull(tests.deleted_at)));
  return rows
    .filter((r) => r.value !== null)
    .map((r) => ({
      date: r.date,
      item: r.item as TestItem,
      value: r.value as number,
      ...(r.loadKg !== null ? { loadKg: r.loadKg } : {}),
    }));
}

async function readProgress(): Promise<ProgressState[]> {
  const rows = await db.select().from(progress_state).where(isNull(progress_state.deleted_at));
  return rows.map((r) => {
    const s: ProgressState = { family: r.family, rung: r.rung ?? 1 };
    if (r.exercise_id) s.exerciseId = r.exercise_id;
    if (r.load_kg !== null) s.loadKg = r.load_kg;
    if (r.band) s.band = JSON.parse(r.band);
    if (r.hold_s !== null) s.holdS = r.hold_s;
    if (r.tempo_stage !== null) s.tempoStage = r.tempo_stage as ProgressState["tempoStage"];
    if (r.rep_override) s.repOverride = JSON.parse(r.rep_override);
    if (r.best !== null) s.best = r.best;
    if (r.seen !== null) s.seen = r.seen;
    if (r.streaks) s.streaks = JSON.parse(r.streaks);
    return s;
  });
}

async function readSessions(): Promise<SessionRecord[]> {
  const rows = await db.select().from(sessionsTable).where(isNull(sessionsTable.deleted_at));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as SessionRecord["kind"],
    status: r.status as SessionRecord["status"],
    date: r.date,
    ...(r.day_type ? { dayType: r.day_type as DayType } : {}),
    ...(r.readiness_mode ? { readinessMode: r.readiness_mode as SessionRecord["readinessMode"] } : {}),
    ...(r.deload !== null ? { deload: r.deload === 1 } : {}),
  }));
}

export async function readProgramme(): Promise<(Programme & { id: string }) | undefined> {
  const p = (
    await db
      .select()
      .from(programmes)
      .where(and(eq(programmes.active, 1), isNull(programmes.deleted_at)))
      .limit(1)
  )[0];
  if (!p) return undefined;
  const days = await db
    .select()
    .from(session_templates)
    .where(and(eq(session_templates.programme_id, p.id), isNull(session_templates.deleted_at)))
    .orderBy(asc(session_templates.order));
  const templates: Programme["templates"] = [];
  for (const d of days) {
    const items = await db
      .select()
      .from(template_items)
      .where(and(eq(template_items.template_id, d.id), isNull(template_items.deleted_at)))
      .orderBy(asc(template_items.order));
    templates.push({
      dayType: d.day_type as DayType,
      name: d.name ?? d.day_type,
      estimatedMinutes: d.estimated_minutes ?? 0,
      reasons: json(d.reasons) ?? [],
      items: items.map((i) => ({
        order: i.order ?? 0,
        family: i.family,
        exerciseId: i.exercise_id,
        role: i.role === "main" ? "main" : "accessory",
        sets: i.sets ?? 0,
        target: {
          unit: i.unit === "seconds" ? "seconds" : "reps",
          low: i.rep_low ?? 0,
          high: i.rep_high ?? 0,
        },
        ...(i.pair_group !== null ? { pairGroup: i.pair_group } : {}),
        ...(i.load_kg !== null ? { loadKg: i.load_kg } : {}),
        reasons: JSON.parse(i.reasons ?? "{}"),
      })),
    });
  }
  return {
    id: p.id,
    goalTemplate: p.goal_template,
    engineVersion: p.engine_version,
    rotation: json(p.rotation) ?? [],
    blockStart: p.block_start,
    blockWeek: p.block_week ?? 1,
    ...(p.early_deload_from ? { earlyDeloadFrom: p.early_deload_from } : {}),
    templates,
  };
}

/** The engine input from the local database. Undefined before onboarding. */
export async function readEngineInput(today = localDate()): Promise<EngineInput | undefined> {
  const profile = await readProfile();
  if (!profile) return undefined;
  const programme = await readProgramme();
  return {
    profile,
    kit: await readKit(),
    flags: await readFlags(),
    catalogue,
    history: {
      ...emptyHistory(),
      progress: await readProgress(),
      sessions: await readSessions(),
      tests: await readTests(),
    },
    ...(programme ? { programme } : {}),
    today,
    engineVersion: ENGINE_VERSION,
  };
}

function progressRow(s: ProgressState) {
  return {
    id: uuidv7(),
    family: s.family,
    exercise_id: s.exerciseId ?? null,
    rung: s.rung,
    load_kg: s.loadKg ?? null,
    band: s.band ? JSON.stringify(s.band) : null,
    hold_s: s.holdS ?? null,
    tempo_stage: s.tempoStage ?? null,
    rep_override: s.repOverride ? JSON.stringify(s.repOverride) : null,
    best: s.best ?? null,
    seen: s.seen ?? null,
    streaks: s.streaks ? JSON.stringify(s.streaks) : null,
    ...stamps(),
  };
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
    for (const s of progress) await tx.insert(progress_state).values(progressRow(s));
    const programmeId = uuidv7();
    await tx.insert(programmes).values({
      id: programmeId,
      goal_template: plan.goalTemplate,
      engine_version: plan.engineVersion,
      rotation: JSON.stringify(plan.rotation),
      block_start: plan.blockStart,
      block_week: plan.blockWeek,
      active: 1,
      ...stamps(),
    });
    for (const [n, t] of plan.templates.entries()) {
      const templateId = uuidv7();
      await tx.insert(session_templates).values({
        id: templateId,
        programme_id: programmeId,
        day_type: t.dayType,
        name: t.name,
        order: n,
        estimated_minutes: t.estimatedMinutes,
        reasons: JSON.stringify(t.reasons),
        ...stamps(),
      });
      for (const i of t.items)
        await tx.insert(template_items).values({
          id: uuidv7(),
          template_id: templateId,
          family: i.family,
          exercise_id: i.exerciseId,
          role: i.role,
          order: i.order,
          pair_group: i.pairGroup ?? null,
          sets: i.sets,
          unit: i.target.unit,
          rep_low: i.target.low,
          rep_high: i.target.high,
          load_kg: i.loadKg ?? null,
          reasons: JSON.stringify(i.reasons),
          ...stamps(),
        });
    }
  });
  return plan;
}
