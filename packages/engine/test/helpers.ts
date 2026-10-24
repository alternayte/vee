// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared test inputs. Synthetic only: no real person's data.

import type { Exercise } from "@vee/catalogue";
import { loadCatalogue } from "@vee/catalogue/load";
import { ENGINE_VERSION, type EngineInput, type KitItem } from "../src";

const loaded = loadCatalogue();
if (!loaded.ok) throw new Error("catalogue does not build");
export const catalogue = loaded.catalogue;

export function ex(id: string): Exercise {
  const e = catalogue.exercises.find((x) => x.id === id);
  if (!e) throw new Error(`no exercise ${id}`);
  return e;
}

/** One dial dumbbell 2–24 kg, one band, a pull-up station with dip handles. */
export const homeKit: KitItem[] = [
  { id: "db", kind: "dial_db", count: 1, params: { min: 2, max: 24, step: 2 } },
  { id: "band", kind: "band", count: 1, params: { colour: "red", estKg: 15 } },
  { id: "station", kind: "pullup_station", count: 1, params: { grips: ["straight"], dipHandles: true } },
];

export function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    profile: {
      heightCm: 178,
      birthYear: 1990,
      sex: "male",
      minutesPerSession: 40,
      goalTemplate: "v-taper-lean-gain",
    },
    kit: homeKit,
    flags: [],
    catalogue,
    history: { progress: [] },
    today: "2026-11-02",
    engineVersion: ENGINE_VERSION,
    ...over,
  };
}
