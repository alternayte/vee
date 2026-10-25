// SPDX-License-Identifier: AGPL-3.0-or-later
// Coach chat with a scripted, streamed model: no network.
import { loadCatalogue } from "@vee/catalogue/load";
import {
  ENGINE_VERSION,
  type EngineInput,
  emptyHistory,
  generatePlan,
  type KitItem,
  V_TAPER_LEAN_GAIN,
} from "@vee/engine";
import { describe, expect, test } from "vitest";
import { type CoachData, coachChat, createGateway, type Proposed, toolsFor } from "../src";

const loaded = loadCatalogue();
if (!loaded.ok) throw new Error("catalogue");
const kit: KitItem[] = [
  { id: "db", kind: "dial_db", count: 1, params: { min: 2, max: 24, step: 2 } },
  { id: "band", kind: "band", count: 1, params: { colour: "red", estKg: 15 } },
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
  history: {
    ...emptyHistory(),
    progress: [
      {
        family: "row",
        rung: 1,
        exerciseId: "row-single-arm-db",
        loadKg: 12,
        streaks: { top: 0, miss: 0, stall: 3, hold: 0 },
      },
    ],
  },
  today: "2026-11-08",
  engineVersion: ENGINE_VERSION,
};
const data: CoachData = {
  input: { ...base, programme: generatePlan(base, V_TAPER_LEAN_GAIN) },
  food: { logs: [] },
  weighIns: [],
  reviews: [],
};
const route = { model: "test/model", effort: "low" as const };

type Round = { text?: string; calls?: { name: string; args: unknown }[] } | "fail";

/** A fake streamed OpenRouter. Each round's events arrive in 7-byte pieces, so lines split across chunks. */
function streamed(...rounds: Round[]) {
  const requests: {
    messages: { role: string; content: string }[];
    tools?: { function: { name: string } }[];
  }[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    const r = rounds.shift();
    if (!r || r === "fail") return new Response("busy", { status: 503 });
    const events: unknown[] = [];
    for (const word of (r.text ?? "").split(/(?<= )/))
      events.push({ choices: [{ delta: { content: word } }] });
    (r.calls ?? []).forEach((c, index) => {
      const args = JSON.stringify(c.args);
      events.push({
        choices: [
          {
            delta: {
              tool_calls: [
                { index, id: `call-${index}`, function: { name: c.name, arguments: args.slice(0, 5) } },
              ],
            },
          },
        ],
      });
      events.push({
        choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(5) } }] } }],
      });
    });
    events.push({ model: "test/model", choices: [], usage: { total_tokens: 50, cost: 0.0001 } });
    const text = `: OPENROUTER PROCESSING\n\n${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    return new Response(body);
  }) as typeof fetch;
  return { gw: createGateway({ apiKey: "k", fetch: f }), requests };
}

const noStore = { propose: async () => "unused" };

describe("coach_chat", () => {
  test("a tool call runs, its result goes back, and the answer streams", async () => {
    const { gw, requests } = streamed(
      { calls: [{ name: "get_progress_state", args: {} }] },
      { text: "Your row is at 12 kg. It has not moved in 3 sessions." },
    );
    const deltas: string[] = [];
    const r = await coachChat(gw, route, {
      data,
      scopes: ["training"],
      turns: [{ role: "user", content: "Why am I stuck on rows?" }],
      ctx: noStore,
      onText: (d) => deltas.push(d),
    });
    expect(r.error).toBeUndefined();
    expect(deltas.join("")).toBe("Your row is at 12 kg. It has not moved in 3 sessions.");
    const tool = requests[1]?.messages.find((m) => m.role === "tool");
    expect(JSON.parse(tool?.content ?? "[]")[0]).toMatchObject({
      family: "row",
      kg: 12,
      sessionsWithoutProgress: 3,
    });
    expect(r.unconfirmed).toEqual([]);
    expect(r.usage).toHaveLength(2);
  });

  test("a number in no tool result and no message is reported", async () => {
    const { gw } = streamed({ text: "You did 47 sets last week." });
    const r = await coachChat(gw, route, {
      data,
      scopes: ["training"],
      turns: [{ role: "user", content: "How many sets?" }],
      ctx: noStore,
      onText: () => {},
    });
    expect(r.unconfirmed).toEqual(["47"]);
  });

  test("only the tools of the granted scopes go to the model", async () => {
    expect(toolsFor(["food"]).map((t) => t.name)).toEqual(["get_food_summary"]);
    const { gw, requests } = streamed({ text: "I can only see your food logs." });
    await coachChat(gw, route, {
      data,
      scopes: ["food"],
      turns: [{ role: "user", content: "Show my sessions" }],
      ctx: noStore,
      onText: () => {},
    });
    expect(requests[0]?.tools?.map((t) => t.function.name)).toEqual(["get_food_summary"]);
  });

  test("propose_change stores a change the engine accepts and returns a refusal for one it does not", async () => {
    const stored: Proposed[] = [];
    const { gw, requests } = streamed(
      {
        calls: [
          {
            name: "propose_change",
            args: {
              change: { kind: "swap", dayType: "A", family: "row", to: "row-band" },
              why: "The row stalled.",
            },
          },
          { name: "propose_change", args: { change: { kind: "deload" }, why: "Rest." } },
        ],
      },
      { text: "A card for the band row is in the Coach tab." },
    );
    const r = await coachChat(gw, route, {
      data,
      scopes: ["training"],
      turns: [{ role: "user", content: "Change my row" }],
      ctx: {
        propose: async (p) => {
          stored.push(p);
          return "p1";
        },
      },
      onText: () => {},
    });
    expect(stored.map((p) => p.change)).toEqual([
      { kind: "swap", dayType: "A", family: "row", to: "row-band" },
    ]);
    expect(r.proposals[0]?.id).toBe("p1");
    const tools = requests[1]?.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));
    expect(tools?.[0]).toMatchObject({ accepted: true, id: "p1" });
    expect(tools?.[1]).toMatchObject({ accepted: false });
    expect(tools?.[1].refused).toMatch(/deload needs/);
  });

  test("a provider error before any text gets one retry", async () => {
    const { gw, requests } = streamed("fail", { text: "Ask me about your training." });
    const r = await coachChat(gw, route, {
      data,
      scopes: ["training"],
      turns: [{ role: "user", content: "hi" }],
      ctx: noStore,
      onText: () => {},
    });
    expect(requests).toHaveLength(2);
    expect(r.text).toBe("Ask me about your training.");
  });
});
