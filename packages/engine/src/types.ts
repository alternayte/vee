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

export type BandChoice = { bandId: string; setting: "single" | "short" | "double" };

/** 0 none, 1 tempo (3 s lowering), 2 tempo and pause, 3 tempo, pause and an extra set. */
export type TempoStage = 0 | 1 | 2 | 3;

export type Streaks = {
  /** Sessions in a row at the top of the range at Easy or Good (P2). */
  top: number;
  /** Sessions in a row with a miss at Hard or Failed (P1, P6). */
  miss: number;
  /** Sessions in a row with no rep, seconds or load gain (P5). */
  stall: number;
  /** Sessions in a row at or above the hold target (P4). */
  hold: number;
};

/** Engine-derived state for one exercise family. A cache: history can rebuild it. */
export type ProgressState = {
  family: string;
  rung: number;
  exerciseId?: string;
  loadKg?: number;
  band?: BandChoice;
  /** Hold target for timed work. */
  holdS?: number;
  tempoStage?: TempoStage;
  /** A rep range from test placement that replaces the catalogue range until P2 fires. */
  repOverride?: { low: number; high: number };
  /** Best reps or seconds in one set at the current step. */
  best?: number;
  streaks?: Streaks;
};

export type Effort = "easy" | "good" | "hard" | "failed";

export type LoggedSet = {
  id: string;
  sessionId: string;
  exerciseId: string;
  side?: "left" | "right";
  reps?: number;
  seconds?: number;
  loadKg?: number;
  band?: BandChoice;
  effort: Effort;
  loggedAt: string;
  deletedAt?: string;
};

export type SessionKind = "main" | "micro" | "recovery" | "climb" | "test";

export type ReadinessMode = "full" | "trimmed" | "recovery";

export type SessionRecord = {
  id: string;
  kind: SessionKind;
  dayType?: DayType;
  status: "planned" | "active" | "done" | "skipped";
  date: LocalDate;
  readinessMode?: ReadinessMode;
  deload?: boolean;
};

export type Checkin = {
  sessionId: string;
  date: LocalDate;
  energy: number;
  soreness: number;
  sleep: "good" | "ok" | "bad";
  hcSleepMin?: number;
};

export type TestItem =
  | "hang"
  | "pullups"
  | "pushups"
  | "dip_hold"
  | "goblet_squat"
  | "plank"
  | "carry"
  | "burpees"
  | "waist";

export type TestResult = { date: LocalDate; item: TestItem; value: number; loadKg?: number };

export type History = {
  progress: ProgressState[];
  sessions: SessionRecord[];
  sets: LoggedSet[];
  checkins: Checkin[];
  prescriptions: Prescription[];
  tests: TestResult[];
};

export type EngineInput = {
  profile: Profile;
  kit: KitItem[];
  flags: Flag[];
  catalogue: Omit<Catalogue, "hash">;
  history: History;
  programme?: Programme;
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
  /** Set when the engine starts an early deload. The deload lasts 7 days from this date. */
  earlyDeloadFrom?: LocalDate;
  templates: SessionTemplate[];
};

export type PrescribedItem = {
  order: number;
  family: string;
  exerciseId: string;
  role: Role;
  sets: number;
  target: { unit: "reps" | "seconds"; low: number; high: number };
  loadKg?: number;
  band?: BandChoice;
  /** eccentric-pause-concentric-pause, as in the catalogue. */
  tempo?: string;
  restS: number;
  pairGroup?: number;
  reasons: { exercise: Reason; sets: Reason[]; target: Reason; load?: Reason; band?: Reason; tempo?: Reason };
};

/** Frozen at session start (I3). */
export type Prescription = {
  sessionId?: string;
  kind: SessionKind;
  dayType?: DayType;
  readinessMode: ReadinessMode;
  deload: boolean;
  engineVersion: string;
  warmup: PrescribedItem[];
  items: PrescribedItem[];
  estimatedMinutes: number;
  reasons: Reason[];
};
