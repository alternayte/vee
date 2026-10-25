// SPDX-License-Identifier: AGPL-3.0-or-later
// The model gateway (SDD "AI layer"): one OpenRouter call per attempt, JSON
// output checked with Zod and the task's validator, one retry with the
// errors, then the engine-only fallback. The phone never holds the key.
import { z } from "zod";

export type Effort = "low" | "medium" | "high";
export type Route = { model: string; effort: Effort };

export type GatewayOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export type Usage = { model: string; costUsd: number; tokens: number; ms: number };

export type TaskResult<T> =
  | { ok: true; output: T; usage: Usage[] }
  | { ok: false; error: string; usage: Usage[] };

export type TaskSpec<T> = {
  name: string;
  system: string;
  /** The minimised input, sent as JSON. */
  input: unknown;
  schema: z.ZodType<T>;
  /** Problems with a schema-valid answer. Empty means it passes. */
  validate: (out: T) => string[];
  route: Route;
  timeoutMs: number;
};

type Message = { role: "system" | "user" | "assistant"; content: string };

type Completion = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { total_tokens?: number; cost?: number };
};

function parse<T>(schema: z.ZodType<T>, raw: string): { out?: T; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { errors: ["The answer is not valid JSON."] };
  }
  const r = schema.safeParse(json);
  if (!r.success)
    return { errors: r.error.issues.map((i) => `${i.path.join(".") || "answer"}: ${i.message}`) };
  return { out: r.data, errors: [] };
}

export function createGateway(o: GatewayOptions) {
  const f = o.fetch ?? fetch;
  const url = `${o.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`;

  async function complete(
    spec: TaskSpec<unknown>,
    messages: Message[],
  ): Promise<{ text: string; usage: Usage }> {
    const started = Date.now();
    const r = await f(url, {
      method: "POST",
      headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(spec.timeoutMs),
      body: JSON.stringify({
        model: spec.route.model,
        messages,
        reasoning: { effort: spec.route.effort, exclude: true },
        response_format: {
          type: "json_schema",
          json_schema: { name: spec.name, strict: false, schema: z.toJSONSchema(spec.schema) },
        },
        // Only providers that keep no prompts and do not train on them.
        provider: { zdr: true, data_collection: "deny", require_parameters: true },
        usage: { include: true },
      }),
    });
    if (!r.ok) throw new Error(`model call failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const body = (await r.json()) as Completion;
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      usage: {
        model: body.model ?? spec.route.model,
        costUsd: body.usage?.cost ?? 0,
        tokens: body.usage?.total_tokens ?? 0,
        ms: Date.now() - started,
      },
    };
  }

  return {
    async run<T>(spec: TaskSpec<T>): Promise<TaskResult<T>> {
      const usage: Usage[] = [];
      const messages: Message[] = [
        { role: "system", content: spec.system },
        { role: "user", content: JSON.stringify(spec.input) },
      ];
      let errors: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        let text: string;
        try {
          const c = await complete(spec as TaskSpec<unknown>, messages);
          usage.push(c.usage);
          text = c.text;
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e), usage };
        }
        const parsed = parse(spec.schema, text);
        errors = parsed.out === undefined ? parsed.errors : spec.validate(parsed.out);
        if (parsed.out !== undefined && errors.length === 0) return { ok: true, output: parsed.out, usage };
        messages.push(
          { role: "assistant", content: text },
          {
            role: "user",
            content: `Your answer has these problems:\n- ${errors.join("\n- ")}\nSend the corrected JSON only.`,
          },
        );
      }
      return { ok: false, error: errors.join("; "), usage };
    },
  };
}

export type Gateway = ReturnType<typeof createGateway>;
