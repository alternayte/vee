// SPDX-License-Identifier: AGPL-3.0-or-later
// The exercise catalogue ships in the bundle (`just catalogue` builds it).
import type { Catalogue } from "@vee/catalogue";
import built from "@vee/catalogue/catalogue.v1.json";

export const catalogue = built as Catalogue;
