// SPDX-License-Identifier: AGPL-3.0-or-later
// CSV import from Hevy, Strong and FitNotes. Pure: the caller reads the file
// and writes the rows. Known exercise names map to catalogue ids; other names
// become custom exercises.

export type ImportFormat = "hevy" | "strong" | "fitnotes";
export type Effort = "easy" | "good" | "hard" | "failed";

export type ImportSet = {
  exerciseId: string;
  reps?: number;
  seconds?: number;
  loadKg?: number;
  effort: Effort;
};
export type ImportSession = { key: string; date: string; name: string; sets: ImportSet[] };
export type ImportResult = {
  format: ImportFormat;
  sessions: ImportSession[];
  customExercises: { id: string; name: string }[];
};

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const firstLine = (text: string) => text.slice(0, text.search(/\r?\n|$/));

export function detectFormat(text: string): ImportFormat | undefined {
  const head = firstLine(text).toLowerCase();
  if (head.includes("exercise_title") && head.includes("set_index")) return "hevy";
  if (head.includes("exercise name") && head.includes("set order")) return "strong";
  if (head.includes("exercise") && head.includes("category") && head.includes("weight (kgs)"))
    return "fitnotes";
  return undefined;
}

const ALIASES: Record<string, string[]> = {
  "pullup-strict": ["pull up", "pullup", "pull ups", "wide grip pull up"],
  "chinup-strict": ["chin up", "chinup", "chin ups"],
  "pullup-band-assisted": ["assisted pull up band", "band assisted pull up"],
  "dead-hang": ["dead hang", "hang"],
  "dip-full": ["dip", "dips", "chest dip", "triceps dip", "tricep dip"],
  "pushup-floor": ["push up", "pushup", "push ups"],
  "row-single-arm-db": [
    "dumbbell row",
    "row dumbbell",
    "bent over row dumbbell",
    "single arm dumbbell row",
    "one arm row",
  ],
  "goblet-squat": ["goblet squat"],
  "split-squat": ["split squat", "split squat dumbbell"],
  "split-squat-rear-foot-raised": [
    "bulgarian split squat",
    "bulgarian split squat dumbbell",
    "rear foot elevated split squat",
  ],
  "rdl-single-leg-db": [
    "single leg romanian deadlift",
    "single leg romanian deadlift dumbbell",
    "single leg rdl",
  ],
  "glute-bridge": ["glute bridge", "hip bridge"],
  "dead-bug": ["dead bug"],
  "hanging-knee-raise": ["hanging knee raise"],
  "hanging-leg-raise": ["hanging leg raise"],
  "l-sit": ["l sit"],
  plank: ["plank"],
  "side-plank": ["side plank"],
  "hollow-hold": ["hollow hold", "hollow body hold"],
  "lateral-raise-db": [
    "lateral raise",
    "lateral raise dumbbell",
    "dumbbell lateral raise",
    "side lateral raise",
  ],
  "lateral-raise-band": ["lateral raise band", "band lateral raise"],
  "face-pull-band": ["face pull", "face pull band"],
  "band-pull-apart": ["band pull apart", "pull apart band"],
  "rear-delt-raise-db": ["rear delt raise", "rear delt fly dumbbell", "reverse fly dumbbell"],
  "press-standing-db": [
    "overhead press dumbbell",
    "shoulder press dumbbell",
    "dumbbell shoulder press",
    "single arm shoulder press",
  ],
  "floor-press-db": ["floor press", "floor press dumbbell"],
  "triceps-overhead-db": ["triceps extension dumbbell", "tricep extension", "overhead triceps extension"],
  "triceps-pushdown-band": ["triceps pushdown band", "tricep pushdown"],
  "curl-db": ["dumbbell curl", "bicep curl dumbbell", "biceps curl", "bicep curl"],
  "curl-hammer-db": ["hammer curl", "hammer curl dumbbell"],
  "curl-band": ["bicep curl band", "band curl"],
  "suitcase-carry": ["suitcase carry", "farmers walk", "farmer walk"],
  burpee: ["burpee", "burpees"],
};

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIAS_INDEX = new Map<string, string>();
for (const [id, names] of Object.entries(ALIASES)) for (const n of names) ALIAS_INDEX.set(normalise(n), id);

/** The catalogue ids the alias table maps to. */
export const aliasTargets = (): string[] => Object.keys(ALIASES);

export function matchExercise(name: string): string | undefined {
  return ALIAS_INDEX.get(normalise(name));
}

const kebab = (s: string) => normalise(s).replaceAll(" ", "-");

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

function effortFromRpe(rpe: number | undefined): Effort {
  if (rpe === undefined) return "good";
  if (rpe >= 10) return "failed";
  if (rpe >= 8) return "hard";
  if (rpe >= 7) return "good";
  return "easy";
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "12 Oct 2026, 18:05" or "2026-10-12 18:05:00" or "2026-10-12" → "2026-10-12". */
function isoDate(s: string): string {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const hevy = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})/);
  if (hevy) {
    const m = MONTHS.indexOf((hevy[2] ?? "").toLowerCase()) + 1;
    if (m > 0) return `${hevy[3]}-${String(m).padStart(2, "0")}-${String(hevy[1]).padStart(2, "0")}`;
  }
  throw new Error(`unknown date: ${s}`);
}

/** "0:00:40", "1:20" or "45" → seconds. */
function seconds(s: string | undefined): number | undefined {
  if (!s || s.trim() === "") return undefined;
  const parts = s.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  const total = parts.reduce((acc, p) => acc * 60 + p, 0);
  return total > 0 ? total : undefined;
}

type Raw = {
  key: string;
  date: string;
  name: string;
  exercise: string;
  reps?: number | undefined;
  seconds?: number | undefined;
  loadKg?: number | undefined;
  rpe?: number | undefined;
};

function rowsOf(text: string, sep: string): Record<string, string>[] {
  const [head, ...body] = parseCsv(text, sep);
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

function readHevy(text: string): Raw[] {
  return rowsOf(text, ",")
    .filter((r) => (r.set_type ?? "normal") !== "warmup")
    .map((r) => ({
      key: `${r.title}|${r.start_time}`,
      date: isoDate(r.start_time ?? ""),
      name: r.title ?? "",
      exercise: r.exercise_title ?? "",
      reps: num(r.reps),
      seconds: num(r.duration_seconds),
      loadKg: num(r.weight_kg),
      rpe: num(r.rpe),
    }));
}

function readStrong(text: string): Raw[] {
  const sep = firstLine(text).includes(";") ? ";" : ",";
  return rowsOf(text, sep).map((r) => ({
    key: `${r["workout name"]}|${r.date}`,
    date: isoDate(r.date ?? ""),
    name: r["workout name"] ?? "",
    exercise: r["exercise name"] ?? "",
    reps: num(r.reps),
    seconds: num(r.seconds),
    loadKg: num(r.weight),
    rpe: num(r.rpe),
  }));
}

function readFitNotes(text: string): Raw[] {
  return rowsOf(text, ",").map((r) => ({
    key: r.date ?? "",
    date: isoDate(r.date ?? ""),
    name: "FitNotes",
    exercise: r.exercise ?? "",
    reps: num(r.reps),
    seconds: seconds(r.time),
    loadKg: num(r["weight (kgs)"]),
  }));
}

export function parseImport(text: string): ImportResult {
  const format = detectFormat(text);
  if (!format) throw new Error("This file is not a Hevy, Strong or FitNotes CSV export.");
  const raw =
    format === "hevy" ? readHevy(text) : format === "strong" ? readStrong(text) : readFitNotes(text);
  const sessions = new Map<string, ImportSession>();
  const custom = new Map<string, string>();
  for (const r of raw) {
    if (!r.exercise) continue;
    let id = matchExercise(r.exercise);
    if (!id) {
      id = `custom-${kebab(r.exercise)}`;
      custom.set(id, r.exercise);
    }
    const reps = r.reps !== undefined && r.reps > 0 ? Math.round(r.reps) : undefined;
    const secs = r.seconds !== undefined && r.seconds > 0 ? Math.round(r.seconds) : undefined;
    if (reps === undefined && secs === undefined) continue;
    const s = sessions.get(r.key) ?? { key: r.key, date: r.date, name: r.name, sets: [] };
    const set: ImportSet = { exerciseId: id, effort: effortFromRpe(r.rpe) };
    if (reps !== undefined) set.reps = reps;
    if (secs !== undefined && reps === undefined) set.seconds = secs;
    if (r.loadKg !== undefined && r.loadKg > 0) set.loadKg = r.loadKg;
    s.sets.push(set);
    sessions.set(r.key, s);
  }
  return {
    format,
    sessions: [...sessions.values()],
    customExercises: [...custom].map(([id, name]) => ({ id, name })),
  };
}
