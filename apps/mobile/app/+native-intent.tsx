// SPDX-License-Identifier: AGPL-3.0-or-later
// The App Link for sign-in is https://<API host>/app/auth/magic?token=…; the
// app route is /auth/magic.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return path.replace(/^(https?:\/\/[^/]+)?\/app\/auth\/magic/, "/auth/magic");
}
