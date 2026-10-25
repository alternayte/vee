// SPDX-License-Identifier: AGPL-3.0-or-later
// The coach web app (SDD "Coach web app"). In development the API runs on
// VEE_API (default localhost:3000) behind this proxy, so the session cookie
// is same-origin. In production VITE_API_URL names the API origin.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.VEE_API ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": api, "/coach": api, "/admin": api },
  },
});
