// SPDX-License-Identifier: AGPL-3.0-or-later
// The coach web app reads through the API, never PowerSync: the API checks the
// client's scopes and writes the audit row for every read (I8).
export const API_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: init.body === undefined ? {} : { "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const json = (await r.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!r.ok)
    throw new ApiError(r.status, json.error ?? "error", json.message ?? "Vee cannot do this now. Try again.");
  return json;
}
