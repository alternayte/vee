// SPDX-License-Identifier: AGPL-3.0-or-later
import type { History } from "./types";

/** History for a new user: no account, no server, no data (I10). */
export function emptyHistory(): History {
  return { progress: [], sessions: [], sets: [], checkins: [], prescriptions: [], tests: [] };
}
