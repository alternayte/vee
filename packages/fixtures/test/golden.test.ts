// SPDX-License-Identifier: AGPL-3.0-or-later
// V4: golden plans. Each persona's plan must match its reviewed snapshot.
// A diff needs a DECISIONS.md entry before the snapshot is updated.
import { loadCatalogue } from "@vee/catalogue/load";
import {
  addDays,
  ENGINE_VERSION,
  type EngineInput,
  emptyHistory,
  generatePlan,
  prescribe,
  rebuildProgress,
  V_TAPER_LEAN_GAIN,
} from "@vee/engine";
import { describe, expect, test } from "vitest";
import { BASELINE_DATE, PERSONAS, type Persona } from "../src/personas";
import { renderPrescription, renderProgramme } from "./render";

const loaded = loadCatalogue();
if (!loaded.ok) throw new Error("catalogue does not build");
const catalogue = loaded.catalogue;

function baselineInput(p: Persona): EngineInput {
  const input: EngineInput = {
    profile: p.profile,
    kit: p.kit,
    flags: p.flags,
    catalogue,
    history: { ...emptyHistory(), tests: p.baseline },
    today: BASELINE_DATE,
    engineVersion: ENGINE_VERSION,
  };
  return { ...input, history: { ...input.history, progress: rebuildProgress(input) } };
}

describe.each(PERSONAS)("golden plan: $id", (persona) => {
  test("matches the reviewed snapshot", async () => {
    const input = baselineInput(persona);
    const week1 = generatePlan(input, V_TAPER_LEAN_GAIN, 1);
    const week4 = generatePlan(input, V_TAPER_LEAN_GAIN, 4);
    const withPlan = { ...input, programme: week1 };
    const a = week1.templates[0];
    const c = week1.templates[2];
    if (!a || !c) throw new Error("plan has no A or C day");
    const deloadDay = { ...withPlan, today: addDays(BASELINE_DATE, 28) };

    const text = [
      `# ${persona.id}`,
      persona.description,
      `progress: ${input.history.progress.map((s) => `${s.family}=${s.exerciseId}${s.loadKg ? `@${s.loadKg}` : ""}`).join(", ")}`,
      "",
      "## Week 1",
      renderProgramme(week1, catalogue),
      "",
      "## Week 4",
      renderProgramme(week4, catalogue),
      "",
      "## Day A, full readiness",
      renderPrescription(prescribe(withPlan, a, { readiness: "full" })),
      "",
      "## Day C, trimmed",
      renderPrescription(prescribe(withPlan, c, { readiness: "trimmed" })),
      "",
      "## Day A, recovery",
      renderPrescription(prescribe(withPlan, a, { readiness: "recovery" })),
      "",
      "## Day A, deload week",
      renderPrescription(prescribe(deloadDay, a, { readiness: "full" })),
      "",
    ].join("\n");
    await expect(text).toMatchFileSnapshot(`golden/${persona.id}.txt`);
  });
});
