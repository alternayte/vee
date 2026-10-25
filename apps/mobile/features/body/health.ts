// SPDX-License-Identifier: AGPL-3.0-or-later
// Health Connect (SDD "Health Connect"): reads weight and last night's sleep,
// writes each finished session. Permissions are asked when the feature is
// first used, never at install. Without Health Connect every call is a no-op.
import { Platform } from "react-native";
import {
  ExerciseType,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  insertRecords,
  type Permission,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from "react-native-health-connect";
import { addMetric, applyN1, weighIns } from "./data";

const PERMISSIONS: Permission[] = [
  { accessType: "read", recordType: "Weight" },
  { accessType: "read", recordType: "SleepSession" },
  { accessType: "write", recordType: "ExerciseSession" },
];

async function ready(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    if ((await getSdkStatus()) !== SdkAvailabilityStatus.SDK_AVAILABLE) return false;
    return await initialize();
  } catch {
    return false;
  }
}

const has = async (recordType: Permission["recordType"], accessType: Permission["accessType"]) =>
  (await getGrantedPermissions()).some((p) => p.recordType === recordType && p.accessType === accessType);

/** Asks for the permissions. Returns false when Health Connect is not on this phone or the user says no. */
export async function connectHealth(): Promise<boolean> {
  if (!(await ready())) return false;
  const granted = await requestPermission(PERMISSIONS);
  return granted.some((p) => p.recordType === "Weight");
}

export async function healthConnected(): Promise<boolean> {
  return (await ready()) && (await has("Weight", "read"));
}

/** Imports weigh-ins of the last 60 days that are not on the phone yet. Returns how many. */
export async function importWeights(): Promise<number> {
  if (!(await ready()) || !(await has("Weight", "read"))) return 0;
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { records } = await readRecords("Weight", {
    timeRangeFilter: { operator: "after", startTime: since },
  });
  const known = new Set((await weighIns()).map((w) => w.date));
  let added = 0;
  for (const r of records) {
    const day = r.time.slice(0, 10);
    if (known.has(day)) continue;
    known.add(day);
    await addMetric("weight", Math.round(r.weight.inKilograms * 10) / 10, "health_connect", r.time);
    added++;
  }
  if (added) await applyN1();
  return added;
}

/** Minutes asleep in the night before now, or undefined without data. */
export async function lastNightSleepMin(): Promise<number | undefined> {
  if (!(await ready()) || !(await has("SleepSession", "read"))) return undefined;
  const since = new Date(Date.now() - 18 * 3_600_000).toISOString();
  const { records } = await readRecords("SleepSession", {
    timeRangeFilter: { operator: "after", startTime: since },
  });
  const ms = records.reduce(
    (s, r) => s + (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()),
    0,
  );
  return ms > 0 ? Math.round(ms / 60_000) : undefined;
}

/** Writes a finished session, so other apps can see it. */
export async function writeSession(title: string, startTime: string, endTime: string): Promise<void> {
  if (!(await ready()) || !(await has("ExerciseSession", "write"))) return;
  await insertRecords([
    {
      recordType: "ExerciseSession",
      exerciseType: ExerciseType.STRENGTH_TRAINING,
      title,
      startTime,
      endTime,
    },
  ]);
}
