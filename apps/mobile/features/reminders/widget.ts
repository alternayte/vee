// SPDX-License-Identifier: AGPL-3.0-or-later
// The home widget's snapshot: the next session, its minutes, and the 4-week
// consistency. Written with the reminders, after each session change.
import { consistency, nextSession } from "@vee/engine";
import { readEngineInput } from "@/features/training/data";
import { setWidget } from "@/modules/vee-widget";

export async function updateWidget(): Promise<void> {
  const input = await readEngineInput();
  if (!input?.programme) return;
  const { template } = nextSession(input);
  const last = consistency(input, 1)[0];
  setWidget({
    title: `${template.dayType} · ${template.name}`,
    minutes: `About ${template.estimatedMinutes} min`,
    consistency: last ? `${last.done} of ${last.planned} sessions in 4 weeks` : "",
  });
}
