// SPDX-License-Identifier: AGPL-3.0-or-later
import { serverSchema } from "@vee/schema/server";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

export function createPool(url: string): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 10 });
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema: serverSchema });
}

export type Db = ReturnType<typeof createDb>;
