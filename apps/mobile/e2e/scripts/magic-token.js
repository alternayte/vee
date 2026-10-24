// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads the latest sign-in token from the test API (MAIL_TRANSPORT=memory).
const r = http.get(`http://localhost:3998/dev/mail/latest?to=${encodeURIComponent(EMAIL)}`);
output.token = json(r.body).token;
