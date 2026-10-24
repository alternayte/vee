// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic personas for golden plans and simulation. No real person's data.
import type { Flag, KitItem, Profile, TestResult } from "@vee/engine";

export type Persona = {
  id: string;
  description: string;
  profile: Profile;
  kit: KitItem[];
  flags: Flag[];
  /** Baseline test on the first day. */
  baseline: TestResult[];
  /** Weekdays with a planned main session, 0 = Monday. */
  trainingDays: number[];
  /** Chance that a planned session is skipped. */
  skipChance: number;
  /** Chance to do an offered micro session. */
  microChance: number;
  /** Weekday with a climbing session from week 9, if any. */
  climbDay?: number;
};

const BASELINE_DATE = "2026-11-02";
const test = (item: TestResult["item"], value: number, loadKg?: number): TestResult => ({
  date: BASELINE_DATE,
  item,
  value,
  ...(loadKg === undefined ? {} : { loadKg }),
});

const profile = (minutesPerSession: number, over: Partial<Profile> = {}): Profile => ({
  heightCm: 178,
  birthYear: 1990,
  sex: "male",
  minutesPerSession,
  goalTemplate: "v-taper-lean-gain",
  ...over,
});

const dial = (min: number, max: number, step: number, count: 1 | 2 = 1): KitItem => ({
  id: "dial-db",
  kind: "dial_db",
  count,
  params: { min, max, step },
});
const band = (id: string, colour: string, estKg: number): KitItem => ({
  id,
  kind: "band",
  count: 1,
  params: { colour, estKg },
});
const station = (dipHandles: boolean, neutral: boolean): KitItem => ({
  id: "station",
  kind: "pullup_station",
  count: 1,
  params: { grips: neutral ? ["straight", "neutral"] : ["straight"], dipHandles },
});

export const PERSONAS: Persona[] = [
  {
    id: "home-db-beginner",
    description:
      "Beginner with one 2–24 kg dial dumbbell, one band and a station with dip handles. 40 min, 4 days.",
    profile: profile(40),
    kit: [dial(2, 24, 2), band("band", "red", 15), station(true, false)],
    flags: [],
    baseline: [
      test("hang", 15),
      test("pullups", 0),
      test("pushups", 8),
      test("dip_hold", 12),
      test("goblet_squat", 10, 8),
      test("plank", 40),
      test("carry", 25, 8),
    ],
    trainingDays: [0, 2, 4, 5],
    skipChance: 0.1,
    microChance: 0.5,
    climbDay: 6,
  },
  {
    id: "home-db-intermediate",
    description: "Trained user with the same home kit. 30 min, 4 days.",
    profile: profile(30),
    kit: [dial(2, 24, 2), band("band", "red", 15), station(true, false)],
    flags: [],
    baseline: [
      test("hang", 45),
      test("pullups", 5),
      test("pushups", 25),
      test("dip_hold", 50),
      test("goblet_squat", 16, 16),
      test("plank", 70),
      test("carry", 45, 16),
    ],
    trainingDays: [0, 1, 3, 5],
    skipChance: 0.05,
    microChance: 0.3,
  },
  {
    id: "bodyweight-only",
    description: "No kit at all. 25 min, 3 days.",
    profile: profile(25, { sex: "female", heightCm: 165 }),
    kit: [],
    flags: [],
    baseline: [test("pushups", 4), test("plank", 50)],
    trainingDays: [0, 2, 4],
    skipChance: 0.15,
    microChance: 0,
  },
  {
    id: "bands-station-shoulder",
    description:
      "Two bands and a station with neutral grips and no dip handles. Mild shoulder flag. 35 min, 4 days.",
    profile: profile(35),
    kit: [band("light", "yellow", 10), band("heavy", "black", 30), station(false, true)],
    flags: [{ joint: "shoulder", severity: "mild", activeFrom: "2026-10-01" }],
    baseline: [test("hang", 25), test("pullups", 2), test("pushups", 18), test("plank", 45)],
    trainingDays: [0, 2, 3, 5],
    skipChance: 0.1,
    microChance: 0.5,
  },
  {
    id: "pair-fixed-knee",
    description: "A pair of fixed dumbbells and a station with dip handles. Acute knee flag. 45 min, 4 days.",
    profile: profile(45),
    kit: [
      { id: "fixed", kind: "fixed_db", count: 2, params: { weights: [4, 6, 8, 10, 12, 15, 17.5, 20] } },
      station(true, false),
    ],
    flags: [{ joint: "knee", severity: "acute", activeFrom: "2026-10-15" }],
    baseline: [
      test("hang", 30),
      test("pullups", 7),
      test("pushups", 30),
      test("dip_hold", 45),
      test("carry", 60, 15),
    ],
    trainingDays: [0, 1, 3, 4],
    skipChance: 0.05,
    microChance: 0.2,
  },
  {
    id: "kettlebell-short",
    description: "Kettlebells of 8, 12 and 16 kg and one band. Mild lower-back flag. 20 min, 4 days.",
    profile: profile(20, { sex: "female", heightCm: 170 }),
    kit: [
      { id: "kb", kind: "kettlebell", count: 1, params: { weights: [8, 12, 16] } },
      band("band", "green", 20),
    ],
    flags: [{ joint: "lower-back", severity: "mild", activeFrom: "2026-09-01" }],
    baseline: [test("pushups", 10), test("plank", 30)],
    trainingDays: [0, 2, 4, 6],
    skipChance: 0.2,
    microChance: 0,
  },
];

export { BASELINE_DATE };
