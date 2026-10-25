// SPDX-License-Identifier: AGPL-3.0-or-later
// Coach chat and its tools (SDD "Coach chat tools", "MCP server"). The tools
// read one user's data snapshot and return compact summaries, never raw rows,
// photos or notes. propose_change is the only write: the engine checks the
// change, and the user accepts or rejects it in the app (I4). The MCP server
// serves the same tools.
import {
  addDays,
  type EngineInput,
  type PlanChange,
  type Reason,
  readinessMode,
  readinessScore,
  ruleTemplate,
  STALL_SESSIONS,
  validateProposal,
} from "@vee/engine";
import { MIN_WEIGH_INS, type Moment, type Portions, weeklySlope } from "@vee/nutrition";
import { z } from "zod";
import { foodWeek } from "./food";
import type { ChatMessage, Gateway, Route, ToolCall, Usage } from "./gateway";
import { inventedNumbers } from "./numbers";
import { prompt } from "./prompts";
import { PlanChangeSchema } from "./schemas";
import { acceptedChanges } from "./tasks";

/** What a token or a chat may read. The same names as the coach scopes; no photos. */
export const SCOPES = ["training", "food", "body"] as const;
export type Scope = (typeof SCOPES)[number];

export type CoachData = {
  input: EngineInput;
  food: { logs: { date: string; portions: Portions }[]; perMoment?: Record<Moment, Portions> };
  weighIns: { date: string; kg: number }[];
  reviews: { week: string; words?: string; focus?: string }[];
};

export type Proposed = { change: PlanChange; why: string; reasons: Reason[] };

export type ToolContext = {
  /** Stores an accepted-by-the-engine proposal for the user to approve. Returns its id. */
  propose: (p: Proposed) => Promise<string>;
};

type Tool = {
  name: string;
  description: string;
  scope: Scope;
  args: z.ZodObject;
  run: (data: CoachData, args: never, ctx: ToolContext) => unknown;
};

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Range = z.object({
  from: Day.optional().describe("First day, YYYY-MM-DD. Default: 28 days before today."),
  to: Day.optional().describe("Last day, YYYY-MM-DD. Default: today."),
});
const MAX_DAYS = 120;

function range(data: CoachData, a: z.infer<typeof Range>) {
  const to = a.to ?? data.input.today;
  const from = a.from ?? addDays(to, -27);
  const earliest = addDays(to, -MAX_DAYS);
  return { from: from < earliest ? earliest : from, to };
}

const exercise = (data: CoachData, id?: string) =>
  data.input.catalogue.exercises.find((e) => e.id === id)?.names.en ?? id ?? "";

function findExercise(data: CoachData, key: string) {
  const k = key.toLowerCase();
  return data.input.catalogue.exercises.find((e) => e.id === key || e.names.en.toLowerCase() === k);
}

const tool = <A extends z.ZodObject>(t: {
  name: string;
  description: string;
  scope: Scope;
  args: A;
  run: (data: CoachData, args: z.infer<A>, ctx: ToolContext) => unknown;
}): Tool => t as unknown as Tool;

export const TOOLS: Tool[] = [
  tool({
    name: "get_sessions",
    description:
      "Sessions in a date range: the counts by status and kind, and each session's date, kind, day, status, readiness, sets logged and exercises.",
    scope: "training",
    args: Range,
    run: (data, a) => {
      const { from, to } = range(data, a);
      const h = data.input.history;
      const inRange = h.sessions
        .filter((s) => s.date >= from && s.date <= to)
        .sort((x, y) => x.date.localeCompare(y.date));
      // Counts come from here, so the model does not count a list itself.
      const count = (f: (s: (typeof inRange)[number]) => boolean) => inRange.filter(f).length;
      const sessions = inRange.map((s) => {
        const sets = h.sets.filter((x) => x.sessionId === s.id && !x.deletedAt);
        return {
          date: s.date,
          kind: s.kind,
          ...(s.dayType ? { day: s.dayType } : {}),
          status: s.status,
          ...(s.readinessMode ? { readiness: s.readinessMode } : {}),
          ...(s.deload ? { deload: true } : {}),
          sets: sets.length,
          exercises: [...new Set(sets.map((x) => exercise(data, x.exerciseId)))],
        };
      });
      return {
        from,
        to,
        done: count((s) => s.status === "done"),
        skipped: count((s) => s.status === "skipped"),
        mainDone: count((s) => s.status === "done" && (s.kind === "main" || s.kind === "recovery")),
        microDone: count((s) => s.status === "done" && s.kind === "micro"),
        deloadDone: count((s) => s.status === "done" && s.deload === true),
        readiness: {
          full: count((s) => s.status === "done" && s.readinessMode === "full"),
          trimmed: count((s) => s.status === "done" && s.readinessMode === "trimmed"),
          recovery: count((s) => s.status === "done" && s.readinessMode === "recovery"),
        },
        setsLogged: sessions.reduce((n, s) => n + s.sets, 0),
        sessions,
      };
    },
  }),
  tool({
    name: "get_exercise_history",
    description:
      "The logged sets of one exercise in its last 10 sessions, and the current state of its ladder. Takes an exercise id or name.",
    scope: "training",
    args: z.object({ exercise_id: z.string().describe("Exercise id or English name") }),
    run: (data, a) => {
      const e = findExercise(data, a.exercise_id);
      if (!e) return { error: `No exercise "${a.exercise_id}". Use an id or a name from get_plan.` };
      const h = data.input.history;
      const dates = new Map(h.sessions.map((s) => [s.id, s.date]));
      const sets = h.sets.filter((x) => x.exerciseId === e.id && !x.deletedAt);
      const bySession = new Map<string, typeof sets>();
      for (const x of sets) bySession.set(x.sessionId, [...(bySession.get(x.sessionId) ?? []), x]);
      const sessions = [...bySession.entries()]
        .map(([id, xs]) => ({
          date: dates.get(id) ?? "",
          sets: xs.map((x) => ({
            ...(x.reps !== undefined ? { reps: x.reps } : {}),
            ...(x.seconds !== undefined ? { seconds: x.seconds } : {}),
            ...(x.loadKg !== undefined ? { kg: x.loadKg } : {}),
            ...(x.side ? { side: x.side } : {}),
            effort: x.effort,
          })),
        }))
        .sort((x, y) => x.date.localeCompare(y.date))
        .slice(-10);
      const state = h.progress.find((s) => s.family === e.family);
      return {
        exercise: e.names.en,
        family: e.family,
        rung: e.rung,
        sessions,
        ...(state
          ? {
              ladder: {
                current: exercise(data, state.exerciseId),
                rung: state.rung,
                ...(state.loadKg !== undefined ? { kg: state.loadKg } : {}),
                ...(state.holdS !== undefined ? { holdS: state.holdS } : {}),
                sessionsWithoutProgress: state.streaks?.stall ?? 0,
              },
            }
          : {}),
      };
    },
  }),
  tool({
    name: "get_progress_state",
    description:
      "Each ladder now: the current exercise, rung, load or hold, best set, and sessions without progress. A movement is stalled at stalledAtSessions.",
    scope: "training",
    args: z.object({}),
    run: (data) => ({
      stalledAtSessions: STALL_SESSIONS,
      ladders: data.input.history.progress.map((s) => ({
        family: s.family,
        exercise: exercise(data, s.exerciseId),
        rung: s.rung,
        ...(s.loadKg !== undefined ? { kg: s.loadKg } : {}),
        ...(s.holdS !== undefined ? { holdS: s.holdS } : {}),
        ...(s.best !== undefined ? { best: s.best } : {}),
        sessionsWithoutProgress: s.streaks?.stall ?? 0,
      })),
    }),
  }),
  tool({
    name: "get_checkins",
    description: "Check-ins in a date range: energy, soreness and sleep, and the readiness they gave.",
    scope: "training",
    args: Range,
    run: (data, a) => {
      const { from, to } = range(data, a);
      return data.input.history.checkins
        .filter((c) => c.date >= from && c.date <= to)
        .sort((x, y) => x.date.localeCompare(y.date))
        .map((c) => ({
          date: c.date,
          energy: c.energy,
          soreness: c.soreness,
          sleep: c.sleep,
          readiness: readinessMode(readinessScore(c)),
        }));
    },
  }),
  tool({
    name: "get_tests",
    description: "The monthly capability test results.",
    scope: "training",
    args: z.object({}),
    run: (data) =>
      [...data.input.history.tests]
        .sort((x, y) => x.date.localeCompare(y.date))
        .map((t) => ({
          date: t.date,
          item: t.item,
          value: t.value,
          ...(t.loadKg !== undefined ? { kg: t.loadKg } : {}),
        })),
  }),
  tool({
    name: "get_food_summary",
    description:
      "Food logging in a date range: days logged, and the logged portions as a percent of the daily target.",
    scope: "food",
    args: Range,
    run: (data, a) => {
      const { from, to } = range(data, a);
      const days: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      return { from, to, ...foodWeek(data.food.logs, data.food.perMoment, days) };
    },
  }),
  tool({
    name: "get_weight_trend",
    description: "Weigh-ins in the last 28 days, the first and last weight, and the weekly slope.",
    scope: "body",
    args: z.object({}),
    run: (data) => {
      const since = addDays(data.input.today, -27);
      const w = data.weighIns.filter((x) => x.date >= since).sort((x, y) => x.date.localeCompare(y.date));
      return {
        goal: data.input.profile.goalTemplate,
        weighIns: w.length,
        ...(w.length
          ? {
              first: { date: w[0]?.date, kg: w[0]?.kg },
              last: { date: w.at(-1)?.date, kg: w.at(-1)?.kg },
            }
          : {}),
        slopeKgPerWeek: w.length >= MIN_WEIGH_INS ? Math.round(weeklySlope(w) * 100) / 100 : null,
        minWeighInsForSlope: MIN_WEIGH_INS,
      };
    },
  }),
  tool({
    name: "explain_rule",
    description: "The text of a training rule, from its rule id (for example P5_STALL).",
    scope: "training",
    args: z.object({ rule_id: z.string() }),
    run: (_data, a) => {
      const t = ruleTemplate(a.rule_id);
      return t ? { ruleId: a.rule_id, text: t } : { error: `No rule "${a.rule_id}".` };
    },
  }),
  tool({
    name: "get_plan",
    description:
      "The current plan: each day with its exercises, sets and targets, and the changes the engine accepts now.",
    scope: "training",
    args: z.object({}),
    run: (data) => {
      const p = data.input.programme;
      if (!p) return { error: "No plan yet." };
      return {
        goal: data.input.profile.goalTemplate,
        blockStart: p.blockStart,
        days: p.templates.map((t) => ({
          day: t.dayType,
          name: t.name,
          minutes: t.estimatedMinutes,
          items: t.items.map((i) => ({
            exerciseId: i.exerciseId,
            exercise: exercise(data, i.exerciseId),
            family: i.family,
            role: i.role,
            sets: i.sets,
            target: i.target,
            ...(i.loadKg !== undefined ? { kg: i.loadKg } : {}),
          })),
        })),
        accepted: acceptedChanges(data.input),
      };
    },
  }),
  tool({
    name: "list_reviews",
    description: "The last 6 weekly reviews: week, words and focus.",
    scope: "training",
    args: z.object({}),
    run: (data) => [...data.reviews].sort((x, y) => x.week.localeCompare(y.week)).slice(-6),
  }),
  tool({
    name: "propose_change",
    description:
      "Propose one plan change: a swap, one more or fewer sets, or an early deload. The engine checks it. If it passes, the user sees a card to accept or reject. Nothing changes until they accept.",
    scope: "training",
    args: z.object({
      change: PlanChangeSchema,
      why: z.string().min(1).describe('One sentence to the person, as "you": the reason for the change'),
    }),
    run: async (data, a, ctx) => {
      const change = a.change as PlanChange;
      const v = validateProposal(data.input, change);
      if (!v.ok) return { accepted: false, refused: v.reason.text };
      const id = await ctx.propose({ change, why: a.why, reasons: v.reasons });
      return { accepted: true, id, card: v.reasons.map((r) => r.text) };
    },
  }),
];

export const toolsFor = (scopes: readonly Scope[]) => TOOLS.filter((t) => scopes.includes(t.scope));

/** Runs one tool call. Bad arguments give an error result, not a throw. */
export async function runTool(
  data: CoachData,
  t: Tool,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const a = t.args.safeParse(rawArgs ?? {});
  if (!a.success) return { error: a.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return t.run(data, a.data as never, ctx);
}

// ── coach_chat ─────────────────────────────────────────────────────────────

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatResult = {
  text: string;
  /** Numbers in the answer that are in no message and no tool result. */
  unconfirmed: string[];
  proposals: (Proposed & { id: string })[];
  /** Tool names in call order. */
  toolsUsed: string[];
  usage: Usage[];
  error?: string;
};

/** Tool rounds before the answer must be text. */
export const CHAT_ROUNDS = 5;
export const CHAT_TIMEOUT_MS = 60_000;

export async function coachChat(
  gw: Gateway,
  route: Route,
  o: {
    data: CoachData;
    scopes: readonly Scope[];
    turns: ChatTurn[];
    ctx: ToolContext;
    onText: (delta: string) => void;
    onProposal?: (p: Proposed & { id: string }) => void;
  },
): Promise<ChatResult> {
  const tools = toolsFor(o.scopes);
  const messages: ChatMessage[] = [
    { role: "system", content: `${prompt("coach_chat")}\n\nToday is ${o.data.input.today}.` },
    ...o.turns,
  ];
  const results: unknown[] = [];
  const toolsUsed: string[] = [];
  const proposals: (Proposed & { id: string })[] = [];
  const usage: Usage[] = [];
  const ctx: ToolContext = {
    propose: async (p) => {
      const id = await o.ctx.propose(p);
      proposals.push({ ...p, id });
      o.onProposal?.({ ...p, id });
      return id;
    },
  };
  const deadline = Date.now() + CHAT_TIMEOUT_MS;
  let text = "";
  let retried = false;
  for (let round = 0; round <= CHAT_ROUNDS; round++) {
    let streamed = false;
    // Text before a tool call is a paragraph of its own: the next round starts after a break.
    const gap = text && !/\s$/.test(text) ? "\n\n" : "";
    let r: Awaited<ReturnType<Gateway["chatRound"]>>;
    try {
      r = await gw.chatRound({
        route,
        messages,
        // The last round has no tools, so the model must answer.
        tools:
          round < CHAT_ROUNDS
            ? tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: z.toJSONSchema(t.args),
              }))
            : [],
        timeoutMs: Math.max(1_000, deadline - Date.now()),
        onText: (d) => {
          if (!streamed && gap) o.onText(gap);
          streamed = true;
          o.onText(d);
        },
      });
    } catch (e) {
      // One retry for a provider error, only if nothing reached the user yet.
      if (!streamed && !retried && Date.now() < deadline) {
        retried = true;
        round--;
        continue;
      }
      return {
        text,
        unconfirmed: [],
        proposals,
        toolsUsed,
        usage,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    usage.push(r.usage);
    text += r.text && gap ? gap + r.text : r.text;
    if (r.toolCalls.length === 0) break;
    messages.push({ role: "assistant", content: r.text, tool_calls: r.toolCalls });
    for (const call of r.toolCalls) {
      toolsUsed.push(call.function.name);
      const out = await callTool(o.data, tools, call, ctx);
      results.push(out);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
    }
  }
  const unconfirmed = inventedNumbers(text, { turns: o.turns, results, today: o.data.input.today });
  return { text, unconfirmed, proposals, toolsUsed, usage };
}

async function callTool(data: CoachData, tools: Tool[], call: ToolCall, ctx: ToolContext) {
  const t = tools.find((x) => x.name === call.function.name);
  if (!t) return { error: `No tool "${call.function.name}".` };
  let args: unknown;
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { error: "The arguments are not valid JSON." };
  }
  return runTool(data, t, args, ctx);
}
