// SPDX-License-Identifier: AGPL-3.0-or-later
// Turns parsed family files into one catalogue. Pure: the caller reads the
// files and writes the output.
import {
  CATALOGUE_VERSION,
  type Catalogue,
  type Exercise,
  type Family,
  FamilyFileSchema,
  type Requirement,
} from "./schema";

export type BuildError = { where: string; code: string; message: string };

export type BuildResult =
  | { ok: true; catalogue: Omit<Catalogue, "hash"> }
  | { ok: false; errors: BuildError[] };

const IMPLEMENTS = new Set(["dumbbell", "kettlebell", "barbell"]);
const MAX_CUE_WORDS = 20;

export function buildCatalogue(files: unknown[]): BuildResult {
  const errors: BuildError[] = [];
  const families: Family[] = [];
  const exercises: Exercise[] = [];
  const familyIds = new Set<string>();
  const exerciseIds = new Set<string>();

  files.forEach((raw, i) => {
    const parsed = FamilyFileSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ where: `file ${i}: ${issue.path.join(".")}`, code: "schema", message: issue.message });
      }
      return;
    }
    const f = parsed.data;
    if (familyIds.has(f.family)) {
      errors.push({ where: f.family, code: "duplicate-family", message: "family is defined twice" });
      return;
    }
    familyIds.add(f.family);

    for (const e of f.exercises) {
      const err = (code: string, message: string) =>
        errors.push({ where: `${f.family}/${e.id}`, code, message });
      if (exerciseIds.has(e.id)) err("duplicate-exercise", "exercise id is used twice");
      exerciseIds.add(e.id);
      if (f.kind === "pool" && e.rung !== 1) err("pool-rung", "pool exercises are all rung 1");
      checkExercise(e, err);
      exercises.push({ ...e, family: f.family });
    }

    const rungs = new Set(f.exercises.map((e) => e.rung));
    const top = Math.max(...rungs);
    for (let n = 1; n <= top; n++) {
      if (!rungs.has(n)) {
        errors.push({ where: f.family, code: "rung-gap", message: `no exercise on rung ${n}` });
      }
    }
    families.push({ id: f.family, names: f.names, kind: f.kind, rungs: top });
  });

  if (errors.length > 0) return { ok: false, errors };

  families.sort((a, b) => a.id.localeCompare(b.id));
  exercises.sort((a, b) => a.family.localeCompare(b.family) || a.rung - b.rung || a.id.localeCompare(b.id));
  return { ok: true, catalogue: { version: CATALOGUE_VERSION, families, exercises } };
}

type Authored = Omit<Exercise, "family">;

function checkExercise(e: Authored, err: (code: string, message: string) => void): void {
  const weights = Object.values(e.muscles);
  if (!weights.includes(1)) err("no-primary-muscle", "one muscle must have weight 1");

  const d = e.default;
  for (const range of [d.reps, d.seconds]) {
    if (range && range[0] > range[1]) err("range-order", "range low is above high");
  }
  if (e.load === "timed") {
    if (!d.seconds || d.reps) err("timed-needs-seconds", "timed load uses seconds, not reps");
  } else if (!d.reps || d.seconds) {
    err("reps-needs-reps", `${e.load} load uses reps, not seconds`);
  }

  for (const r of e.requires) checkRequirement(r, err);

  const hasImplement = e.requires.some((r) => IMPLEMENTS.has(r.kind));
  const band = (use: "assist" | "resist") => e.requires.some((r) => r.kind === "band" && r.use === use);
  switch (e.load) {
    case "dial":
    case "fixed":
      if (!hasImplement)
        err("load-needs-implement", `${e.load} load needs a dumbbell, kettlebell or barbell`);
      break;
    case "band-assist":
      if (!band("assist")) err("load-needs-band", "band-assist load needs a band with use: assist");
      break;
    case "band-resist":
      if (!band("resist")) err("load-needs-band", "band-resist load needs a band with use: resist");
      break;
    case "bodyweight":
      if (hasImplement || e.requires.some((r) => r.kind === "band")) {
        err("bodyweight-with-load", "bodyweight load must not need an implement or a band");
      }
      break;
    case "timed":
      break;
  }

  for (const cue of e.cues) {
    const sentences = cue.match(/[.!?](\s|$)/g)?.length ?? 0;
    if (sentences !== 1 || !/[.!?]$/.test(cue)) err("cue-one-sentence", `cue must be one sentence: "${cue}"`);
    if (cue.split(/\s+/).length > MAX_CUE_WORDS)
      err("cue-too-long", `cue has more than ${MAX_CUE_WORDS} words`);
  }
}

function checkRequirement(r: Requirement, err: (code: string, message: string) => void): void {
  if (r.kind === "band" && r.use === undefined)
    err("band-needs-use", "a band requirement needs use: assist or resist");
  if (r.use !== undefined && r.kind !== "band") err("bad-requirement", "use is only for bands");
  if (r.feature !== undefined && r.kind !== "pullup_station") {
    err("bad-requirement", "feature is only for the pull-up station");
  }
  if (r.count !== undefined && r.kind !== "dumbbell" && r.kind !== "kettlebell") {
    err("bad-requirement", "count is only for dumbbells and kettlebells");
  }
}
