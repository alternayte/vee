// SPDX-License-Identifier: AGPL-3.0-or-later
// Test data as the app writes it: rows, and a profile with its first programme.
import type { Catalogue } from "@vee/catalogue";
import catalogueJson from "@vee/catalogue/catalogue.v1.json";
import { ENGINE_VERSION, emptyHistory, generatePlan, type KitItem, V_TAPER_LEAN_GAIN } from "@vee/engine";
import { uuidv7 } from "@vee/schema";
import { programmeRows } from "@vee/schema/engine";
import { query } from "./harness";

const catalogue = catalogueJson as unknown as Catalogue;

export async function insert(table: string, rows: Record<string, unknown>[]) {
  for (const r of rows) {
    const keys = Object.keys(r);
    await query(
      `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
      keys.map((k) => r[k]),
    );
  }
}

/** A profile and the first programme for a user, as the app writes them. */
export async function onboard(userId: string) {
  const kit: KitItem[] = [{ id: uuidv7(), kind: "dial_db", count: 1, params: { min: 2, max: 24, step: 2 } }];
  const at = new Date().toISOString();
  await insert("profiles", [
    {
      id: uuidv7(),
      user_id: userId,
      height_cm: 180,
      birth_year: 1989,
      sex: "male",
      timezone: "Europe/Zurich",
      goal_template: "v-taper-lean-gain",
      minutes_per_session: 35,
      created_at: at,
      updated_at: at,
    },
  ]);
  await insert(
    "kit_items",
    kit.map((k) => ({
      id: k.id,
      user_id: userId,
      kind: k.kind,
      count: k.count,
      params: JSON.stringify(k.params),
      created_at: at,
      updated_at: at,
    })),
  );
  const plan = generatePlan(
    {
      profile: {
        heightCm: 180,
        birthYear: 1989,
        sex: "male",
        minutesPerSession: 35,
        goalTemplate: "v-taper-lean-gain",
      },
      kit,
      flags: [],
      catalogue,
      history: emptyHistory(),
      today: at.slice(0, 10),
      engineVersion: ENGINE_VERSION,
    },
    V_TAPER_LEAN_GAIN,
  );
  const rows = programmeRows(plan, { newId: uuidv7, now: at, userId });
  await insert("programmes", rows.programmes);
  await insert("session_templates", rows.session_templates);
  await insert("template_items", rows.template_items);
  return plan;
}
