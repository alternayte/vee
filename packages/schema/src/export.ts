// SPDX-License-Identifier: AGPL-3.0-or-later
// The data export format (PRD "Your data is yours"): one JSON document with
// every synced table, plus the sets as CSV. The server and the app write the
// same format.

export const EXPORT_FORMAT = "vee-export";
export const EXPORT_VERSION = 1;

export const SET_CSV_COLUMNS = [
  "logged_at",
  "session_id",
  "exercise_id",
  "side",
  "reps",
  "seconds",
  "load_kg",
  "effort",
] as const;

function csvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function exportJson(
  tables: Record<string, unknown[]>,
  userId: string | null,
  exportedAt = new Date().toISOString(),
): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt, userId, tables });
}

export function setsCsv(sets: Record<string, unknown>[]): string {
  const lines = [
    SET_CSV_COLUMNS.join(","),
    ...sets.map((s) => SET_CSV_COLUMNS.map((c) => csvField(s[c])).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}
