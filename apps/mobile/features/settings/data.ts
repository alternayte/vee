// SPDX-License-Identifier: AGPL-3.0-or-later
// Data rights on the phone: export with no account and no connection, and
// import from Hevy, Strong and FitNotes into the local database.
import { importRows, parseImport } from "@vee/importers";
import { custom_exercises, sessions, sets, syncedTables, uuidv7 } from "@vee/schema";
import { exportJson, setsCsv } from "@vee/schema/export";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useAccount } from "@/features/account/account";
import { db, powersync } from "@/features/db/database";

async function share(name: string, text: string, mimeType: string) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
}

async function readTables(): Promise<Record<string, unknown[]>> {
  const tables: Record<string, unknown[]> = {};
  for (const name of Object.keys(syncedTables)) {
    tables[name] = await powersync.getAll(`SELECT * FROM "${name}" ORDER BY id`);
  }
  return tables;
}

export async function shareExportJson() {
  const tables = await readTables();
  await share(
    "vee-export.json",
    exportJson(tables, useAccount.getState().session?.userId ?? null),
    "application/json",
  );
}

export async function shareSetsCsv() {
  const rows = await powersync.getAll<Record<string, unknown>>("SELECT * FROM sets ORDER BY logged_at, id");
  await share("vee-sets.csv", setsCsv(rows), "text/csv");
}

export type ImportSummary = { sessions: number; sets: number; customExercises: number };

/** Opens the file picker and writes the sessions and sets. Undefined when the user cancels. */
export async function importCsvFile(): Promise<ImportSummary | undefined> {
  const pick = await DocumentPicker.getDocumentAsync({
    type: ["text/csv", "text/comma-separated-values", "text/plain", "application/octet-stream"],
    copyToCacheDirectory: true,
  });
  const asset = pick.canceled ? undefined : pick.assets[0];
  if (!asset) return undefined;
  const parsed = parseImport(await new File(asset.uri).text());
  const known = new Set(
    (
      await powersync.getAll<{ slug: string }>(
        "SELECT json_extract(exercise, '$.id') AS slug FROM custom_exercises",
      )
    ).map((r) => r.slug),
  );
  const rows = importRows(parsed, {
    userId: useAccount.getState().session?.userId ?? null,
    now: new Date().toISOString(),
    newId: uuidv7,
    customId: () => uuidv7(),
  });
  const newCustom = rows.custom_exercises.filter(
    (c) => !known.has((JSON.parse(c.exercise) as { id: string }).id),
  );
  await db.transaction(async (tx) => {
    if (newCustom.length > 0) await tx.insert(custom_exercises).values(newCustom);
    for (const s of rows.sessions) await tx.insert(sessions).values(s);
    for (const x of rows.sets) await tx.insert(sets).values(x);
  });
  return { sessions: rows.sessions.length, sets: rows.sets.length, customExercises: newCustom.length };
}
