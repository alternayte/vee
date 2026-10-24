// SPDX-License-Identifier: AGPL-3.0-or-later
// Account and sync (SDD "Sync, auth and tenancy"). The Better Auth session
// token stays in SecureStore. With a session, PowerSync connects and uploads
// the local history; without one, the app works offline only (I10).
import { sync_errors, uuidv7 } from "@vee/schema";
import { createConnector, type Rejected, type UploadOp } from "@vee/sync";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { db, powersync } from "@/features/db/database";
import { API_URL, HAS_SERVER, POWERSYNC_URL } from "./config";

const KEY = "vee.session";

type Session = { token: string; userId: string; email: string };

type AccountState = {
  status: "loading" | "signed-out" | "signed-in";
  session: Session | null;
};

export const useAccount = create<AccountState>(() => ({ status: "loading", session: null }));

/** Keeps every refused operation with its data, so nothing is lost silently (I5). */
async function recordRejected(rejected: Rejected[], ops: UploadOp[]) {
  const at = new Date().toISOString();
  for (const r of rejected) {
    const op = ops[r.index];
    await db.insert(sync_errors).values({
      id: uuidv7(),
      table_name: r.table,
      row_id: r.id,
      op: op?.op ?? "PUT",
      code: r.code,
      message: r.message,
      data: op?.data ? JSON.stringify(op.data) : null,
      created_at: at,
    });
  }
}

const connector = createConnector({
  apiUrl: API_URL,
  powersyncUrl: POWERSYNC_URL,
  sessionToken: async () => useAccount.getState().session?.token ?? null,
  onRejected: recordRejected,
});

async function connect() {
  if (HAS_SERVER) await powersync.connect(connector);
}

/** Reads the stored session and connects. Runs once at start. */
export async function loadAccount() {
  const raw = await SecureStore.getItemAsync(KEY);
  const session = raw ? (JSON.parse(raw) as Session) : null;
  useAccount.setState({ status: session ? "signed-in" : "signed-out", session });
  if (session) await connect();
}

export class AccountError extends Error {}

const offline = () => new AccountError("No connection to the server. Try again when you are online.");

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const token = useAccount.getState().session?.token;
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  } catch {
    throw offline();
  }
}

/** Sends the sign-in link by email. */
export async function requestLink(email: string) {
  const r = await call("/api/auth/sign-in/magic-link", {
    method: "POST",
    body: JSON.stringify({ email: email.trim() }),
  });
  if (!r.ok) throw new AccountError("The server did not send the link. Check the address and try again.");
}

/**
 * Verifies the token from the link and keeps the session. With no callback
 * URL, Better Auth answers with JSON instead of a redirect.
 */
export async function verifyLink(token: string) {
  const r = await call(`/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`);
  const body = r.ok
    ? ((await r.json().catch(() => null)) as { token?: string; user?: { id: string; email: string } } | null)
    : null;
  if (!body?.token || !body.user) throw new AccountError("This link is used or expired. Ask for a new link.");
  const session = { token: body.token, userId: body.user.id, email: body.user.email };
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  useAccount.setState({ status: "signed-in", session });
  await connect();
}

async function forget() {
  await powersync.disconnectAndClear();
  await SecureStore.deleteItemAsync(KEY);
  useAccount.setState({ status: "signed-out", session: null });
}

/** Signs out and removes the account's data from this phone. The server keeps it. */
export async function signOut() {
  await call("/api/auth/sign-out", { method: "POST", body: "{}" }).catch(() => undefined);
  await forget();
}

/** Deletes the account on the server, then the data on this phone. */
export async function deleteAccount() {
  const r = await call("/account", { method: "DELETE" });
  if (r.status === 403) throw new AccountError("For your safety, sign in again, then delete the account.");
  if (!r.ok) throw new AccountError("The server did not delete the account. Try again.");
  await forget();
}
