// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes theme.css from the tokens.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { themeCss } from "../src";

writeFileSync(join(import.meta.dirname, "..", "theme.css"), themeCss());
