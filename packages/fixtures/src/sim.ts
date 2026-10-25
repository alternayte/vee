// SPDX-License-Identifier: AGPL-3.0-or-later
// The V5 simulation: a seeded athlete model logs every prescribed set for 26
// weeks. V5 checks the engine with it; V12 takes weekly-review fixtures from it.
import { loadCatalogue } from "@vee/catalogue/load";
import {
  addDays,
  applyPlacements,
  blockWeek,
  CALIBRATION_SESSIONS,
  type Checkin,
  checkAllowed,
  closeSession,
  deloadStatus,
  type Effort,
  ENGINE_VERSION,
  type EngineInput,
  emptyHistory,
  estimateSeconds,
  generatePlan,
  isBigJump,
  isoWeek,
  type LoggedSet,
  loadOptions,
  microSession,
  nextSession,
  type Prescription,
  type ProgressState,
  placeFromTest,
  prescribe,
  readinessMode,
  readinessScore,
  rebuildProgress,
  type SessionRecord,
  type TestResult,
  V_TAPER_LEAN_GAIN,
} from "@vee/engine";
import { BASELINE_DATE, type Persona } from "./personas";

export const WEEKS = 26;
const loaded = loadCatalogue();
if (!loaded.ok) throw new Error("catalogue does not build");
const catalogue = loaded.catalogue;
const ex = (id: string) =>
  catalogue.exercises.find((e) => e.id === id) as (typeof catalogue.exercises)[number];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** The athlete: a capacity per family, in reps or seconds at the current step. */
class Athlete {
  private skill = new Map<string, number>();
  private step = new Map<string, string>();
  constructor(private rng: () => number) {}

  private stepKey(i: Prescription["items"][number]) {
    return `${i.exerciseId}|${i.loadKg ?? ""}|${i.band?.setting ?? ""}|${i.tempo ?? ""}`;
  }

  /** Reps or seconds the athlete can do on this item today. */
  capacity(i: Prescription["items"][number]): number {
    const key = this.stepKey(i);
    const prev = this.step.get(i.family);
    let s = this.skill.get(i.family);
    if (s === undefined) {
      const e = ex(i.exerciseId);
      const lightest = i.loadKg !== undefined && i.loadKg === loadOptions(e, kitOf.get(i.family) ?? [])[0];
      s = lightest ? i.target.high + 4 : i.target.low + 1 + this.rng() * 2;
    } else if (prev !== undefined && prev !== key) {
      // A harder step costs capacity; an easier one gives some back.
      s = i.target.unit === "seconds" ? s : s * (prev < key ? 0.85 : 1.05);
      if (i.target.unit === "reps" && s < i.target.low - 1) s = i.target.low - 1 + this.rng();
    }
    this.skill.set(i.family, s);
    this.step.set(i.family, key);
    return s;
  }

  train(family: string, unit: "reps" | "seconds") {
    const s = this.skill.get(family);
    if (s !== undefined) this.skill.set(family, s + (unit === "reps" ? 0.3 : 1.5) * (0.5 + this.rng()));
  }

  logSets(p: Prescription, sessionId: string, date: string): LoggedSet[] {
    const out: LoggedSet[] = [];
    for (const i of p.items) {
      const cap = this.capacity(i);
      const sides = ex(i.exerciseId).unilateral ? (["left", "right"] as const) : ([undefined] as const);
      for (let k = 0; k < i.sets; k++) {
        for (const side of sides) {
          const fatigue = k * 0.4;
          const noise = (this.rng() - 0.5) * 2;
          let value: number;
          let effort: Effort;
          if (i.target.unit === "seconds") {
            const can = cap - fatigue * 2 + noise * 2;
            value = Math.max(1, Math.round(Math.min(can, i.target.high)));
            effort = value >= i.target.low ? "good" : this.rng() < 0.5 ? "hard" : "failed";
          } else {
            const can = cap - fatigue + noise;
            value = Math.max(0, Math.min(Math.round(can), i.target.high + 2));
            if (value >= i.target.high) effort = cap - i.target.high >= 2 ? "easy" : "good";
            else if (value >= i.target.low) effort = this.rng() < 0.25 ? "hard" : "good";
            else effort = this.rng() < 0.5 ? "hard" : "failed";
          }
          out.push({
            id: `${sessionId}-${i.order}-${k}-${side ?? "b"}`,
            sessionId,
            exerciseId: i.exerciseId,
            ...(side ? { side } : {}),
            ...(i.target.unit === "seconds" ? { seconds: value } : { reps: value }),
            ...(i.loadKg !== undefined ? { loadKg: i.loadKg } : {}),
            ...(i.band ? { band: i.band } : {}),
            effort,
            loggedAt: `${date}T19:00:00Z`,
          });
        }
      }
      this.train(i.family, i.target.unit);
    }
    return out;
  }
}

const kitOf = new Map<string, Persona["kit"]>();

type Violation = string;

export function simulate(persona: Persona, weeks = WEEKS) {
  for (const f of catalogue.families) kitOf.set(f.id, persona.kit);
  const rng = mulberry32(hash(persona.id));
  const athlete = new Athlete(rng);
  const violations: Violation[] = [];
  let input: EngineInput = {
    profile: persona.profile,
    kit: persona.kit,
    flags: persona.flags,
    catalogue,
    history: { ...emptyHistory(), tests: persona.baseline },
    today: BASELINE_DATE,
    engineVersion: ENGINE_VERSION,
  };
  input = { ...input, history: { ...input.history, progress: rebuildProgress(input) } };
  let programme = generatePlan(input, V_TAPER_LEAN_GAIN, 1);
  let templatesWeek = 1;
  const deloadWeeks = new Set<string>();
  let blocks = 1;
  let n = 0;

  const checkProgress = (before: ProgressState[], after: ProgressState[], maxRungs: number, what: string) => {
    for (const a of after) {
      const b = before.find((x) => x.family === a.family);
      if (!b) continue;
      if (Math.abs(a.rung - b.rung) > maxRungs)
        violations.push(`${what}: ${a.family} rung ${b.rung} → ${a.rung}`);
      if (
        a.exerciseId === b.exerciseId &&
        b.loadKg !== undefined &&
        a.loadKg !== undefined &&
        a.loadKg > b.loadKg
      ) {
        const ok =
          !isBigJump(b.loadKg, a.loadKg) || b.tempoStage === 3 || (b.seen ?? 0) < CALIBRATION_SESSIONS;
        if (!ok) violations.push(`${what}: ${a.family} load ${b.loadKg} → ${a.loadKg} skipped micro-steps`);
      }
      if (
        a.loadKg !== undefined &&
        a.exerciseId &&
        !loadOptions(ex(a.exerciseId), persona.kit).includes(a.loadKg)
      ) {
        violations.push(`${what}: ${a.family} load ${a.loadKg} not in loadOptions`);
      }
    }
  };

  const record = (session: SessionRecord, p: Prescription, sets: LoggedSet[]) => {
    const history = {
      ...input.history,
      sessions: [...input.history.sessions, session],
      prescriptions: [...input.history.prescriptions, p],
      sets: [...input.history.sets, ...sets],
    };
    const closed = closeSession({ ...input, history }, session.id);
    checkProgress(input.history.progress, closed.progress, 1, `${session.date} ${session.kind}`);
    input = { ...input, history: { ...history, progress: closed.progress } };
  };

  const checkPrescription = (p: Prescription, date: string) => {
    const limit =
      (p.kind === "recovery" ? 15 : p.kind === "micro" ? 10 : persona.profile.minutesPerSession) * 60;
    if (p.kind !== "micro" && estimateSeconds(p.items, catalogue) > limit)
      violations.push(`${date}: ${p.kind} over time`);
    for (const i of p.items) {
      if (!checkAllowed(ex(i.exerciseId), persona.kit, persona.flags, date).ok) {
        violations.push(`${date}: ${i.exerciseId} not allowed (I6)`);
      }
    }
  };

  for (let d = 0; d < weeks * 7; d++) {
    const today = addDays(BASELINE_DATE, d);
    input = { ...input, today, programme };

    // Block lifecycle.
    const bw = blockWeek(programme, today);
    if (bw >= 6) {
      programme = generatePlan(input, V_TAPER_LEAN_GAIN, 1);
      templatesWeek = 1;
      blocks++;
    } else if (bw <= 4 && bw !== templatesWeek) {
      const fresh = generatePlan({ ...input, today: programme.blockStart }, V_TAPER_LEAN_GAIN, bw);
      programme = {
        ...fresh,
        ...(programme.earlyDeloadFrom ? { earlyDeloadFrom: programme.earlyDeloadFrom } : {}),
      };
      templatesWeek = bw;
    }
    input = { ...input, programme };
    const status = deloadStatus(input);
    if (status.startEarly) {
      programme = { ...programme, earlyDeloadFrom: today };
      input = { ...input, programme };
    }

    // Monthly capability test on day 28, 56, …
    if (d > 0 && d % 28 === 0) {
      const results: TestResult[] = [];
      const vp = input.history.progress.find((p) => p.family === "vertical-pull");
      const best = (id: string, field: "reps" | "seconds") =>
        Math.max(0, ...input.history.sets.filter((x) => x.exerciseId === id).map((x) => x[field] ?? 0));
      if (vp?.exerciseId === "dead-hang")
        results.push({ date: today, item: "hang", value: best("dead-hang", "seconds") });
      if (vp?.exerciseId === "pullup-strict")
        results.push({ date: today, item: "pullups", value: best("pullup-strict", "reps") });
      const pu = input.history.progress.find((p) => p.family === "push-up");
      if (pu?.exerciseId === "pushup-floor")
        results.push({ date: today, item: "pushups", value: best("pushup-floor", "reps") });
      if (results.length > 0) {
        const before = input.history.progress;
        const withTests = {
          ...input,
          history: { ...input.history, tests: [...input.history.tests, ...results] },
        };
        const progress = applyPlacements(withTests, before, placeFromTest(withTests, results));
        checkProgress(before, progress, 2, `${today} test`);
        input = { ...withTests, history: { ...withTests.history, progress } };
      }
    }

    const weekday = d % 7; // the baseline date is a Monday
    const week = Math.floor(d / 7) + 1;
    if (persona.climbDay === weekday && week >= 9) {
      const s: SessionRecord = { id: `x${++n}`, kind: "climb", status: "done", date: today };
      input = { ...input, history: { ...input.history, sessions: [...input.history.sessions, s] } };
      continue;
    }

    if (persona.trainingDays.includes(weekday)) {
      const id = `m${++n}`;
      const { template } = nextSession(input);
      if (rng() < persona.skipChance) {
        const s: SessionRecord = {
          id,
          kind: "main",
          dayType: template.dayType,
          status: "skipped",
          date: today,
        };
        input = { ...input, history: { ...input.history, sessions: [...input.history.sessions, s] } };
        continue;
      }
      const r = rng();
      const checkin: Checkin = {
        sessionId: id,
        date: today,
        energy: 2 + Math.floor(rng() * 4),
        soreness: 1 + Math.floor(rng() * 3),
        sleep: r < 0.6 ? "good" : r < 0.92 ? "ok" : "bad",
      };
      const mode = readinessMode(readinessScore(checkin));
      input = { ...input, history: { ...input.history, checkins: [...input.history.checkins, checkin] } };
      const p = prescribe(input, template, { readiness: mode, sessionId: id });
      checkPrescription(p, today);
      if (p.deload) deloadWeeks.add(isoWeek(today));
      const session: SessionRecord = {
        id,
        kind: p.kind,
        dayType: template.dayType,
        status: "done",
        date: today,
        readinessMode: mode,
        deload: p.deload,
      };
      record(session, p, athlete.logSets(p, id, today));
      continue;
    }

    const micro = microSession(input);
    if (micro && rng() < persona.microChance) {
      const id = `u${++n}`;
      const p = { ...micro, sessionId: id };
      checkPrescription(p, today);
      record(
        { id, kind: "micro", status: "done", date: today, readinessMode: "full" },
        p,
        athlete.logSets(p, id, today),
      );
    }
  }

  const rebuilt = rebuildProgress({ ...input, history: { ...input.history, progress: [] } });
  return { input, violations, deloadWeeks, blocks, rebuilt };
}
