// SPDX-License-Identifier: AGPL-3.0-or-later
// Better Auth: passkeys first, magic link as the fallback, sessions for the
// app, short JWTs (JWKS) for the PowerSync service, and the OAuth server for
// MCP clients such as Claude.
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { expo } from "@better-auth/expo";
import { mcp } from "@better-auth/mcp";
import { passkey } from "@better-auth/passkey";
import { uuidv7 } from "@vee/schema";
import { betterAuth } from "better-auth";
import { bearer, jwt, magicLink } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import type pg from "pg";
import type { Db } from "./db";
import type { Env } from "./env";
import type { Mailer } from "./mail";

export const SESSION_DAYS = 180;
export const MAGIC_LINK_SECONDS = 600;
export const POWERSYNC_TOKEN_TTL = "15m";

export type Tier = "free" | "plus" | "coach" | "owner";

/** OAuth scopes an MCP client can ask for: the coach scopes without photos. */
export const MCP_SCOPES = ["training", "food", "body"] as const;
export const MCP_TOKEN_SECONDS = 3600;
export const OAUTH_LOGIN_PATH = "/oauth/login";
export const OAUTH_CONSENT_PATH = "/oauth/consent";

/**
 * The MCP resource URL, or undefined when MCP is off. OAuth needs HTTPS; plain
 * HTTP works only on a loopback host (tests). The emulator backend at
 * 10.0.2.2 runs without MCP.
 */
export function mcpResource(env: Env): string | undefined {
  const u = new URL(env.BASE_URL);
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  return u.protocol === "https:" || loopback ? `${u.origin}/mcp` : undefined;
}

/** Where a sign-in link goes on in a browser, not the app: an OAuth sign-in or the coach web app. */
function browserTarget(url: string, env: Env): "oauth" | "coach" | undefined {
  const back = new URL(url).searchParams.get("callbackURL") ?? "";
  if (back.startsWith(`${env.BASE_URL}/api/auth/oauth2/`)) return "oauth";
  if (env.COACH_URL && back.startsWith(env.COACH_URL)) return "coach";
  return undefined;
}

/** The first account whose email matches OWNER_EMAIL is the owner. With billing off, everyone else gets plus. */
export async function grantEntitlement(db: Db, env: Env, user: { id: string; email: string }): Promise<Tier> {
  return db.transaction(async (tx) => {
    // One sign-up at a time decides ownership.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${OWNER_LOCK})`);
    const owners = await tx.execute(sql`SELECT 1 FROM entitlements WHERE tier = 'owner' LIMIT 1`);
    const isOwner =
      env.OWNER_EMAIL !== undefined &&
      user.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase() &&
      owners.rows.length === 0;
    const tier: Tier = isOwner ? "owner" : env.BILLING_ENABLED ? "free" : "plus";
    const source = isOwner ? "instance_owner" : "instance";
    const now = new Date().toISOString();
    await tx.execute(
      sql`INSERT INTO entitlements (id, user_id, tier, source, created_at, updated_at)
          VALUES (${uuidv7()}, ${user.id}, ${tier}, ${source}, ${now}, ${now})`,
    );
    return tier;
  });
}

const OWNER_LOCK = 704_212_346;

export function createAuth(env: Env, pool: pg.Pool, db: Db, mailer: Mailer) {
  const resource = mcpResource(env);
  return betterAuth({
    database: pool,
    baseURL: env.BASE_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: ["vee://", "app.vee.mobile://", env.BASE_URL, ...(env.COACH_URL ? [env.COACH_URL] : [])],
    emailAndPassword: { enabled: false },
    session: { expiresIn: SESSION_DAYS * 24 * 3600, updateAge: 24 * 3600 },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_SECONDS,
        // The link opens the app (Android App Link on the API domain). The app
        // then verifies the token itself and keeps the session token.
        sendMagicLink: async ({ email, token, url }) => {
          const target = browserTarget(url, env);
          if (target === "oauth") {
            await mailer.send({
              to: email,
              subject: "Connect an app to Vee",
              text: `Open this link in the same browser to connect the app to your Vee data. The link works once and expires in 10 minutes.\n\n${url}\n`,
            });
            return;
          }
          if (target === "coach") {
            await mailer.send({
              to: email,
              subject: "Sign in to Vee for coaches",
              text: `Open this link in your browser to sign in to the coach dashboard. The link works once and expires in 10 minutes.\n\n${url}\n`,
            });
            return;
          }
          const link = `${env.BASE_URL}/app/auth/magic?token=${encodeURIComponent(token)}`;
          await mailer.send({
            to: email,
            subject: "Your Vee sign-in link",
            text: `Open this link on your phone to sign in to Vee. The link works once and expires in 10 minutes.\n\n${link}\n`,
          });
        },
      }),
      passkey({ rpID: env.PASSKEY_RP_ID, rpName: env.PASSKEY_RP_NAME }),
      expo(),
      bearer(),
      jwt({
        jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } },
        jwt: { issuer: env.BASE_URL, audience: env.POWERSYNC_AUDIENCE, expirationTime: POWERSYNC_TOKEN_TTL },
      }),
      ...(resource
        ? [
            mcp({
              resource,
              loginPage: OAUTH_LOGIN_PATH,
              consentPage: OAUTH_CONSENT_PATH,
              scopes: ["openid", "offline_access", ...MCP_SCOPES],
              accessTokenExpiresIn: MCP_TOKEN_SECONDS,
              // MCP clients register themselves (RFC 7591) or by a metadata URL (CIMD).
              allowDynamicClientRegistration: true,
              allowUnauthenticatedClientRegistration: true,
            }),
            cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
          ]
        : []),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await grantEntitlement(db, env, user);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
