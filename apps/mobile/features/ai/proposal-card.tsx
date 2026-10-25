// SPDX-License-Identifier: AGPL-3.0-or-later
// A proposed plan change from a review, the coach chat or an MCP client. It
// changes nothing until the user accepts it, and the engine checks it again
// on the phone first, against the plan as it is now (I4).
import { type PlanChange, type Reason, validateProposal } from "@vee/engine";
import { ai_proposals } from "@vee/schema";
import { eq } from "drizzle-orm";
import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { db } from "@/features/db/database";
import { catalogue } from "@/features/training/catalogue";
import { readEngineInput, readProgramme, saveProgramme } from "@/features/training/data";

/** As stored in `ai_proposals.change`: the change, its reason, and the review week for review cards. */
export type StoredChange = PlanChange & { why: string; week?: string };

const exerciseName = (id: string) => catalogue.exercises.find((e) => e.id === id)?.names.en ?? id;

function describeChange(c: StoredChange): string {
  if (c.kind === "deload") return "Start a deload week now";
  if (c.kind === "sets") return `Day ${c.dayType}: ${exerciseName(c.exerciseId)} to ${c.sets} sets`;
  return `Day ${c.dayType}: change to ${exerciseName(c.to)}`;
}

export function ProposalCard({
  id,
  change,
  reasons,
}: {
  id: string;
  change: StoredChange;
  reasons: Reason[];
}) {
  const [message, setMessage] = useState<string>();
  const setStatus = (status: string) =>
    db
      .update(ai_proposals)
      .set({ status, updated_at: new Date().toISOString() })
      .where(eq(ai_proposals.id, id));
  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-4" testID="proposal">
      <Text variant="heading">{describeChange(change)}</Text>
      <Text>{change.why}</Text>
      {reasons.map((r) => (
        <Text key={r.text} variant="muted">
          {r.text}
        </Text>
      ))}
      {message && <Text>{message}</Text>}
      <View className="flex-row gap-2">
        <Button
          label="Accept"
          onPress={async () => {
            const input = await readEngineInput();
            const current = await readProgramme();
            if (!input?.programme || !current) return;
            const { why: _w, week: _k, ...plain } = change;
            const v = validateProposal(input, plain as PlanChange);
            if (!v.ok) {
              // The plan changed since the proposal: the engine refuses it now.
              setMessage(v.reason.text);
              await setStatus("refused");
              return;
            }
            await saveProgramme({ ...v.programme, id: current.id });
            await setStatus("accepted");
          }}
        />
        <Button label="Reject" variant="ghost" onPress={() => void setStatus("rejected")} />
      </View>
    </View>
  );
}
