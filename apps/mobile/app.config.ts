// SPDX-License-Identifier: AGPL-3.0-or-later
// Adds what depends on the server address to app.json: the App Link for the
// sign-in link, and plain HTTP for a test server on the local network.
import type { ConfigContext, ExpoConfig } from "expo/config";
import { withAndroidManifest } from "expo/config-plugins";

export default ({ config }: ConfigContext): ExpoConfig => {
  const api = process.env.EXPO_PUBLIC_API_URL ? new URL(process.env.EXPO_PUBLIC_API_URL) : undefined;
  const base = config as ExpoConfig;
  const withLink: ExpoConfig = {
    ...base,
    android: {
      ...base.android,
      intentFilters:
        api?.protocol === "https:"
          ? [
              {
                action: "VIEW",
                autoVerify: true,
                data: [{ scheme: "https", host: api.hostname, pathPrefix: "/app/auth/magic" }],
                category: ["BROWSABLE", "DEFAULT"],
              },
            ]
          : [],
    },
  };
  if (api?.protocol !== "http:") return withLink;
  return withAndroidManifest(withLink, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) app.$["android:usesCleartextTraffic"] = "true";
    return c;
  });
};
