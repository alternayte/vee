// SPDX-License-Identifier: AGPL-3.0-or-later
// The client side of coaching (SDD "Coach access"): accept an invite with
// scopes, change scopes and auto-apply, revoke. The server makes the link from
// the invite; every later change is a local write that syncs (the server
// accepts only these columns from the client).
import { coach_links } from "@vee/schema";
import { eq } from "drizzle-orm";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { useAccount } from "@/features/account/account";
import { API_URL, HAS_SERVER } from "@/features/account/config";
import { db } from "@/features/db/database";

export const SCOPES = [
  { value: "training", label: "Training" },
  { value: "food", label: "Food" },
  { value: "body", label: "Body" },
  { value: "photos", label: "Photos" },
] as const;
export type Scope = (typeof SCOPES)[number]["value"];

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

async function call<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  if (!HAS_SERVER) return { ok: false, message: "This build has no server, so coaching is off." };
  const token = useAccount.getState().session?.token;
  if (!token) return { ok: false, message: "A coach connection needs an account. Sign in first." };
  let r: Response;
  try {
    r = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
  } catch {
    return { ok: false, message: "This needs a connection." };
  }
  const json = (await r.json().catch(() => ({}))) as T & { message?: string };
  return r.ok
    ? { ok: true, value: json }
    : { ok: false, message: json.message ?? "Vee cannot do this now. Try again." };
}

export const previewInvite = (code: string) =>
  call<{ coachName: string }>(`/coach-links/invite/${encodeURIComponent(code.trim())}`);

export async function acceptInvite(code: string, scopes: Scope[]) {
  const r = await call<{ linkId: string; coachName: string }>("/coach-links/accept", {
    method: "POST",
    body: JSON.stringify({ code: code.trim(), scopes }),
  });
  if (r.ok) void registerPush();
  return r;
}

const touch = () => new Date().toISOString();

export const setScopes = async (linkId: string, scopes: Scope[]) =>
  await db
    .update(coach_links)
    .set({ scopes: JSON.stringify(scopes), updated_at: touch() })
    .where(eq(coach_links.id, linkId));

export const setAutoApply = async (linkId: string, on: boolean) =>
  await db
    .update(coach_links)
    .set({ auto_apply: on ? 1 : 0, updated_at: touch() })
    .where(eq(coach_links.id, linkId));

export const revoke = async (linkId: string) =>
  await db
    .update(coach_links)
    .set({ status: "revoked", updated_at: touch() })
    .where(eq(coach_links.id, linkId));

/**
 * Registers this phone for coach pushes. It needs the notification permission
 * and an APK built with google-services.json; without them it does nothing,
 * and messages show when the app opens and syncs.
 */
export async function registerPush(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("coach", {
      name: "Coach",
      importance: Notifications.AndroidImportance.HIGH,
    });
    const { granted } = await Notifications.requestPermissionsAsync();
    if (!granted) return;
    const { data } = await Notifications.getDevicePushTokenAsync();
    await call("/push/token", { method: "POST", body: JSON.stringify({ token: String(data) }) });
  } catch {
    // No Firebase config in this build: push stays off.
  }
}
