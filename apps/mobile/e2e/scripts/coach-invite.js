// SPDX-License-Identifier: AGPL-3.0-or-later
// A coach and an invite code from the test API (MAIL_TRANSPORT=memory).
const r = http.post("http://localhost:3998/dev/coach-invite", {
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: COACH }),
});
output.code = json(r.body).code;
