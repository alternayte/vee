// SPDX-License-Identifier: AGPL-3.0-or-later
// "Tell me more" on a reason: the engine's short text stays; the AI expands it.
import type { Reason } from "@vee/engine";
import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { aiPost } from "./client";

export function TellMeMore({ reasons }: { reasons: Reason[] }) {
  const [text, setText] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (reasons.length === 0) return null;
  if (text) {
    return (
      <View className="rounded-md bg-surface-raised p-3">
        <Text testID="tell-me-more-text">{text}</Text>
      </View>
    );
  }
  return (
    <Button
      label={busy ? "Asking…" : "Tell me more"}
      variant="ghost"
      disabled={busy}
      className="self-start px-0"
      onPress={async () => {
        setBusy(true);
        const r = await aiPost<{ text: string }>("/ai/explain-more", {
          reasons: reasons.map((x) => ({ ruleId: x.ruleId, inputs: x.inputs, text: x.text })),
        });
        setText(r.ok ? r.value.text : r.message);
        setBusy(false);
      }}
    />
  );
}
