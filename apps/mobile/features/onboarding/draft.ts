// SPDX-License-Identifier: AGPL-3.0-or-later
// The onboarding answers until the last step saves them in one transaction.
import { V_TAPER_LEAN_GAIN } from "@vee/engine";
import { create } from "zustand";
import type { Onboarding } from "@/features/training/data";

export type Draft = Omit<Onboarding, "body"> & { body: Partial<Onboarding["body"]> };

export const useDraft = create<Draft>(() => ({
  body: {},
  kit: [],
  time: { sessionsPerWeek: 4, minutesPerSession: 35, timeOfDay: "evening" },
  goalTemplate: V_TAPER_LEAN_GAIN.id,
  flags: [],
}));

export const setDraft = (patch: Partial<Draft>) => useDraft.setState(patch);

/** A whole number or decimal from a text field; undefined when empty or not a number. */
export function num(text: string): number | undefined {
  const v = Number(text.replace(",", ".").trim());
  return text.trim() === "" || !Number.isFinite(v) ? undefined : v;
}
