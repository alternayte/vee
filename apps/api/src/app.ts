// SPDX-License-Identifier: AGPL-3.0-or-later
import { Hono } from "hono";
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import { createAuth } from "./auth";
import { createDb, createPool } from "./db";
import type { Env } from "./env";
import { createMailer } from "./mail";
import { migrate } from "./migrate";
import { applyBatch, BatchSchema } from "./sync/upload";

type Vars = { userId: string };

export function createApp(env: Env) {
  const pool = createPool(env.DATABASE_URL);
  const db = createDb(pool);
  const mailer = createMailer(env);
  const auth = createAuth(env, pool, db, mailer);
  const app = new Hono<{ Variables: Vars }>();

  const internal = (path: string, headers?: Headers) =>
    auth.handler(new Request(`${env.BASE_URL}/api/auth${path}`, headers ? { headers } : {}));

  let keys: ReturnType<typeof createLocalJWKSet> | undefined;
  async function verifyPowerSyncJwt(token: string): Promise<string | undefined> {
    if (token.split(".").length !== 3) return undefined;
    keys ??= createLocalJWKSet((await (await internal("/jwks")).json()) as JSONWebKeySet);
    try {
      const { payload } = await jwtVerify(token, keys, {
        audience: env.POWERSYNC_AUDIENCE,
        issuer: env.BASE_URL,
      });
      return payload.sub;
    } catch {
      return undefined;
    }
  }

  /** A Better Auth session (bearer or cookie), or a PowerSync JWT. */
  async function caller(headers: Headers): Promise<string | undefined> {
    const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer) {
      const sub = await verifyPowerSyncJwt(bearer);
      if (sub) return sub;
    }
    const session = await auth.api.getSession({ headers });
    return session?.user.id;
  }

  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.get("/health", async (c) => {
    try {
      await pool.query("SELECT 1");
      return c.json({ ok: true, db: true });
    } catch {
      return c.json({ ok: false, db: false }, 503);
    }
  });

  app.get("/.well-known/assetlinks.json", (c) =>
    c.json([
      {
        relation: [
          "delegate_permission/common.handle_all_urls",
          "delegate_permission/common.get_login_creds",
        ],
        target: {
          namespace: "android_app",
          package_name: env.ANDROID_PACKAGE,
          sha256_cert_fingerprints: env.ANDROID_CERT_SHA256.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      },
    ]),
  );

  const requireUser = async (
    c: { req: { raw: Request } },
    next: () => Promise<void>,
    set: (id: string) => void,
  ) => {
    const id = await caller(c.req.raw.headers);
    if (!id) return false;
    set(id);
    await next();
    return true;
  };

  app.use("/auth/powersync-token", async (c, next) => {
    if (!(await requireUser(c, next, (id) => c.set("userId", id))))
      return c.json({ error: "unauthorized" }, 401);
  });
  app.use("/sync/*", async (c, next) => {
    if (!(await requireUser(c, next, (id) => c.set("userId", id))))
      return c.json({ error: "unauthorized" }, 401);
  });

  app.get("/auth/powersync-token", async (c) => {
    const r = await internal("/token", c.req.raw.headers);
    if (r.status !== 200) return c.json({ error: "unauthorized" }, 401);
    const { token } = (await r.json()) as { token: string };
    return c.json({ token });
  });

  app.post("/sync/upload", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid-json" }, 400);
    }
    const parsed = BatchSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid-batch", issues: parsed.error.issues }, 400);
    return c.json(await applyBatch(db, c.get("userId"), parsed.data.batch));
  });

  return {
    fetch: (req: Request) => app.fetch(req),
    migrate: () => migrate(pool, auth),
    close: () => pool.end(),
    mailer,
    auth,
    db,
  };
}

export type App = ReturnType<typeof createApp>;
