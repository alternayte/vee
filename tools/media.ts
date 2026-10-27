// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise clips (docs/specs/exercise-clips.md). The source media and the map
// live in the private repo at .internal/media; this repo gets the output only.
//
//   bun tools/media.ts          build the clips into apps/mobile/assets/clips
//   bun tools/media.ts --check  fail when the map names an unknown exercise
//
// Each source clip is upscaled 3x (Real-ESRGAN), recoloured to the theme
// (dark lines take the text token, the red target muscles take the accent
// token, all on the surface token) and written as an animated WebP for the
// light and the dark theme. The motion and the frame timing stay the source's.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadCatalogue } from "../packages/catalogue/scripts/load";
import { colors, type ThemeName } from "../packages/tokens/src";
import { listFiles } from "./git";

const ROOT = join(import.meta.dirname, "..");
const MEDIA = join(ROOT, ".internal", "media");
const MAP = join(MEDIA, "map.yaml");
const SOURCE = join(MEDIA, "source");
const BUILT = join(MEDIA, "clips");
const WORK = join(MEDIA, "work");
const ASSETS = join(ROOT, "apps", "mobile", "assets", "clips");
const ESRGAN_DIR = join(homedir(), ".local", "share", "realesrgan");

const SIZE = 480;
const QUALITY = 40;
const THEMES: ThemeName[] = ["light", "dark"];

/** Vee exercise id → openGym exercise id. */
export function readMap(text: string): Map<string, string> {
  const raw = (Bun.YAML.parse(text) ?? {}) as Record<string, unknown>;
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string" || !/^\d+$/.test(v))
      throw new Error(`map.yaml: ${k}: the value must be a quoted openGym id`);
    map.set(k, v);
  }
  return map;
}

function exerciseIds(): string[] {
  const r = loadCatalogue();
  if (!r.ok) throw new Error("media: the catalogue does not build; run `just catalogue`");
  return r.catalogue.exercises.map((e) => e.id);
}

function run(cmd: string[]): string {
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${cmd[0]} failed: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
}

const hex = (c: string) =>
  [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16)) as [number, number, number];

/** ffmpeg geq: dark pixels become the figure colour, saturated pixels the accent; white becomes transparent. */
function recolour(theme: ThemeName): string {
  const [fr, fg, fb] = hex(colors[theme].text);
  const [ar, ag, ab] = hex(colors[theme].accent);
  const L = "(0.299*r(X,Y)+0.587*g(X,Y)+0.114*b(X,Y))";
  const S = "(max(r(X,Y),max(g(X,Y),b(X,Y)))-min(r(X,Y),min(g(X,Y),b(X,Y))))";
  const M = `clip((${S}-40)/80,0,1)`;
  const A = `clip(max((255-${L})*1.6,${M}*230),0,255)`;
  return `format=rgba,geq=r='${fr}+(${ar - fr})*${M}':g='${fg}+(${ag - fg})*${M}':b='${fb}+(${ab - fb})*${M}':a='if(lt(${A},12),0,${A})'`;
}

/** Per-frame durations in ms, from the source timestamps. */
function durations(clip: string): number[] {
  return run([
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "v",
    "-show_entries",
    "frame=duration_time",
    "-of",
    "csv=p=0",
    clip,
  ])
    .trim()
    .split("\n")
    .map((l) => Math.max(20, Math.round(Number.parseFloat(l) * 1000)));
}

function buildClip(source: string, esrgan: string) {
  const clip = join(SOURCE, `${source}.mp4`);
  const dir = join(WORK, source);
  rmSync(dir, { recursive: true, force: true });
  for (const d of ["in", "up", ...THEMES]) mkdirSync(join(dir, d), { recursive: true });
  run(["ffmpeg", "-v", "error", "-i", clip, "-fps_mode", "passthrough", join(dir, "in", "%03d.png")]);
  run([
    esrgan,
    "-i",
    join(dir, "in"),
    "-o",
    join(dir, "up"),
    "-n",
    "realesr-animevideov3-x3",
    "-s",
    "3",
    "-m",
    join(ESRGAN_DIR, "models"),
    "-f",
    "png",
  ]);
  const ms = durations(clip);
  const frames = readdirSync(join(dir, "up"))
    .filter((f) => f.endsWith(".png"))
    .sort();
  if (frames.length !== ms.length)
    throw new Error(`media: ${source}: ${frames.length} frames but ${ms.length} durations`);
  for (const theme of THEMES) {
    const surface = colors[theme].surface.slice(1);
    run([
      "ffmpeg",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x${surface}:s=${SIZE}x${SIZE}`,
      "-i",
      join(dir, "up", "%03d.png"),
      "-filter_complex",
      `[1]scale=${SIZE}:${SIZE}:flags=lanczos,${recolour(theme)}[f];[0][f]overlay=shortest=1,format=rgb24`,
      "-fps_mode",
      "passthrough",
      join(dir, theme, "%03d.png"),
    ]);
    const args = frames.flatMap((f, i) => ["-d", String(ms[i]), join(dir, theme, f)]);
    run([
      "img2webp",
      "-loop",
      "0",
      "-lossy",
      "-q",
      String(QUALITY),
      "-m",
      "4",
      ...args,
      "-o",
      join(BUILT, `${source}-${theme}.webp`),
    ]);
  }
  rmSync(dir, { recursive: true, force: true });
}

/** A change to the look or the encoder rebuilds every clip. */
function stamp(): string {
  const look = {
    SIZE,
    QUALITY,
    recolour: THEMES.map(recolour),
    surface: THEMES.map((t) => colors[t].surface),
  };
  return createHash("sha256").update(JSON.stringify(look)).digest("hex").slice(0, 16);
}

function build() {
  if (!existsSync(MAP)) {
    rmSync(ASSETS, { recursive: true, force: true });
    console.log("media: no .internal/media/map.yaml; the app shows cues only");
    return;
  }
  const map = readMap(readFileSync(MAP, "utf8"));
  const ids = exerciseIds();
  const unknown = [...map.keys()].filter((k) => !ids.includes(k));
  if (unknown.length)
    throw new Error(`media: map.yaml names exercises that are not in the catalogue: ${unknown.join(", ")}`);
  const esrgan = join(ESRGAN_DIR, "realesrgan-ncnn-vulkan");
  if (!existsSync(esrgan))
    throw new Error(`media: no Real-ESRGAN at ${esrgan}; install realesrgan-ncnn-vulkan there`);

  mkdirSync(BUILT, { recursive: true });
  const stampFile = join(BUILT, "stamp");
  const fresh = existsSync(stampFile) && readFileSync(stampFile, "utf8").trim() === stamp();
  const sources = [...new Set(map.values())].sort();
  for (const s of sources) {
    if (!existsSync(join(SOURCE, `${s}.mp4`))) throw new Error(`media: no source clip ${s}.mp4 in ${SOURCE}`);
    const done = THEMES.every((t) => existsSync(join(BUILT, `${s}-${t}.webp`)));
    if (fresh && done) continue;
    console.log(`media: ${s}`);
    buildClip(s, esrgan);
  }
  writeFileSync(stampFile, `${stamp()}\n`);

  rmSync(ASSETS, { recursive: true, force: true });
  mkdirSync(ASSETS, { recursive: true });
  for (const s of sources)
    for (const t of THEMES) copyFileSync(join(BUILT, `${s}-${t}.webp`), join(ASSETS, `${s}-${t}.webp`));
  const rows = [...map]
    .sort()
    .map(
      ([id, s]) => `  "${id}": { light: require("./${s}-light.webp"), dark: require("./${s}-dark.webp") },`,
    );
  writeFileSync(
    join(ASSETS, "index.js"),
    `// Generated by tools/media.ts. Not committed.\nmodule.exports = {\n${rows.join("\n")}\n};\n`,
  );

  const bytes = sources.reduce(
    (n, s) => n + THEMES.reduce((m, t) => m + Bun.file(join(ASSETS, `${s}-${t}.webp`)).size, 0),
    0,
  );
  console.log(
    `media: ${map.size} exercises, ${sources.length} clips, ${(bytes / 1e6).toFixed(1)} MB → ${ASSETS}`,
  );
  const missing = ids.filter((id) => !map.has(id));
  console.log(
    missing.length ? `media: no clip (cues only): ${missing.join(", ")}` : "media: every exercise has a clip",
  );
}

/**
 * The .gitignore rules that .easignore lacks. EAS reads .easignore instead of
 * every .gitignore, so a rule missing there uploads that file to EAS.
 */
export function easignoreGaps(gitignores: Record<string, string>, easignore: string): string[] {
  const rules = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
  const have = new Set(rules(easignore));
  const gaps: string[] = [];
  for (const [file, text] of Object.entries(gitignores)) {
    const dir = file.slice(0, -".gitignore".length);
    for (const r of rules(text)) {
      if (`${dir}${r}` === CLIPS_RULE) continue;
      const forms = dir === "" ? [r] : [`${dir}${r.replace(/^\//, "")}`, `${dir}**/${r}`];
      if (!forms.some((f) => have.has(f))) gaps.push(`${file}: ${r}`);
    }
  }
  return gaps;
}

const CLIPS_RULE = "apps/mobile/assets/clips/";

function check() {
  const gitignores = Object.fromEntries(
    listFiles()
      .filter((p) => p === ".gitignore" || p.endsWith("/.gitignore"))
      .map((p) => [p, readFileSync(join(ROOT, p), "utf8")]),
  );
  const gaps = easignoreGaps(gitignores, readFileSync(join(ROOT, ".easignore"), "utf8"));
  if (gaps.length) {
    console.error(
      `media: .easignore lacks these .gitignore rules, so EAS uploads the files:\n  ${gaps.join("\n  ")}`,
    );
    process.exit(1);
  }
  if (!existsSync(MAP)) return; // A public clone has no .internal; the app shows cues only.
  const ids = exerciseIds();
  const unknown = [...readMap(readFileSync(MAP, "utf8")).keys()].filter((k) => !ids.includes(k));
  if (unknown.length) {
    console.error(
      `media: map.yaml names exercises that are not in the catalogue:\n  ${unknown.join("\n  ")}`,
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  try {
    if (process.argv.includes("--check")) check();
    else build();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
