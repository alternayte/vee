// SPDX-License-Identifier: AGPL-3.0-or-later
// The MCP server (SDD "MCP server"): the coach-chat tools for an MCP client
// such as Claude, behind OAuth through Better Auth. Each token carries the
// scopes the user granted (training, food, body); a tool outside them is not
// listed. propose_change is the only write and makes a card the user accepts
// or rejects in the app (I4).

import { requireMcpAuth } from "@better-auth/mcp";
import { oauthProviderAuthServerMetadata, verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { type AuthInfo, createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { type Scope, toolsFor } from "@vee/ai";
import type { Hono } from "hono";
import type pg from "pg";
import type { Ai } from "./ai";
import { type Auth, MCP_SCOPES, OAUTH_CONSENT_PATH, OAUTH_LOGIN_PATH } from "./auth";
import type { Env } from "./env";

const SCOPE_TEXT: Record<Scope, string> = {
  training:
    "Training: sessions, sets, check-ins, tests, the plan and reviews. It can also propose plan changes for you to accept in Vee.",
  food: "Food: how many days you logged and how much of your portion targets you reached.",
  body: "Body: your weigh-ins and weight trend.",
};

function server(ai: Ai, userId: string, scopes: Scope[]) {
  const s = new McpServer({ name: "vee", version: "1.0.0" });
  for (const t of toolsFor(scopes)) {
    s.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.args,
        annotations: { readOnlyHint: t.name !== "propose_change" },
      },
      async (args: unknown) => {
        const out = await ai.tool(userId, t.name, args, scopes);
        const failed = typeof out === "object" && out !== null && "error" in out;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(out) }],
          ...(failed ? { isError: true } : {}),
        };
      },
    );
  }
  return s;
}

const grantedScopes = (scope: unknown): Scope[] =>
  String(scope ?? "")
    .split(" ")
    .filter((x): x is Scope => (MCP_SCOPES as readonly string[]).includes(x));

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function page(title: string, body: string, script: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--line:#d6d3d1;--accent:#0f766e}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#fafaf9;--muted:#a8a29e;--line:#44403c;--accent:#2dd4bf}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:28rem;margin:3rem auto;padding:0 1rem}
h1{font-size:1.4rem;margin:0 0 1rem}
p,label{color:var(--muted)}
input[type=email]{width:100%;box-sizing:border-box;padding:.7rem;border:1px solid var(--line);border-radius:.5rem;background:transparent;color:var(--fg);font:inherit}
label{display:flex;gap:.6rem;align-items:flex-start;margin:.8rem 0}
button{margin-top:1rem;margin-right:.5rem;padding:.7rem 1.2rem;border-radius:.5rem;border:1px solid var(--accent);background:var(--accent);color:var(--bg);font:inherit;cursor:pointer}
button.secondary{background:transparent;color:var(--accent)}
#status{min-height:1.5rem}
</style></head>
<body><main>${body}<p id="status" role="status"></p></main><script>${script}</script></body></html>`;
}

const loginPage = (env: Env) =>
  page(
    "Sign in to Vee",
    `<h1>Sign in to Vee</h1>
<p>An app wants to read your Vee data. Sign in with the email of your Vee account. Vee sends you a link.</p>
<form id="f"><input id="email" type="email" required autocomplete="email" placeholder="you@example.com"><button>Send the link</button></form>`,
    `document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("status");
  const callbackURL = ${JSON.stringify(`${env.BASE_URL}/api/auth/oauth2/authorize`)} + location.search;
  const r = await fetch("/api/auth/sign-in/magic-link", {
    method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
    body: JSON.stringify({ email: document.getElementById("email").value, callbackURL }),
  });
  status.textContent = r.ok ? "Open the link in your email in this browser." : "Vee cannot send the link. Try again.";
});`,
  );

/** `base` is the requested scopes that are not data (openid, offline_access): consent can only grant what was asked. */
const consentPage = (client: string, scopes: Scope[], base: string[]) =>
  page(
    "Connect to Vee",
    `<h1>Connect ${escapeHtml(client)} to Vee</h1>
<p>Select the data that ${escapeHtml(client)} can read. You can remove the connection at any time.</p>
<form id="f">${scopes
      .map(
        (s) =>
          `<label><input type="checkbox" name="scope" value="${s}" checked> <span>${escapeHtml(SCOPE_TEXT[s])}</span></label>`,
      )
      .join("")}
<p>It never sees your photos or notes.</p>
<button value="allow">Allow</button><button class="secondary" value="deny">Deny</button></form>`,
    `const f = document.getElementById("f");
f.addEventListener("submit", async (e) => {
  e.preventDefault();
  const accept = e.submitter && e.submitter.value === "allow";
  const scope = [...f.querySelectorAll("input[name=scope]:checked")].map((x) => x.value);
  if (accept && scope.length === 0) { document.getElementById("status").textContent = "Select at least one kind of data."; return; }
  const r = await fetch("/api/auth/oauth2/consent", {
    method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
    body: JSON.stringify({ accept, scope: [...${JSON.stringify(base).replace(/</g, "\\u003c")}, ...scope].join(" "), oauth_query: location.search.slice(1) }),
  });
  const body = await r.json().catch(() => ({}));
  const to = body.url || body.redirect_uri || body.redirectURI;
  if (to) location.href = to;
  else document.getElementById("status").textContent = "Vee cannot finish the connection. Start again from the app.";
});`,
  );

export function mountMcp(
  app: Hono<{ Variables: { userId: string } }>,
  o: { env: Env; auth: Auth; ai: Ai; pool: pg.Pool; resource: string },
) {
  // OAuth discovery lives at the origin root; Better Auth lives under /api/auth.
  const serverMetadata = oauthProviderAuthServerMetadata(o.auth);
  app.get("/.well-known/oauth-authorization-server/*", (c) => serverMetadata(c.req.raw));
  app.get("/.well-known/oauth-authorization-server", (c) => serverMetadata(c.req.raw));
  app.get("/.well-known/oauth-protected-resource/*", (c) => o.auth.handler(c.req.raw));
  app.get("/.well-known/oauth-protected-resource", (c) => o.auth.handler(c.req.raw));

  app.get(OAUTH_LOGIN_PATH, (c) => c.html(loginPage(o.env)));

  app.get(OAUTH_CONSENT_PATH, async (c) => {
    const query = new URL(c.req.url).searchParams;
    const secret = (await o.auth.$context).secret;
    if (!(await verifyOAuthQueryParams(query.toString(), secret)))
      return c.html(
        page("Connect to Vee", "<h1>This link is not valid</h1><p>Start again from the app.</p>", ""),
        400,
      );
    const clientId = query.get("client_id") ?? "";
    const name =
      (
        await o.pool.query<{ name: string | null }>('SELECT name FROM "oauthClient" WHERE "clientId" = $1', [
          clientId,
        ])
      ).rows[0]?.name ?? "An app";
    const requested = (query.get("scope") ?? "").split(" ").filter(Boolean);
    const asked = grantedScopes(requested.join(" "));
    if (asked.length === 0)
      return c.html(
        page(
          "Connect to Vee",
          `<h1>${escapeHtml(name)} asks for no Vee data</h1><p>Start again from the app.</p>`,
          "",
        ),
        400,
      );
    return c.html(
      consentPage(
        name,
        asked,
        requested.filter((x) => !asked.includes(x as Scope)),
      ),
    );
  });

  const handler = createMcpHandler(({ authInfo }) => {
    const extra = authInfo?.extra as { sub?: string } | undefined;
    if (!extra?.sub) throw new Error("MCP request without a verified user");
    return server(o.ai, extra.sub, grantedScopes(authInfo?.scopes.join(" ")));
  });

  const post = requireMcpAuth(
    o.auth,
    (request, claims) => {
      const authInfo: AuthInfo = {
        token: "",
        clientId: String(claims.azp ?? claims.client_id ?? ""),
        scopes: grantedScopes(claims.scope),
        extra: { sub: claims.sub },
      };
      return handler.fetch(request, { authInfo });
    },
    // The jwt plugin signs with BASE_URL as the issuer, not the /api/auth base path.
    { resource: o.resource, issuer: o.env.BASE_URL },
  );
  app.post("/mcp", (c) => post(c.req.raw));
  app.on(["GET", "DELETE"], "/mcp", (c) => c.json({ error: "method-not-allowed" }, 405));
}
