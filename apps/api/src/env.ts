// SPDX-License-Identifier: AGPL-3.0-or-later
// Configuration comes from env vars only (SDD "Deployment"). infra/.env.example lists them.
import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

export const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Public URL of the API, for example https://api.example.ch. */
  BASE_URL: z.string().url(),
  PORT: z.coerce.number().int().default(3000),
  /** The first account with this email becomes the instance owner. */
  OWNER_EMAIL: z.string().email().optional(),
  BILLING_ENABLED: bool,
  POWERSYNC_AUDIENCE: z.string().default("powersync"),
  /** Passkey relying party: the base domain, for example example.ch. */
  PASSKEY_RP_ID: z.string().min(1),
  PASSKEY_RP_NAME: z.string().default("Vee"),
  ANDROID_PACKAGE: z.string().default("app.vee.mobile"),
  /** SHA-256 fingerprints of the app signing keys, comma-separated. */
  ANDROID_CERT_SHA256: z.string().default(""),
  /** smtp: send through SMTP_URL. memory: keep mail in memory (tests only). */
  MAIL_TRANSPORT: z.enum(["smtp", "memory"]).default("smtp"),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Vee <no-reply@localhost>"),
  /** AI is off when the key is empty. */
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  AI_MODEL_STRUCTURED: z.string().default("deepseek/deepseek-v4.1-flash"),
  AI_MODEL_WRITER: z.string().default("deepseek/deepseek-v4.1-flash"),
  /** Monthly AI spend cap per user, in CHF. */
  AI_MONTHLY_CAP_CHF: z.coerce.number().positive().default(5),
  /** Converts the provider's USD cost to CHF for the cap. */
  AI_CHF_PER_USD: z.coerce.number().positive().default(0.8),
  /** Origin of the coach web app, for example https://coach.example.ch. Gets CORS and browser sign-in links. */
  COACH_URL: z.string().url().optional(),
  /** Firebase service-account JSON for FCM push. Push is off when it is empty. */
  FCM_SERVICE_ACCOUNT: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  // Compose passes an unset variable as an empty string: that means "not set".
  const set = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const env = EnvSchema.parse(set);
  if (env.MAIL_TRANSPORT === "smtp" && !env.SMTP_URL)
    throw new Error("SMTP_URL is required when MAIL_TRANSPORT=smtp");
  return env;
}
