// SPDX-License-Identifier: AGPL-3.0-or-later
// The home widget's data (Android only). The widget shows the three lines.
import { requireOptionalNativeModule } from "expo";

export type WidgetSnapshot = { title: string; minutes: string; consistency: string };

const native = requireOptionalNativeModule<{ setSnapshot(json: string): void }>("VeeWidget");

export const setWidget = (s: WidgetSnapshot) => native?.setSnapshot(JSON.stringify(s));
