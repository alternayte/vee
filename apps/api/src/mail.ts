// SPDX-License-Identifier: AGPL-3.0-or-later
import nodemailer from "nodemailer";
import type { Env } from "./env";

export type Mail = { to: string; subject: string; text: string };

export type Mailer = { send(mail: Mail): Promise<void>; sent: Mail[] };

/** SMTP in production. The memory transport keeps mail for tests and sends nothing. */
export function createMailer(env: Env): Mailer {
  const sent: Mail[] = [];
  if (env.MAIL_TRANSPORT === "memory") {
    return {
      sent,
      async send(mail) {
        sent.push(mail);
      },
    };
  }
  const transport = nodemailer.createTransport(env.SMTP_URL);
  return {
    sent,
    async send(mail) {
      await transport.sendMail({ from: env.MAIL_FROM, ...mail });
    },
  };
}
