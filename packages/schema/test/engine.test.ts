// SPDX-License-Identifier: AGPL-3.0-or-later
import { loadCatalogue } from "@vee/catalogue/load";
import { ENGINE_VERSION } from "@vee/engine";
import { describe, expect, test } from "vitest";
import { ENGINE_TABLES, type EngineRows, programmeRows, toEngineInput, toProgramme } from "../src/engine";

const loaded = loadCatalogue();
if (!loaded.ok) throw new Error("catalogue");
const o = { catalogue: loaded.catalogue, today: "2026-11-08", engineVersion: ENGINE_VERSION };
const stamp = { user_id: "u", created_at: "t", updated_at: "t", deleted_at: null };
const empty = () => Object.fromEntries(ENGINE_TABLES.map((n) => [n, []])) as unknown as EngineRows;

describe("toEngineInput", () => {
  test("no profile means no input", () => {
    expect(toEngineInput(empty(), o)).toBeUndefined();
  });

  test("maps rows to engine types and leaves out deleted rows", () => {
    const rows = empty();
    rows.profiles.push({
      ...stamp,
      id: "p",
      height_cm: 180,
      birth_year: 1989,
      sex: "male",
      units: "metric",
      locale: "en",
      timezone: "Europe/Zurich",
      goal_template: "v-taper-lean-gain",
      minutes_per_session: 35,
      sessions_per_week: 4,
      time_of_day: "evening",
      quiet_hours: null,
    });
    rows.kit_items.push({
      ...stamp,
      id: "db",
      kind: "dial_db",
      count: 1,
      params: '{"min":2,"max":24,"step":2}',
    });
    rows.sessions.push(
      {
        ...stamp,
        id: "s1",
        template_id: null,
        kind: "main",
        day_type: "A",
        status: "done",
        date: "2026-11-03",
        started_at: null,
        ended_at: null,
        readiness_mode: "trimmed",
        deload: 0,
      },
      {
        ...stamp,
        id: "s2",
        template_id: null,
        kind: "main",
        day_type: "B",
        status: "done",
        date: "2026-11-04",
        started_at: null,
        ended_at: null,
        readiness_mode: null,
        deload: null,
        deleted_at: "t",
      },
    );
    rows.prescriptions.push(
      {
        ...stamp,
        id: "r2",
        session_id: "s1",
        section: "main",
        item_order: 2,
        family: "row",
        exercise_id: "row-single-arm-db",
        role: "main",
        sets: 3,
        target: '{"unit":"reps","low":8,"high":12}',
        load_kg: 8,
        band: null,
        tempo: "2-0-1-1",
        rest_s: 120,
        pair_group: null,
        reasons: null,
        engine_version: "1",
      },
      {
        ...stamp,
        id: "r1",
        session_id: "s1",
        section: "warmup",
        item_order: 1,
        family: "row",
        exercise_id: "row-single-arm-db",
        role: "main",
        sets: 1,
        target: '{"unit":"reps","low":4,"high":4}',
        load_kg: 8,
        band: null,
        tempo: null,
        rest_s: 0,
        pair_group: null,
        reasons: null,
        engine_version: "1",
      },
    );
    rows.sets.push({
      ...stamp,
      id: "x",
      session_id: "s1",
      exercise_id: "row-single-arm-db",
      side: "left",
      reps: 10,
      seconds: null,
      load_kg: 8,
      band: null,
      effort: "good",
      logged_at: "t2",
    });
    rows.progress_state.push({
      ...stamp,
      id: "ps",
      family: "row",
      exercise_id: "row-single-arm-db",
      rung: 1,
      load_kg: 8,
      band: null,
      hold_s: null,
      tempo_stage: 1,
      rep_override: null,
      best: 12,
      seen: 2,
      streaks: '{"top":1,"miss":0,"stall":0,"hold":0}',
    });

    const i = toEngineInput(rows, o);
    expect(i?.profile).toEqual({
      heightCm: 180,
      birthYear: 1989,
      sex: "male",
      minutesPerSession: 35,
      goalTemplate: "v-taper-lean-gain",
    });
    expect(i?.kit).toEqual([{ id: "db", kind: "dial_db", count: 1, params: { min: 2, max: 24, step: 2 } }]);
    expect(i?.history.sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(i?.history.sessions[0]).toMatchObject({ readinessMode: "trimmed", deload: false, dayType: "A" });
    const rx = i?.history.prescriptions[0];
    expect(rx).toMatchObject({ sessionId: "s1", readinessMode: "trimmed", engineVersion: "1" });
    expect(rx?.warmup.map((w) => w.sets)).toEqual([1]);
    expect(rx?.items[0]).toMatchObject({
      target: { unit: "reps", low: 8, high: 12 },
      loadKg: 8,
      tempo: "2-0-1-1",
    });
    expect(i?.history.sets[0]).toMatchObject({ side: "left", reps: 10, loadKg: 8 });
    expect(i?.history.progress[0]).toMatchObject({ tempoStage: 1, best: 12, streaks: { top: 1 } });
  });
});

describe("programmeRows", () => {
  test("rows for a programme map back to the same programme", async () => {
    const { generatePlan, V_TAPER_LEAN_GAIN, emptyHistory } = await import("@vee/engine");
    const input = {
      profile: {
        heightCm: 180,
        birthYear: 1989,
        sex: "male" as const,
        minutesPerSession: 35,
        goalTemplate: "v-taper-lean-gain",
      },
      kit: [],
      flags: [],
      catalogue: loaded.catalogue,
      history: emptyHistory(),
      today: "2026-11-02",
      engineVersion: ENGINE_VERSION,
    };
    const plan = generatePlan(input, V_TAPER_LEAN_GAIN);
    let n = 0;
    const rows = programmeRows(plan, { newId: () => `id${n++}`, now: "t" });
    const { id: _id, ...back } = toProgramme(
      rows.programmes,
      rows.session_templates,
      rows.template_items,
    ) ?? { id: "" };
    expect(back).toEqual(plan);
  });
});
