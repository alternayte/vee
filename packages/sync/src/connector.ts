// SPDX-License-Identifier: AGPL-3.0-or-later
// PowerSync backend connector (SDD "Write path"). Credentials: a 15-minute JWT
// from the API. Uploads: one CRUD transaction at a time to POST /sync/upload.
// Refused operations come back with a code; the app keeps them (I5).
import type {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from "@powersync/common";

export type Rejected = { index: number; table: string; id: string; code: string; message: string };

export type ConnectorOptions = {
  apiUrl: string;
  powersyncUrl: string;
  /** The Better Auth session token, or null when signed out. */
  sessionToken: () => Promise<string | null>;
  /** Called with the operations the server refused, before the transaction completes. */
  onRejected?: (rejected: Rejected[], ops: UploadOp[]) => Promise<void> | void;
  fetch?: typeof fetch;
};

export type UploadOp = {
  op: "PUT" | "PATCH" | "DELETE";
  table: string;
  id: string;
  data?: Record<string, unknown>;
};

export class UploadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createConnector(o: ConnectorOptions): PowerSyncBackendConnector {
  const f = o.fetch ?? fetch;
  return {
    async fetchCredentials(): Promise<PowerSyncCredentials | null> {
      const session = await o.sessionToken();
      if (!session) return null;
      const r = await f(`${o.apiUrl}/auth/powersync-token`, {
        headers: { authorization: `Bearer ${session}` },
      });
      if (r.status === 401) return null;
      if (!r.ok) throw new UploadError(r.status, `token request failed: ${r.status}`);
      const { token } = (await r.json()) as { token: string };
      return { endpoint: o.powersyncUrl, token };
    },

    async uploadData(db: AbstractPowerSyncDatabase): Promise<void> {
      for (;;) {
        const tx = await db.getNextCrudTransaction();
        if (!tx) return;
        const ops: UploadOp[] = tx.crud.map((e) => ({
          op: e.op,
          table: e.table,
          id: e.id,
          ...(e.opData ? { data: e.opData } : {}),
        }));
        const session = await o.sessionToken();
        if (!session) throw new UploadError(401, "signed out");
        const r = await f(`${o.apiUrl}/sync/upload`, {
          method: "POST",
          headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
          body: JSON.stringify({ batch: ops }),
        });
        // A server or network error leaves the transaction in the queue; PowerSync retries it.
        if (!r.ok) throw new UploadError(r.status, `upload failed: ${r.status}`);
        const body = (await r.json()) as { applied: number; rejected: Rejected[] };
        if (body.rejected.length > 0) await o.onRejected?.(body.rejected, ops);
        await tx.complete();
      }
    },
  };
}
