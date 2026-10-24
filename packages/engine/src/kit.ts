// SPDX-License-Identifier: AGPL-3.0-or-later
// Kit resolution: what the user's kit and flags allow, and which loads they can set.
import type { Exercise, KitKind, Requirement } from "@vee/catalogue";
import type { Flag, KitItem, LocalDate } from "./types";

export type Allowed =
  | { ok: true }
  | { ok: false; why: "kit"; missing: KitKind }
  | { ok: false; why: "flag"; flag: string };

export type BandSetting = "single" | "short" | "double";

/** One way to use a band. `estKg` is for ordering only; the app never shows it as a precise number. */
export type BandOption = { bandId: string; setting: BandSetting; estKg: number };

const BAND_FACTOR: Record<BandSetting, number> = { single: 1, short: 1.5, double: 2 };

export function activeFlags(flags: Flag[], today: LocalDate): Flag[] {
  return flags.filter((f) => f.activeFrom <= today && (f.activeTo === undefined || today <= f.activeTo));
}

function implementItems(req: Requirement, kit: KitItem[]): KitItem[] {
  const count = req.count ?? 1;
  return kit.filter((k) => {
    if (req.kind === "dumbbell") return (k.kind === "dial_db" || k.kind === "fixed_db") && k.count >= count;
    if (req.kind === "kettlebell") return k.kind === "kettlebell" && k.count >= count;
    return false;
  });
}

function meets(req: Requirement, kit: KitItem[]): boolean {
  switch (req.kind) {
    case "dumbbell":
    case "kettlebell":
      return implementItems(req, kit).length > 0;
    case "band":
      return kit.some((k) => k.kind === "band");
    case "pullup_station":
      return kit.some((k) => {
        if (k.kind !== "pullup_station") return false;
        if (req.feature === "dip_handles") return k.params.dipHandles;
        if (req.feature === "neutral_grips") return k.params.grips.includes("neutral");
        return true;
      });
    case "bench":
    case "rings":
      return kit.some((k) => k.kind === req.kind);
    case "barbell":
    case "rack":
      return false;
  }
}

/** Invariant I6: the engine never gives an exercise that this check rejects. */
export function checkAllowed(e: Exercise, kit: KitItem[], flags: Flag[], today: LocalDate): Allowed {
  for (const r of e.requires) {
    if (!meets(r, kit)) return { ok: false, why: "kit", missing: r.kind };
  }
  const active = activeFlags(flags, today);
  for (const block of e.flags_block) {
    const [joint, severity] = block.split(":");
    if (active.some((f) => f.joint === joint && (severity === "mild" || f.severity === "acute"))) {
      return { ok: false, why: "flag", flag: block };
    }
  }
  return { ok: true };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

function itemLoads(k: KitItem): number[] {
  switch (k.kind) {
    case "dial_db": {
      const { min, max, step } = k.params;
      const n = Math.floor(round((max - min) / step));
      return Array.from({ length: n + 1 }, (_, i) => round(min + i * step));
    }
    case "fixed_db":
    case "kettlebell":
      return k.params.weights;
    default:
      return [];
  }
}

/** The loads in kg the user can set for this exercise, lightest first. Empty for unloaded work. */
export function loadOptions(e: Exercise, kit: KitItem[]): number[] {
  const loads = new Set<number>();
  for (const r of e.requires) {
    for (const k of implementItems(r, kit)) for (const l of itemLoads(k)) loads.add(l);
  }
  return [...loads].sort((a, b) => a - b);
}

/**
 * Band settings for band work. Resist work goes from light to strong.
 * Assist work goes from most help to least help.
 */
export function bandOptions(e: Exercise, kit: KitItem[]): BandOption[] {
  const req = e.requires.find((r) => r.kind === "band");
  if (!req?.use) return [];
  const settings: BandSetting[] = req.use === "resist" ? ["single", "short", "double"] : ["single", "double"];
  const options = kit.flatMap((k) =>
    k.kind === "band"
      ? settings.map((setting) => ({
          bandId: k.id,
          setting,
          estKg: round(k.params.estKg * BAND_FACTOR[setting]),
        }))
      : [],
  );
  const asc = (a: BandOption, b: BandOption) =>
    a.estKg - b.estKg ||
    a.bandId.localeCompare(b.bandId) ||
    settings.indexOf(a.setting) - settings.indexOf(b.setting);
  options.sort(asc);
  return req.use === "resist" ? options : options.reverse();
}
