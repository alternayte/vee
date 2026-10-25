// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes theme.css (mobile, Uniwind) and web.css (coach web app) from the tokens.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { themeCss, webThemeCss } from "../src";

writeFileSync(join(import.meta.dirname, "..", "theme.css"), themeCss());
writeFileSync(join(import.meta.dirname, "..", "web.css"), webThemeCss());
