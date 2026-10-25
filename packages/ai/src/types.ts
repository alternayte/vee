// SPDX-License-Identifier: AGPL-3.0-or-later
// Types the app reads from stored reviews. No runtime code: the app never
// calls a model itself.
import type { TrainingWeek } from "@vee/engine";
import type { FoodWeek } from "./food";

export type ReviewNumbers = {
  week: { from: string; to: string };
  training: Omit<TrainingWeek, "from" | "to">;
  food: FoodWeek;
  weight: { weighIns: number; slopeKgPerWeek: number | null };
  minutesPerSession: number;
  plan: {
    dayType: string;
    name: string;
    minutes: number;
    items: { exerciseId: string; family: string; role: string; sets: number }[];
  }[];
  /** Only changes the engine accepts now. */
  swapOptions: { dayType: string; family: string; current: string; options: string[] }[];
  setsOptions: { dayType: string; exerciseId: string; sets: number }[];
  deloadAllowed: boolean;
};
