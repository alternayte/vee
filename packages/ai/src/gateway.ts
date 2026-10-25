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
  | { ok: true; output: T; usage: Usage[]; retriedFor?: string[] }
  | { ok: false; error: string; usage: Usage[] };

export type TaskSpec<T> = {
  name: string;
  system: string;
  /** The minimised input, sent as JSON. */
  input: unknown;
  schema: z.ZodType<T>;
  /** The schema sent to the model, when it is stricter than the one that parses the answer. */
  wireSchema?: z.ZodType;
  /** Problems with a schema-valid answer. Empty means it passes. */
  validate: (out: T) => string[];
  route: Route;
  timeoutMs: number;
};

type Message = { role: "system" | "user" | "assistant"; content: string };

/** A message in a chat with tools (OpenAI format, as OpenRouter takes it). */
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolSpec = { name: string; description: string; parameters: unknown };

export type ChatRound = { text: string; toolCalls: ToolCall[]; usage: Usage };

type Delta = {
  model?: string;
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { total_tokens?: number; cost?: number };
  error?: { message?: string };
};

/** The JSON payloads of a server-sent event stream. */
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      // Lines that start with ":" are keep-alive comments.
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        yield data;
      }
      end = buffer.indexOf("\n");
    }
  }
}

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
    return { errors: [`The answer is not valid JSON: ${JSON.stringify(raw.slice(0, 120))}`] };
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
          json_schema: {
            name: spec.name,
            strict: false,
            schema: z.toJSONSchema(spec.wireSchema ?? spec.schema),
          },
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
    /**
     * One streamed chat round. Text deltas go to `onText` as they arrive; tool
     * calls come back whole at the end.
     */
    async chatRound(spec: {
      route: Route;
      messages: ChatMessage[];
      tools: ToolSpec[];
      timeoutMs: number;
      onText: (delta: string) => void;
    }): Promise<ChatRound> {
      const started = Date.now();
      const r = await f(url, {
        method: "POST",
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(spec.timeoutMs),
        body: JSON.stringify({
          model: spec.route.model,
          messages: spec.messages,
          stream: true,
          reasoning: { effort: spec.route.effort, exclude: true },
          ...(spec.tools.length ? { tools: spec.tools.map((t) => ({ type: "function", function: t })) } : {}),
          provider: { zdr: true, data_collection: "deny", require_parameters: true },
          usage: { include: true },
        }),
      });
      if (!r.ok || !r.body)
        throw new Error(`model call failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
      let text = "";
      let model = spec.route.model;
      let cost = 0;
      let tokens = 0;
      const calls: ToolCall[] = [];
      for await (const data of events(r.body)) {
        const d = JSON.parse(data) as Delta;
        if (d.error) throw new Error(`model call failed: ${d.error.message ?? "stream error"}`);
        if (d.model) model = d.model;
        if (d.usage) {
          cost = d.usage.cost ?? cost;
          tokens = d.usage.total_tokens ?? tokens;
        }
        const delta = d.choices?.[0]?.delta;
        if (delta?.content) {
          text += delta.content;
          spec.onText(delta.content);
        }
        for (const t of delta?.tool_calls ?? []) {
          const c = calls[t.index] ?? { id: "", type: "function", function: { name: "", arguments: "" } };
          calls[t.index] = c;
          if (t.id) c.id = t.id;
          if (t.function?.name) c.function.name += t.function.name;
          if (t.function?.arguments) c.function.arguments += t.function.arguments;
        }
      }
      return {
        text,
        toolCalls: calls.filter(Boolean),
        usage: { model, costUsd: cost, tokens, ms: Date.now() - started },
      };
    },

    async run<T>(spec: TaskSpec<T>): Promise<TaskResult<T>> {
      const usage: Usage[] = [];
      const messages: Message[] = [
        { role: "system", content: spec.system },
        { role: "user", content: JSON.stringify(spec.input) },
      ];
      let errors: string[] = [];
      let firstErrors: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        let text: string;
        try {
          const c = await complete(spec as TaskSpec<unknown>, messages);
          usage.push(c.usage);
          text = c.text;
        } catch (e) {
          // A timeout or a provider error gets the same one retry.
          errors = [e instanceof Error ? e.message : String(e)];
          firstErrors = errors;
          continue;
        }
        const parsed = parse(spec.schema, text);
        errors = parsed.out === undefined ? parsed.errors : spec.validate(parsed.out);
        if (parsed.out !== undefined && errors.length === 0)
          return { ok: true, output: parsed.out, usage, ...(attempt > 0 ? { retriedFor: firstErrors } : {}) };
        firstErrors = errors;
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
