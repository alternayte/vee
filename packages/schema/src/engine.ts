// SPDX-License-Identifier: AGPL-3.0-or-later
// Rows of the synced tables → the engine's input. The app (SQLite) and the
// API (Postgres) read the same columns, so both use this mapping.
import type { Catalogue, Joint, Severity } from "@vee/catalogue";
import type {
  BandChoice,
  Checkin,
  DayType,
  EngineInput,
  Flag,
  KitItem,
  LoggedSet,
  PrescribedItem,
  Prescription,
  Profile,
  Programme,
  ProgressState,
  ReadinessMode,
  SessionRecord,
  TestItem,
  TestResult,
} from "@vee/engine";
import type * as t from "./client";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export type EngineRows = {
  profiles: Row<typeof t.profiles>[];
  kit_items: Row<typeof t.kit_items>[];
  flags: Row<typeof t.flags>[];
  tests: Row<typeof t.tests>[];
  test_results: Row<typeof t.test_results>[];
  progress_state: Row<typeof t.progress_state>[];
  sessions: Row<typeof t.sessions>[];
  prescriptions: Row<typeof t.prescriptions>[];
  sets: Row<typeof t.sets>[];
  checkins: Row<typeof t.checkins>[];
  programmes: Row<typeof t.programmes>[];
  session_templates: Row<typeof t.session_templates>[];
  template_items: Row<typeof t.template_items>[];
};

export const ENGINE_TABLES = [
  "profiles",
  "kit_items",
  "flags",
  "tests",
  "test_results",
  "progress_state",
  "sessions",
  "prescriptions",
  "sets",
  "checkins",
  "programmes",
  "session_templates",
  "template_items",
] as const satisfies readonly (keyof EngineRows)[];

const json = <T>(s: string | null | undefined): T | undefined => (s ? (JSON.parse(s) as T) : undefined);
const live = <R extends { deleted_at: string | null }>(rows: R[]) =>
  rows.filter((r) => r.deleted_at === null);

export function toProfile(rows: EngineRows["profiles"]): Profile | undefined {
  const p = live(rows)[0];
  if (!p?.height_cm || !p.birth_year || !p.minutes_per_session || !p.goal_template) return undefined;
  return {
    heightCm: p.height_cm,
    birthYear: p.birth_year,
    sex: p.sex === "female" ? "female" : "male",
    minutesPerSession: p.minutes_per_session,
    goalTemplate: p.goal_template,
  };
}

export function toKit(rows: EngineRows["kit_items"]): KitItem[] {
  return live(rows).map(
    (r) => ({ id: r.id, kind: r.kind, count: r.count ?? 1, params: json(r.params) ?? {} }) as KitItem,
  );
}

export function toFlags(rows: EngineRows["flags"]): Flag[] {
  return live(rows).map((r) => ({
    joint: r.joint as Joint,
    severity: r.severity as Severity,
    activeFrom: r.active_from,
    ...(r.active_to ? { activeTo: r.active_to } : {}),
  }));
}

export function toTests(tests: EngineRows["tests"], results: EngineRows["test_results"]): TestResult[] {
  const dates = new Map(live(tests).map((x) => [x.id, x.date]));
  return live(results).flatMap((r) => {
    const date = dates.get(r.test_id);
    if (date === undefined || r.value === null) return [];
    return [
      {
        date,
        item: r.item as TestItem,
        value: r.value,
        ...(r.load_kg !== null ? { loadKg: r.load_kg } : {}),
      },
    ];
  });
}

export function toProgress(rows: EngineRows["progress_state"]): ProgressState[] {
  return live(rows).map((r) => {
    const s: ProgressState = { family: r.family, rung: r.rung ?? 1 };
    if (r.exercise_id) s.exerciseId = r.exercise_id;
    if (r.load_kg !== null) s.loadKg = r.load_kg;
    if (r.band) s.band = JSON.parse(r.band) as BandChoice;
    if (r.hold_s !== null) s.holdS = r.hold_s;
    if (r.tempo_stage !== null) s.tempoStage = r.tempo_stage as NonNullable<ProgressState["tempoStage"]>;
    if (r.rep_override) s.repOverride = JSON.parse(r.rep_override);
    if (r.best !== null) s.best = r.best;
    if (r.seen !== null) s.seen = r.seen;
    if (r.streaks) s.streaks = JSON.parse(r.streaks);
    return s;
  });
}

export function toSessions(rows: EngineRows["sessions"]): SessionRecord[] {
  return live(rows).map((r) => ({
    id: r.id,
    kind: r.kind as SessionRecord["kind"],
    status: r.status as SessionRecord["status"],
    date: r.date,
    ...(r.day_type ? { dayType: r.day_type as DayType } : {}),
    ...(r.readiness_mode ? { readinessMode: r.readiness_mode as ReadinessMode } : {}),
    ...(r.deload !== null ? { deload: r.deload === 1 } : {}),
  }));
}

export function toSets(rows: EngineRows["sets"]): LoggedSet[] {
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    exerciseId: r.exercise_id,
    effort: r.effort as LoggedSet["effort"],
    loggedAt: r.logged_at,
    ...(r.side === "left" || r.side === "right" ? { side: r.side } : {}),
    ...(r.reps !== null ? { reps: r.reps } : {}),
    ...(r.seconds !== null ? { seconds: r.seconds } : {}),
    ...(r.load_kg !== null ? { loadKg: r.load_kg } : {}),
    ...(r.band ? { band: JSON.parse(r.band) as BandChoice } : {}),
    ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
  }));
}

export function toCheckins(rows: EngineRows["checkins"]): Checkin[] {
  return live(rows).flatMap((r) =>
    r.energy === null || r.soreness === null || !r.sleep
      ? []
      : [
          {
            sessionId: r.session_id ?? "",
            date: r.date,
            energy: r.energy,
            soreness: r.soreness,
            sleep: r.sleep as Checkin["sleep"],
            ...(r.hc_sleep_min !== null ? { hcSleepMin: r.hc_sleep_min } : {}),
          },
        ],
  );
}

export function toPrescriptions(
  rows: EngineRows["prescriptions"],
  sessions: SessionRecord[],
): Prescription[] {
  const bySession = new Map<string, EngineRows["prescriptions"]>();
  for (const r of live(rows)) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);
  const item = (r: EngineRows["prescriptions"][number]): PrescribedItem => ({
    order: r.item_order ?? 0,
    family: r.family ?? "",
    exerciseId: r.exercise_id,
    role: r.role === "main" ? "main" : "accessory",
    sets: r.sets ?? 0,
    target: json(r.target) ?? { unit: "reps", low: 0, high: 0 },
    restS: r.rest_s ?? 0,
    reasons: json(r.reasons) ?? {
      exercise: { ruleId: "", inputs: {}, text: "" },
      sets: [],
      target: { ruleId: "", inputs: {}, text: "" },
    },
    ...(r.load_kg !== null ? { loadKg: r.load_kg } : {}),
    ...(r.band ? { band: JSON.parse(r.band) as BandChoice } : {}),
    ...(r.tempo ? { tempo: r.tempo } : {}),
    ...(r.pair_group !== null ? { pairGroup: r.pair_group } : {}),
  });
  const order = (a: { order: number }, b: { order: number }) => a.order - b.order;
  return [...bySession].flatMap(([sessionId, items]) => {
    const s = sessions.find((x) => x.id === sessionId);
    if (!s) return [];
    return [
      {
        sessionId,
        kind: s.kind,
        ...(s.dayType ? { dayType: s.dayType } : {}),
        readinessMode: s.readinessMode ?? "full",
        deload: s.deload ?? false,
        engineVersion: items[0]?.engine_version ?? "",
        warmup: items
          .filter((i) => i.section === "warmup")
          .map(item)
          .sort(order),
        items: items
          .filter((i) => i.section !== "warmup")
          .map(item)
          .sort(order),
        estimatedMinutes: 0,
        reasons: [],
      },
    ];
  });
}

export function toProgramme(
  programmes: EngineRows["programmes"],
  templates: EngineRows["session_templates"],
  items: EngineRows["template_items"],
): (Programme & { id: string }) | undefined {
  const p = live(programmes).find((x) => x.active === 1);
  if (!p) return undefined;
  const days = live(templates)
    .filter((d) => d.programme_id === p.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    id: p.id,
    goalTemplate: p.goal_template,
    engineVersion: p.engine_version,
    rotation: json(p.rotation) ?? [],
    blockStart: p.block_start,
    blockWeek: p.block_week ?? 1,
    ...(p.early_deload_from ? { earlyDeloadFrom: p.early_deload_from } : {}),
    templates: days.map((d) => ({
      dayType: d.day_type as DayType,
      name: d.name ?? d.day_type,
      estimatedMinutes: d.estimated_minutes ?? 0,
      reasons: json(d.reasons) ?? [],
      items: live(items)
        .filter((i) => i.template_id === d.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((i) => ({
          order: i.order ?? 0,
          family: i.family,
          exerciseId: i.exercise_id,
          role: i.role === "main" ? ("main" as const) : ("accessory" as const),
          sets: i.sets ?? 0,
          target: {
            unit: i.unit === "seconds" ? ("seconds" as const) : ("reps" as const),
            low: i.rep_low ?? 0,
            high: i.rep_high ?? 0,
          },
          ...(i.pair_group !== null ? { pairGroup: i.pair_group } : {}),
          ...(i.load_kg !== null ? { loadKg: i.load_kg } : {}),
          reasons: JSON.parse(i.reasons ?? "{}"),
        })),
    })),
  };
}

/** The engine input, or undefined before onboarding. */
export function toEngineInput(
  rows: EngineRows,
  o: { catalogue: Omit<Catalogue, "hash">; today: string; engineVersion: string },
): EngineInput | undefined {
  const profile = toProfile(rows.profiles);
  if (!profile) return undefined;
  const sessions = toSessions(rows.sessions);
  const programme = toProgramme(rows.programmes, rows.session_templates, rows.template_items);
  return {
    profile,
    kit: toKit(rows.kit_items),
    flags: toFlags(rows.flags),
    catalogue: o.catalogue,
    history: {
      progress: toProgress(rows.progress_state),
      sessions,
      sets: toSets(rows.sets),
      checkins: toCheckins(rows.checkins),
      prescriptions: toPrescriptions(rows.prescriptions, sessions),
      tests: toTests(rows.tests, rows.test_results),
    },
    ...(programme ? { programme } : {}),
    today: o.today,
    engineVersion: o.engineVersion,
  };
}

type Stamp = { id: string; user_id: string | null; created_at: string; updated_at: string; deleted_at: null };

/** Rows for a programme, its days and their items. */
export function programmeRows(
  plan: Programme,
  o: { newId: () => string; now: string; userId?: string | null; programmeId?: string },
): Pick<EngineRows, "programmes" | "session_templates" | "template_items"> {
  const stamp = (): Stamp => ({
    id: o.newId(),
    user_id: o.userId ?? null,
    created_at: o.now,
    updated_at: o.now,
    deleted_at: null,
  });
  const p = { ...stamp(), ...(o.programmeId ? { id: o.programmeId } : {}) };
  const out: Pick<EngineRows, "programmes" | "session_templates" | "template_items"> = {
    programmes: [
      {
        ...p,
        goal_template: plan.goalTemplate,
        engine_version: plan.engineVersion,
        rotation: JSON.stringify(plan.rotation),
        block_start: plan.blockStart,
        block_week: plan.blockWeek,
        early_deload_from: plan.earlyDeloadFrom ?? null,
        active: 1,
      },
    ],
    session_templates: [],
    template_items: [],
  };
  for (const [n, t] of plan.templates.entries()) {
    const day = stamp();
    out.session_templates.push({
      ...day,
      programme_id: p.id,
      day_type: t.dayType,
      name: t.name,
      order: n,
      estimated_minutes: t.estimatedMinutes,
      reasons: JSON.stringify(t.reasons),
    });
    for (const i of t.items)
      out.template_items.push({
        ...stamp(),
        template_id: day.id,
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
      });
  }
  return out;
}

export function progressRows(
  progress: ProgressState[],
  o: { newId: () => string; now: string; userId?: string | null },
): EngineRows["progress_state"] {
  return progress.map((s) => ({
    id: o.newId(),
    user_id: o.userId ?? null,
    created_at: o.now,
    updated_at: o.now,
    deleted_at: null,
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
  }));
}
