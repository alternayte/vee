// SPDX-License-Identifier: AGPL-3.0-or-later
// Joints that hurt now. A flag removes or swaps movements.
import { JOINTS, type Joint, type Severity } from "@vee/catalogue";
import { router } from "expo-router";
import { View } from "react-native";
import { Choice } from "@/components/ui/choice";
import { Text } from "@/components/ui/text";
import { setDraft, useDraft } from "./draft";
import { Step } from "./step";

const JOINT_NAMES: Record<Joint, string> = {
  shoulder: "Shoulder",
  elbow: "Elbow",
  wrist: "Wrist",
  knee: "Knee",
  "lower-back": "Lower back",
};

export function FlagsScreen() {
  const flags = useDraft((s) => s.flags);
  const severity = (j: Joint) => flags.find((f) => f.joint === j)?.severity;
  const toggle = (j: Joint) =>
    setDraft({
      flags: severity(j) ? flags.filter((f) => f.joint !== j) : [...flags, { joint: j, severity: "mild" }],
    });
  const setSeverity = (j: Joint, s: Severity) =>
    setDraft({ flags: flags.map((f) => (f.joint === j ? { ...f, severity: s } : f)) });

  return (
    <Step
      step="flags"
      title="Joints that hurt"
      intro="Mark a joint only if it hurts now. The plan removes or swaps movements that load it."
      nextLabel={flags.length === 0 ? "Nothing hurts" : "Next"}
      next={() => router.push("/welcome/baseline")}
    >
      <Choice
        options={JOINTS.map((j) => ({ value: j, label: JOINT_NAMES[j] }))}
        selected={flags.map((f) => f.joint)}
        onToggle={toggle}
      />
      {flags.map((f) => (
        <View key={f.joint} className="gap-2">
          <Text variant="label">{JOINT_NAMES[f.joint]}: how bad?</Text>
          <Choice
            options={[
              { value: "mild", label: "Some pain" },
              { value: "acute", label: "Sharp or new pain" },
            ]}
            selected={[f.severity]}
            onToggle={(s) => setSeverity(f.joint, s)}
          />
        </View>
      ))}
      {flags.length > 0 && (
        <Text variant="muted">If the pain does not go away, see a physiotherapist or a doctor.</Text>
      )}
    </Step>
  );
}
