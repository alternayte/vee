// SPDX-License-Identifier: AGPL-3.0-or-later
// Better Auth: passkeys first, magic link as the fallback, sessions for the
// app, and short JWTs (JWKS) for the PowerSync service.
import { expo } from "@better-auth/expo";
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
  return betterAuth({
    database: pool,
    baseURL: env.BASE_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: ["vee://", "app.vee.mobile://", env.BASE_URL],
    emailAndPassword: { enabled: false },
    session: { expiresIn: SESSION_DAYS * 24 * 3600, updateAge: 24 * 3600 },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_SECONDS,
        sendMagicLink: async ({ email, url }) => {
          await mailer.send({
            to: email,
            subject: "Your Vee sign-in link",
            text: `Open this link to sign in to Vee. The link works once and expires in 10 minutes.\n\n${url}\n`,
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
