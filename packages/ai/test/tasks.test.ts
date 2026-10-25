// SPDX-License-Identifier: AGPL-3.0-or-later
// The tasks with a scripted model: no network. V12 runs the real model.
import { loadCatalogue } from "@vee/catalogue/load";
import {
  ENGINE_VERSION,
  type EngineInput,
  emptyHistory,
  generatePlan,
  type KitItem,
  V_TAPER_LEAN_GAIN,
} from "@vee/engine";
import { SEED_INGREDIENTS } from "@vee/nutrition/seed";
import { describe, expect, test } from "vitest";
import {
  adjustToday,
  createGateway,
  explainMore,
  foodWeek,
  mealDraft,
  reviewNumbers,
  weeklyReview,
} from "../src";

const loaded = loadCatalogue();
if (!loaded.ok) throw new Error("catalogue");
const kit: KitItem[] = [
  { id: "db", kind: "dial_db", count: 1, params: { min: 2, max: 24, step: 2 } },
  { id: "band", kind: "band", count: 1, params: { colour: "red", estKg: 15 } },
  { id: "station", kind: "pullup_station", count: 1, params: { grips: ["straight"], dipHandles: true } },
];
const base: EngineInput = {
  profile: {
    heightCm: 180,
    birthYear: 1989,
    sex: "male",
    minutesPerSession: 35,
    goalTemplate: "v-taper-lean-gain",
  },
  kit,
  flags: [],
  catalogue: loaded.catalogue,
  history: emptyHistory(),
  today: "2026-11-08",
  engineVersion: ENGINE_VERSION,
};
const input = { ...base, programme: generatePlan(base, V_TAPER_LEAN_GAIN) };
const route = { model: "test/model", effort: "low" as const };

/** A fake OpenRouter: answers with the scripted contents in order and records the requests. */
function scripted(...answers: unknown[]) {
  const requests: { messages: { role: string; content: string }[]; reasoning: unknown; provider: unknown }[] =
    [];
  const f = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    const next = answers.shift();
    const content = typeof next === "string" ? next : JSON.stringify(next);
    return new Response(
      JSON.stringify({
        model: "test/model",
        choices: [{ message: { content } }],
        usage: { total_tokens: 100, cost: 0.0001 },
      }),
    );
  }) as typeof fetch;
  return { gw: createGateway({ apiKey: "k", fetch: f }), requests };
}

const numbers = reviewNumbers(input, "2026-11-02", "2026-11-08", foodWeek([], undefined, ["2026-11-02"]), {
  weighIns: 0,
  slopeKgPerWeek: null,
});

describe("gateway", () => {
  test("sends the route's effort and the zero-retention provider setting", async () => {
    const { gw, requests } = scripted({ text: "Plain words." });
    await explainMore(gw, route, []);
    expect(requests[0]?.reasoning).toEqual({ effort: "low", exclude: true });
    expect(requests[0]?.provider).toMatchObject({ zdr: true, data_collection: "deny" });
  });

  test("a schema error gets one retry with the errors", async () => {
    const { gw, requests } = scripted("not json", { text: "Plain words." });
    const r = await explainMore(gw, route, []);
    expect(r.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)?.content).toMatch(/not valid JSON/);
    expect(r.usage).toHaveLength(2);
  });

  test("a provider error gets the same one retry", async () => {
    let n = 0;
    const f = (async () => {
      n++;
      if (n === 1) return new Response("busy", { status: 503 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"text":"Plain."}' } }], usage: {} }),
      );
    }) as unknown as typeof fetch;
    const r = await explainMore(createGateway({ apiKey: "k", fetch: f }), route, []);
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
  });

  test("two failures give the error, not an answer", async () => {
    const { gw } = scripted("no", "still no");
    const r = await explainMore(gw, route, []);
    expect(r.ok).toBe(false);
  });
});

describe("weekly_review", () => {
  const words =
    "You set up your plan this week. No sessions are logged yet, so no movement moved up or down. Start with session A when you can, and log each set as you go.";

  test("an invented number gets a retry; a second one falls back to numbers only", async () => {
    const bad = { words: "You did 99 sets.", focus: "Sleep.", proposals: [] };
    const { gw, requests } = scripted(bad, bad);
    const r = await weeklyReview(gw, route, input, numbers);
    expect(requests[1]?.messages.at(-1)?.content).toMatch(/99/);
    expect(r.words).toBeUndefined();
    expect(r.numbers).toBe(numbers);
  });

  test("a proposal that fails the engine check is dropped; a valid one stays", async () => {
    const { gw } = scripted({
      words,
      focus: "Keep the rows strict next week.",
      proposals: [
        {
          change: { kind: "swap", dayType: "A", family: "vertical-pull", to: "pullup-strict" },
          why: "Harder.",
        },
        { change: { kind: "swap", dayType: "A", family: "row", to: "row-band" }, why: "Less dial work." },
      ],
    });
    const r = await weeklyReview(gw, route, input, numbers);
    expect(r.proposals.map((p) => p.change)).toEqual([
      { kind: "swap", dayType: "A", family: "row", to: "row-band" },
    ]);
    expect(r.proposals[0]?.reasons[0]?.ruleId).toBe("PROPOSAL_SWAP");
  });

  test("swap options list only allowed exercises on owned rungs", () => {
    const a = numbers.swapOptions.find((o) => o.dayType === "A" && o.family === "row");
    expect(a?.options).toEqual(["row-band"]);
    const vp = numbers.swapOptions.find((o) => o.family === "vertical-pull");
    expect(vp?.options).toEqual([]);
  });
});

describe("adjust_today", () => {
  const day = input.programme.templates[0];
  if (!day) throw new Error("no day");

  test("a focus outside today's families gets a retry", async () => {
    const { gw } = scripted({ focus: ["squat"] }, { focus: ["row"] });
    const r = await adjustToday(gw, route, "rows first please", day);
    expect(r.ok && r.output.focus).toEqual(["row"]);
  });
});

describe("meal_draft", () => {
  const self = { id: "me", name: "Nathan", isSelf: true };
  const ctx = {
    ingredients: SEED_INGREDIENTS,
    exclusions: [{ memberId: "me", kind: "lactose" as const }],
    household: [self],
    maxMinutes: 20,
    recent: [],
  };
  const high = SEED_INGREDIENTS.find((i) => i.lactoseClass === "high");
  const chicken = SEED_INGREDIENTS.find((i) => i.id.includes("chicken"));
  const rice = SEED_INGREDIENTS.find((i) => i.id.includes("rice"));

  test("lactose ingredients are not offered to the model", async () => {
    const { gw, requests } = scripted("x", "x");
    await mealDraft(gw, route, ctx, () => "m1");
    const sent = JSON.parse(requests[0]?.messages[1]?.content ?? "{}") as { ingredients: { id: string }[] };
    expect(sent.ingredients.some((i) => i.id === high?.id)).toBe(false);
  });

  test("a meal that breaks a rule gets a retry; a passing meal is a Meal", async () => {
    if (!high || !chicken || !rice) throw new Error("seed ingredients");
    const meal = (first: string) => ({
      name: "Chicken rice",
      minutes: 20,
      servings: 2,
      noCook: false,
      steps: ["Cook the rice.", "Fry the chicken."],
      ingredients: [
        { ingredientId: first, qty: 300, unit: "g", role: "pot" },
        { ingredientId: rice.id, qty: 150, unit: "g", role: "pot" },
      ],
    });
    const { gw } = scripted(meal(high.id), meal(chicken.id));
    const r = await mealDraft(gw, route, ctx, () => "m1");
    if (!r.ok) throw new Error(r.error);
    expect(r.output).toMatchObject({ id: "m1", origin: "ai", name: "Chicken rice" });
  });
});

test("weekly_review: a malformed proposal is dropped, the review stays", async () => {
  const { gw, requests } = scripted({
    words:
      "You set up your plan this week. No sessions are logged yet, so no movement moved up or down. Start with session A when you can, and log each set as you go.",
    focus: "Start with session A.",
    proposals: [{ change: { kind: "sets", dayType: "Z" }, why: "More." }],
  });
  const r = await weeklyReview(gw, route, input, numbers);
  expect(requests).toHaveLength(1);
  expect(r.error).toBeUndefined();
  expect(r.words).toMatch(/^You set up your plan/);
  expect(r.proposals).toEqual([]);
});

test("weekly_review: placeholder or too-short words get a retry", async () => {
  const { gw, requests } = scripted(
    { words: "PLACEHOLDER", focus: "Train.", proposals: [] },
    { words: "PLACEHOLDER", focus: "Train.", proposals: [] },
  );
  const r = await weeklyReview(gw, route, input, numbers);
  expect(requests).toHaveLength(2);
  expect(r.words).toBeUndefined();
});
