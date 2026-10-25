// SPDX-License-Identifier: AGPL-3.0-or-later
// V7: the MCP server behind OAuth: discovery, the browser sign-in and consent,
// tokens scoped to what the user granted, and the tools on the user's data.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import type { App } from "../src/app";
import { freshDatabase, query, request, signIn, startApp } from "./harness";
import { onboard } from "./onboard";

const BASE = "http://localhost:3999";
const RESOURCE = `${BASE}/mcp`;
const REDIRECT = "https://client.example.test/callback";
let app: App;

// requireMcpAuth reads the JWKS over HTTP from BASE_URL, as in production.
let listener: ReturnType<typeof Bun.serve> | undefined;

beforeAll(async () => {
  await freshDatabase();
  app = await startApp();
  listener = Bun.serve({ port: 3999, fetch: (r) => app.fetch(r) });
});

afterAll(async () => {
  await listener?.stop(true);
  await app.close();
});

/** Cookies from Set-Cookie headers, kept across requests like a browser. */
class Jar {
  cookies = new Map<string, string>();
  take(r: Response) {
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const at = pair?.indexOf("=") ?? -1;
      if (pair && at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return r;
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const path = (location: string | null) => {
  if (!location) throw new Error("no redirect");
  const u = new URL(location, BASE);
  return u.origin === BASE ? `${u.pathname}${u.search}` : u.toString();
};

/** The whole connect flow a client such as Claude runs, with a user in a browser. Returns the token response. */
async function connect(email: string, scope: string, grant: string[]) {
  const reg = await request(app, "/api/auth/oauth2/register", {
    method: "POST",
    body: JSON.stringify({
      client_name: "Test MCP client",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (reg.status >= 300) throw new Error(`register: ${reg.status} ${await reg.text()}`);
  const client = (await reg.json()) as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    scope,
    state: "s1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  });
  const jar = new Jar();
  const first = jar.take(
    await request(app, `/api/auth/oauth2/authorize?${authorize}`, { redirect: "manual" }),
  );
  const login = path(first.headers.get("location"));
  expect(login.startsWith("/oauth/login?")).toBe(true);
  expect((await request(app, login)).status).toBe(200);

  // The login page asks for a magic link that comes back to authorize.
  const callbackURL = `${BASE}/api/auth/oauth2/authorize${login.slice("/oauth/login".length)}`;
  const sent = await request(app, "/api/auth/sign-in/magic-link", {
    method: "POST",
    body: JSON.stringify({ email, callbackURL }),
  });
  expect(sent.status).toBe(200);
  const mail = [...app.mailer.sent].reverse().find((m) => m.to === email);
  expect(mail?.subject).toBe("Connect an app to Vee");
  const link = mail?.text.match(/https?:\/\/\S+/)?.[0] ?? "";
  expect(link).toContain("/api/auth/magic-link/verify");

  let next = path(link);
  let consent = "";
  for (let hop = 0; hop < 6 && !consent; hop++) {
    const r = jar.take(await request(app, next, { redirect: "manual", headers: { cookie: jar.header() } }));
    next = path(r.headers.get("location"));
    if (next.startsWith("/oauth/consent?")) consent = next;
  }
  expect(consent).not.toBe("");
  const pageHtml = await (await request(app, consent, { headers: { cookie: jar.header() } })).text();
  expect(pageHtml).toContain("Connect Test MCP client to Vee");

  const accepted = await request(app, "/api/auth/oauth2/consent", {
    method: "POST",
    headers: { cookie: jar.header() },
    body: JSON.stringify({
      accept: true,
      // As the consent page sends it: the requested non-data scopes plus the checked data.
      scope: [...scope.split(" ").filter((x) => !["training", "food", "body"].includes(x)), ...grant].join(
        " ",
      ),
      oauth_query: consent.slice(consent.indexOf("?") + 1),
    }),
  });
  expect(accepted.status).toBe(200);
  const body = (await accepted.json()) as { url?: string; redirect_uri?: string };
  const back = new URL(body.url ?? body.redirect_uri ?? "");
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  const code = back.searchParams.get("code") ?? "";

  const token = await request(app, "/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: RESOURCE,
    }).toString(),
  });
  expect(token.status).toBe(200);
  return (await token.json()) as { access_token: string; scope: string };
}

let rpcId = 0;
async function rpc(token: string, method: string, params: unknown = {}) {
  const r = await request(app, "/mcp", {
    method: "POST",
    token,
    headers: { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await r.text();
  const json = text.startsWith("{") ? text : (/data: (.*)/.exec(text)?.[1] ?? "null");
  return {
    status: r.status,
    body: JSON.parse(json) as { result?: Record<string, unknown>; error?: unknown },
  };
}

const initialize = (token: string) =>
  rpc(token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });

describe("MCP", () => {
  test("discovery documents point the client at the OAuth server", async () => {
    const pr = await request(app, "/.well-known/oauth-protected-resource/mcp");
    expect(pr.status).toBe(200);
    const meta = (await pr.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    expect(meta.resource).toBe(RESOURCE);
    expect(meta.scopes_supported).toEqual(expect.arrayContaining(["training", "food", "body"]));
    const issuer = new URL(meta.authorization_servers[0] ?? "");
    const as = await request(
      app,
      `/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/, "")}`,
    );
    expect(as.status).toBe(200);
    expect(await as.json()).toMatchObject({
      authorization_endpoint: expect.stringContaining("/oauth2/authorize"),
    });
  });

  test("no token, or an app session token, gets 401 with a challenge", async () => {
    const none = await request(app, "/mcp", { method: "POST", body: "{}" });
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("resource_metadata");
    const user = await signIn(app, "session@example.test");
    const session = await request(app, "/mcp", { method: "POST", body: "{}", token: user.token });
    expect(session.status).toBe(401);
  });

  test("a training-only token lists training tools, reads the user's ladders, and proposes a card", async () => {
    const user = await signIn(app, "mcp@example.test");
    const plan = await onboard(user.userId);
    const t = await connect("mcp@example.test", "openid offline_access training food body", ["training"]);
    expect(t.scope.split(" ")).not.toContain("food");

    expect((await initialize(t.access_token)).status).toBe(200);
    const list = await rpc(t.access_token, "tools/list");
    const names = ((list.body.result?.tools ?? []) as { name: string }[]).map((x) => x.name);
    expect(names).toContain("get_progress_state");
    expect(names).toContain("propose_change");
    expect(names).not.toContain("get_food_summary");
    expect(names).not.toContain("get_weight_trend");

    const planCall = await rpc(t.access_token, "tools/call", { name: "get_plan", arguments: {} });
    const content = (planCall.body.result?.content ?? []) as { text: string }[];
    expect(JSON.parse(content[0]?.text ?? "{}").days).toHaveLength(plan.templates.length);

    const item = plan.templates[0]?.items[0];
    const proposed = await rpc(t.access_token, "tools/call", {
      name: "propose_change",
      arguments: {
        change: { kind: "sets", dayType: "A", exerciseId: item?.exerciseId, sets: 1 },
        why: "Short week.",
      },
    });
    expect(
      JSON.parse(((proposed.body.result?.content ?? []) as { text: string }[])[0]?.text ?? "{}"),
    ).toMatchObject({
      accepted: true,
    });
    const rows = await query<{ source: string; status: string }>(
      "SELECT source, status FROM ai_proposals WHERE user_id = $1",
      [user.userId],
    );
    expect(rows).toEqual([{ source: "mcp", status: "pending" }]);

    const food = await rpc(t.access_token, "tools/call", { name: "get_food_summary", arguments: {} });
    expect(JSON.stringify(food.body)).toMatch(/not found|unknown|No tool/i);
  });

  test("an MCP token does not open the app routes", async () => {
    const t = await connect("mcp2@example.test", "openid training", ["training"]);
    const r = await request(app, "/ai/chat", {
      method: "POST",
      token: t.access_token,
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.status).toBe(401);
  });
});
