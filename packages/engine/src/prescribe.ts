// SPDX-License-Identifier: AGPL-3.0-or-later
// Prescription: today's numbers for one session, from the template, progress
// state, readiness, deload and climbing. Frozen at session start (I3).
import type { Exercise } from "@vee/catalogue";
import { snapLoad } from "./dial";
import { bandOptions, checkAllowed, loadOptions } from "./kit";
import { chooseLoad, familyName, pickExercise } from "./plan";
import { deloadStatus } from "./readiness";
import { reason } from "./reasons";
import { climbedRecently } from "./rotation";
import { estimateMinutes, orderForDial, timeCut } from "./time";
import type {
  EngineInput,
  PrescribedItem,
  Prescription,
  ReadinessMode,
  Reason,
  SessionTemplate,
  TemplateItem,
} from "./types";

export const RECOVERY_MINUTES = 15;
export const RECOVERY_SETS = 2;
export const WARMUP_LOAD_SHARE = 0.5;
export const DEFAULT_TEMPO = "2-0-1-0";

export type PrescribeContext = {
  readiness: ReadinessMode;
  /** "I only have 20 min". */
  minutes?: number;
  /** Families to keep when the time cut drops accessories. */
  focus?: string[];
  sessionId?: string;
};

/** Applies a tempo stage to a catalogue tempo: 1 sets 3 s lowering, 2 adds a 1 s pause. */
export function stagedTempo(tempo: string, stage: number): string {
  const [ecc = "2", pause = "0", con = "1", top = "0"] = tempo.split("-");
  const e = stage >= 1 ? String(Math.max(Number(ecc), 3)) : ecc;
  const p = stage >= 2 ? String(Math.max(Number(pause), 1)) : pause;
  return `${e}-${p}-${con}-${top}`;
}

function buildItem(
  input: EngineInput,
  t: Pick<TemplateItem, "order" | "role" | "sets" | "reasons" | "pairGroup">,
  e: Exercise,
  exReason: Reason,
): PrescribedItem {
  const raw = input.history.progress.find((p) => p.family === e.family);
  const state = raw?.exerciseId === e.id ? raw : undefined;
  const reasons: PrescribedItem["reasons"] = {
    exercise: exReason,
    sets: [...t.reasons.sets],
    target: t.reasons.target,
  };

  let target: PrescribedItem["target"];
  if (e.load === "timed" && e.default.seconds) {
    const hold = state?.holdS ?? e.default.seconds[0];
    target = { unit: "seconds", low: hold, high: hold };
    reasons.target = reason(state?.holdS !== undefined ? "HOLD_STATE" : "HOLD_START", { hold });
  } else {
    const range = state?.repOverride ?? { low: e.default.reps?.[0] ?? 1, high: e.default.reps?.[1] ?? 1 };
    target = { unit: "reps", ...range };
    reasons.target = state?.repOverride
      ? reason("TARGET_PLACEMENT", { low: range.low, high: range.high })
      : reason("TARGET_DEFAULT", { low: range.low, high: range.high, unit: "reps" });
  }

  let sets = t.sets;
  const stage = state?.tempoStage ?? 0;
  const item: PrescribedItem = {
    order: t.order,
    family: e.family,
    exerciseId: e.id,
    role: t.role,
    sets,
    target,
    restS: e.default.rest_s,
    reasons,
  };
  if (t.pairGroup !== undefined) item.pairGroup = t.pairGroup;

  const load = chooseLoad(input, e);
  if (load) {
    item.loadKg = load.loadKg;
    reasons.load = load.reason;
  }

  if (e.load === "band-assist" || e.load === "band-resist") {
    const options = bandOptions(e, input.kit);
    const kept = options.find((o) => o.bandId === state?.band?.bandId && o.setting === state?.band?.setting);
    const b = kept ?? options[0];
    if (b) {
      item.band = { bandId: b.bandId, setting: b.setting };
      reasons.band = reason(kept ? "BAND_STATE" : "BAND_START", {
        setting: b.setting === "double" ? "doubled" : b.setting,
      });
    }
  }

  if (e.default.tempo !== undefined || stage > 0) {
    item.tempo = stagedTempo(e.default.tempo ?? DEFAULT_TEMPO, stage);
    if (stage > 0) reasons.tempo = reason("TEMPO_STAGE", { stage, tempo: item.tempo });
    else reasons.tempo = reason("TEMPO_DEFAULT", { tempo: item.tempo });
  }
  if (stage === 3) {
    sets += 1;
    reasons.sets.push(reason("SETS_EXTRA", { sets }));
  }
  item.sets = sets;
  return item;
}

function adjustSets(
  items: PrescribedItem[],
  fn: (s: number) => number,
  r: Reason,
  pick: (i: PrescribedItem) => boolean = () => true,
): boolean {
  let changed = false;
  for (const i of items) {
    if (!pick(i)) continue;
    const next = fn(i.sets);
    if (next !== i.sets) {
      i.sets = next;
      i.reasons.sets.push(r);
      changed = true;
    }
  }
  return changed;
}

function warmup(input: EngineInput, items: PrescribedItem[]): PrescribedItem[] {
  return items
    .filter((i) => i.role === "main")
    .slice(0, 2)
    .map((i, n) => {
      const e = input.catalogue.exercises.find((x) => x.id === i.exerciseId) as Exercise;
      const r = reason("WARMUP", {});
      const half = (v: number) => Math.max(1, Math.ceil(v / 2));
      const w: PrescribedItem = {
        ...i,
        order: n + 1,
        sets: 1,
        target: { unit: i.target.unit, low: half(i.target.low), high: half(i.target.low) },
        restS: 30,
        reasons: { exercise: i.reasons.exercise, sets: [r], target: r },
      };
      delete w.pairGroup;
      if (i.loadKg !== undefined) {
        w.loadKg = snapLoad(loadOptions(e, input.kit), i.loadKg * WARMUP_LOAD_SHARE) as number;
        w.reasons.load = r;
      }
      return w;
    });
}

function recovery(input: EngineInput, template: SessionTemplate, c: PrescribeContext): Prescription {
  const items: PrescribedItem[] = [];
  const mobility = input.catalogue.exercises
    .filter((e) => e.family === "mobility" && checkAllowed(e, input.kit, input.flags, input.today).ok)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 2);
  const r = reason("READINESS_RECOVERY", { minutes: RECOVERY_MINUTES, sets: RECOVERY_SETS });
  for (const e of mobility) {
    const range = e.default.reps ?? e.default.seconds ?? [1, 1];
    items.push({
      order: 0,
      family: e.family,
      exerciseId: e.id,
      role: "accessory",
      sets: 1,
      target: { unit: e.default.reps ? "reps" : "seconds", low: range[0], high: range[1] },
      restS: 0,
      reasons: { exercise: r, sets: [r], target: r },
    });
  }
  const mains: PrescribedItem[] = [];
  for (const t of template.items.filter((i) => i.role === "main").slice(0, 2)) {
    const pick = pickExercise(input, t.family);
    if (!pick) continue;
    const it = buildItem(input, { ...t, sets: RECOVERY_SETS }, pick.exercise, pick.reason);
    it.sets = RECOVERY_SETS;
    it.target = { ...it.target, high: it.target.low };
    it.reasons.sets.push(r);
    mains.push(it);
  }
  const ordered = [...mains, ...items];
  const cut = timeCut(
    ordered,
    c.minutes === undefined ? RECOVERY_MINUTES : Math.min(c.minutes, RECOVERY_MINUTES),
    input.catalogue,
  );
  const final = cut.items.map((i, n) => ({ ...i, order: n + 1 }));
  return {
    ...(c.sessionId ? { sessionId: c.sessionId } : {}),
    kind: "recovery",
    dayType: template.dayType,
    readinessMode: "recovery",
    deload: false,
    engineVersion: input.engineVersion,
    warmup: [],
    items: final,
    estimatedMinutes: estimateMinutes(final, input.catalogue),
    reasons: [r, ...cut.reasons],
  };
}

export function prescribe(input: EngineInput, template: SessionTemplate, c: PrescribeContext): Prescription {
  if (c.readiness === "recovery") return recovery(input, template, c);
  const reasons: Reason[] = [...template.reasons];
  const items: PrescribedItem[] = [];
  for (const t of template.items) {
    const pick = pickExercise(input, t.family);
    if (!pick) {
      reasons.push(reason("PLAN_NO_OPTION", { family: t.family, familyName: familyName(input, t.family) }));
      continue;
    }
    items.push(buildItem(input, t, pick.exercise, pick.reason));
  }

  if ((template.dayType === "A" || template.dayType === "D") && climbedRecently(input)) {
    const r = reason("CLIMB_PULL", {});
    if (
      adjustSets(
        items,
        (s) => Math.max(1, s - 1),
        r,
        (i) => i.family === "vertical-pull",
      )
    )
      reasons.push(r);
  }
  const deload = deloadStatus(input);
  if (deload.deload) {
    const r = reason("DELOAD_SETS", {});
    adjustSets(items, (s) => Math.ceil(s / 2), r);
    reasons.push(...deload.reasons);
  }
  if (c.readiness === "trimmed") {
    const r = reason("READINESS_TRIMMED", {});
    adjustSets(items, (s) => Math.max(1, s - 1), r);
    reasons.push(r);
  }

  // Priority order for the time cut: mains, then focus accessories, then the rest.
  const focus = new Set(c.focus ?? []);
  const priority = [
    ...items.filter((i) => i.role === "main"),
    ...items.filter((i) => i.role === "accessory" && focus.has(i.family)),
    ...items.filter((i) => i.role === "accessory" && !focus.has(i.family)),
  ];
  const minutes = c.minutes ?? input.profile.minutesPerSession;
  const cut = timeCut(priority, minutes, input.catalogue);
  reasons.push(...cut.reasons);
  const final = orderForDial(cut.items, input.catalogue);

  return {
    ...(c.sessionId ? { sessionId: c.sessionId } : {}),
    kind: "main",
    dayType: template.dayType,
    readinessMode: c.readiness,
    deload: deload.deload,
    engineVersion: input.engineVersion,
    warmup: warmup(input, final),
    items: final,
    estimatedMinutes: estimateMinutes(final, input.catalogue),
    reasons,
  };
}
