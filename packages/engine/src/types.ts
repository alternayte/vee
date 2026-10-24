// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Catalogue, Joint, Severity } from "@vee/catalogue";

/** Calendar date in the user's time zone, `YYYY-MM-DD`. */
export type LocalDate = string;

export type Profile = {
  heightCm: number;
  birthYear: number;
  sex: "male" | "female";
  /** Planned length of one main session. */
  minutesPerSession: number;
  goalTemplate: string;
};

export type KitItem =
  | { id: string; kind: "dial_db"; count: 1 | 2; params: { min: number; max: number; step: number } }
  | { id: string; kind: "fixed_db"; count: 1 | 2; params: { weights: number[] } }
  | { id: string; kind: "kettlebell"; count: 1 | 2; params: { weights: number[] } }
  | { id: string; kind: "band"; count: 1; params: { colour: string; estKg: number } }
  | {
      id: string;
      kind: "pullup_station";
      count: 1;
      params: { grips: ("straight" | "neutral")[]; dipHandles: boolean };
    }
  | { id: string; kind: "bench" | "rings"; count: 1; params: Record<string, never> };

export type Flag = { joint: Joint; severity: Severity; activeFrom: LocalDate; activeTo?: LocalDate };

/** Engine-derived state for one exercise family. A cache: history can rebuild it. */
export type ProgressState = {
  family: string;
  rung: number;
  exerciseId?: string;
  loadKg?: number;
};

export type History = {
  progress: ProgressState[];
};

export type EngineInput = {
  profile: Profile;
  kit: KitItem[];
  flags: Flag[];
  catalogue: Omit<Catalogue, "hash">;
  history: History;
  today: LocalDate;
  engineVersion: string;
};

export type Reason = { ruleId: string; inputs: Record<string, number | string>; text: string };

export type DayType = "A" | "B" | "C" | "D";

export type Role = "main" | "accessory";

export type TemplateItem = {
  order: number;
  family: string;
  exerciseId: string;
  role: Role;
  sets: number;
  /** Reps for rep-based work, seconds for timed work. */
  target: { unit: "reps" | "seconds"; low: number; high: number };
  /** Items with the same pair group alternate set by set. */
  pairGroup?: number;
  /** Set only for work loaded from the kit's load options. */
  loadKg?: number;
  reasons: { exercise: Reason; sets: Reason[]; target: Reason; load?: Reason };
};

export type SessionTemplate = {
  dayType: DayType;
  name: string;
  items: TemplateItem[];
  estimatedMinutes: number;
  reasons: Reason[];
};

export type Programme = {
  goalTemplate: string;
  engineVersion: string;
  rotation: DayType[];
  blockStart: LocalDate;
  blockWeek: number;
  templates: SessionTemplate[];
};
