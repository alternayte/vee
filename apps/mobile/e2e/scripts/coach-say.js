// SPDX-License-Identifier: AGPL-3.0-or-later
// The coach writes a message and proposes one set fewer (test API).
http.post("http://localhost:3998/dev/coach-say", {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ coach: COACH, client: EMAIL, body: "How did day A go?", fewerSets: true }),
});
