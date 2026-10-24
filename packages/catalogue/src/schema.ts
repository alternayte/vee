// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";

/** Bump when the catalogue content or shape changes. Builds and prescriptions record it. */
export const CATALOGUE_VERSION = 1;

export const MUSCLES = [
  "lats",
  "upper-back",
  "rear-delts",
  "side-delts",
  "front-delts",
  "chest",
  "triceps",
  "biceps",
  "forearms",
  "grip",
  "abs",
  "obliques",
  "lower-back",
  "hip-flexors",
  "glutes",
  "quads",
  "hamstrings",
  "adductors",
  "calves",
] as const;

export const PATTERNS = [
  "vertical-pull",
  "horizontal-pull",
  "vertical-push",
  "horizontal-push",
  "dip",
  "squat",
  "lunge",
  "hinge",
  "carry",
  "core-flexion",
  "core-anti-extension",
  "core-anti-lateral",
  "lateral-raise",
  "rear-delt",
  "elbow-flexion",
  "elbow-extension",
  "hang",
  "mobility",
  "conditioning",
] as const;

/**
 * What an exercise needs. `dumbbell` is met by any dumbbell kit item (dial,
 * fixed or plate-loaded); the engine maps kit items to these kinds.
 */
export const KIT_KINDS = [
  "dumbbell",
  "kettlebell",
  "barbell",
  "rack",
  "bench",
  "band",
  "pullup_station",
  "rings",
] as const;

export const STATION_FEATURES = ["dip_handles", "neutral_grips"] as const;

/**
 * How the engine loads and progresses the exercise.
 * - dial: external load from the kit's load options; steps up by load.
 * - fixed: external load that stays the same; steps up by reps, tempo or rung.
 * - band-assist, band-resist: band settings; see SDD "One step up".
 * - bodyweight: steps up by reps, then by rung.
 * - timed: a hold or carry; steps up by seconds, then by rung.
 */
export const LOAD_TYPES = ["dial", "fixed", "band-assist", "band-resist", "bodyweight", "timed"] as const;

export const JOINTS = ["shoulder", "elbow", "wrist", "knee", "lower-back"] as const;

/** `joint:mild` blocks on any flag on that joint. `joint:acute` blocks on acute flags only. */
export const SEVERITIES = ["mild", "acute"] as const;

const Kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lower-case kebab-case");

const Range = z.tuple([z.int().min(1), z.int().min(1)]);

export const RequirementSchema = z
  .object({
    kind: z.enum(KIT_KINDS),
    use: z.enum(["assist", "resist"]).optional(),
    feature: z.enum(STATION_FEATURES).optional(),
    count: z.int().min(1).max(2).optional(),
  })
  .strict();

export const DefaultSchema = z
  .object({
    sets: z.int().min(1).max(10),
    reps: Range.optional(),
    seconds: Range.optional(),
    /** eccentric-pause-concentric-pause in seconds; X is explosive. */
    tempo: z
      .string()
      .regex(/^\d-\d-[\dX]-\d$/)
      .optional(),
    rest_s: z.int().min(0).max(600),
  })
  .strict();

const FlagBlock = z.templateLiteral([z.enum(JOINTS), ":", z.enum(SEVERITIES)]);

const exerciseShape = {
  id: Kebab,
  rung: z.int().min(1),
  names: z.object({ en: z.string().min(1) }).strict(),
  pattern: z.enum(PATTERNS),
  muscles: z.partialRecord(z.enum(MUSCLES), z.number().gt(0).lte(1)),
  requires: z.array(RequirementSchema).default([]),
  load: z.enum(LOAD_TYPES),
  unilateral: z.boolean(),
  default: DefaultSchema,
  cues: z.array(z.string().min(1)).min(1).max(4),
  flags_block: z.array(FlagBlock).default([]),
  clip: Kebab,
};

/** One exercise as authored inside a family file. The family comes from the file. */
export const FileExerciseSchema = z.object(exerciseShape).strict();

export const ExerciseSchema = z.object({ ...exerciseShape, family: Kebab }).strict();

export const FamilyFileSchema = z
  .object({
    family: Kebab,
    names: z.object({ en: z.string().min(1) }).strict(),
    /** ladder: rungs 1..N from easy to hard. pool: a set of equal options, all rung 1. */
    kind: z.enum(["ladder", "pool"]),
    exercises: z.array(FileExerciseSchema).min(1),
  })
  .strict();

export const FamilySchema = z
  .object({
    id: Kebab,
    names: z.object({ en: z.string().min(1) }).strict(),
    kind: z.enum(["ladder", "pool"]),
    rungs: z.int().min(1),
  })
  .strict();

export const CatalogueSchema = z
  .object({
    version: z.int().min(1),
    hash: z.string(),
    families: z.array(FamilySchema),
    exercises: z.array(ExerciseSchema),
  })
  .strict();

export type Muscle = (typeof MUSCLES)[number];
export type Pattern = (typeof PATTERNS)[number];
export type KitKind = (typeof KIT_KINDS)[number];
export type LoadType = (typeof LOAD_TYPES)[number];
export type Joint = (typeof JOINTS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Requirement = z.infer<typeof RequirementSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type Family = z.infer<typeof FamilySchema>;
export type FamilyFileInput = z.input<typeof FamilyFileSchema>;
export type Catalogue = z.infer<typeof CatalogueSchema>;
