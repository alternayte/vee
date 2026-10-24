// SPDX-License-Identifier: AGPL-3.0-or-later
import { Hono } from "hono";
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import {
  createExport,
  deleteAccount,
  EXPORT_HOURS,
  FRESH_SESSION_MINUTES,
  ImportError,
  importCsv,
  readExport,
} from "./account";
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

  // The magic-link landing page. On a phone with Vee, the App Link opens the
  // app before this page loads. Elsewhere, the page gives the app link.
  app.get("/app/auth/magic", (c) => {
    const token = c.req.query("token") ?? "";
    const appLink = `app.vee.mobile://auth/magic?token=${encodeURIComponent(token)}`;
    return c.html(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to Vee</title></head><body style="font-family:system-ui;background:#0e1114;color:#e8eaed;padding:24px"><h1>Sign in to Vee</h1><p>Open this page on the phone that has Vee.</p><p><a style="color:#c9a253" href="${appLink.replaceAll('"', "&quot;")}">Open Vee</a></p></body></html>`,
    );
  });

  if (env.MAIL_TRANSPORT === "memory") {
    // Test mode only: the end-to-end flows read the latest sign-in token here.
    app.get("/dev/mail/latest", (c) => {
      const to = c.req.query("to");
      const mail = [...mailer.sent].reverse().find((m) => m.to === to);
      const token = mail?.text.match(/token=([^\s&]+)/)?.[1];
      return token ? c.json({ token: decodeURIComponent(token) }) : c.json({ error: "no-mail" }, 404);
    });
  }

  app.use("/export", async (c, next) => {
    if (!(await requireUser(c, next, (id) => c.set("userId", id))))
      return c.json({ error: "unauthorized" }, 401);
  });
  app.use("/import/*", async (c, next) => {
    if (!(await requireUser(c, next, (id) => c.set("userId", id))))
      return c.json({ error: "unauthorized" }, 401);
  });

  app.post("/export", async (c) => {
    const userId = c.get("userId");
    const id = await createExport(db, userId);
    const email = (await pool.query<{ email: string }>('SELECT email FROM "user" WHERE id = $1', [userId]))
      .rows[0]?.email;
    if (email) {
      await mailer.send({
        to: email,
        subject: "Your Vee data export",
        text: `Your export is ready. The link works for ${EXPORT_HOURS} hours.\n\n${env.BASE_URL}/export/${id}\n\nThe sets as CSV:\n${env.BASE_URL}/export/${id}/sets.csv\n`,
      });
    }
    return c.json({ queued: true }, 202);
  });

  app.get("/export/:id", async (c) => {
    const e = await readExport(db, c.req.param("id"));
    if (!e) return c.json({ error: "not-found" }, 404);
    return c.body(e.json, 200, {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="vee-export.json"',
    });
  });

  app.get("/export/:id/sets.csv", async (c) => {
    const e = await readExport(db, c.req.param("id"));
    if (!e) return c.json({ error: "not-found" }, 404);
    return c.body(e.csv, 200, {
      "content-type": "text/csv",
      "content-disposition": 'attachment; filename="vee-sets.csv"',
    });
  });

  app.post("/import/:format", async (c) => {
    const format = c.req.param("format");
    if (format !== "hevy" && format !== "strong" && format !== "fitnotes")
      return c.json({ error: "unknown-format" }, 404);
    try {
      return c.json(await importCsv(db, c.get("userId"), format, await c.req.text()));
    } catch (e) {
      if (e instanceof ImportError) return c.json({ error: "invalid-file", message: e.message }, 400);
      throw e;
    }
  });

  app.delete("/account", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const age = Date.now() - new Date(session.session.createdAt).getTime();
    if (age > FRESH_SESSION_MINUTES * 60_000) {
      return c.json({ error: "reauth-required", message: "Sign in again, then delete the account." }, 403);
    }
    await deleteAccount(db, session.user.id);
    return c.json({ deleted: true, message: "Your account and all your data are deleted from the server." });
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
