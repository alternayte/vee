// SPDX-License-Identifier: AGPL-3.0-or-later
// Server addresses, set at build time. A build without them works with no
// account only (I10).
const trim = (v: string | undefined) => (v ?? "").replace(/\/+$/, "");

export const API_URL = trim(process.env.EXPO_PUBLIC_API_URL);
export const POWERSYNC_URL = trim(process.env.EXPO_PUBLIC_POWERSYNC_URL);
export const HAS_SERVER = API_URL !== "" && POWERSYNC_URL !== "";
