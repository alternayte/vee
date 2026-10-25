// SPDX-License-Identifier: AGPL-3.0-or-later
// Today and Plan read the stored programme. The session runner (B08) and the
// full Today and Plan screens (B09) build on these.
import { type EngineInput, nextSession, type Reason, type TemplateItem } from "@vee/engine";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { Screen } from "@/components/screen";
import { Text } from "@/components/ui/text";
import { catalogue } from "./catalogue";
import { readEngineInput } from "./data";

function useEngineInput(): EngineInput | undefined {
  const [input, setInput] = useState<EngineInput>();
  useFocusEffect(
    useCallback(() => {
      void readEngineInput().then(setInput);
    }, []),
  );
  return input;
}

const exerciseName = (id: string) => catalogue.exercises.find((e) => e.id === id)?.names.en ?? id;

export function describeItem(i: TemplateItem): string {
  const target = i.target.low === i.target.high ? `${i.target.low}` : `${i.target.low}–${i.target.high}`;
  const unit = i.target.unit === "seconds" ? "s" : "reps";
  const load = i.loadKg === undefined ? "" : ` at ${i.loadKg} kg`;
  return `${i.sets} × ${target} ${unit}${load}`;
}

function ItemRow({ item }: { item: TemplateItem }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="flex-1">{exerciseName(item.exerciseId)}</Text>
      <Text variant="label">{describeItem(item)}</Text>
    </View>
  );
}

function Why({ reason }: { reason: Reason }) {
  return <Text variant="muted">{reason.text}</Text>;
}

export function TodayScreen() {
  const input = useEngineInput();
  if (!input?.programme) return <Screen title="Today">{null}</Screen>;
  const next = nextSession(input);
  return (
    <Screen title="Today">
      <View className="gap-3 rounded-lg border border-border bg-surface p-4">
        <Text variant="label">Next session</Text>
        <Text variant="heading" testID="next-session">
          {next.template.dayType} · {next.template.name}
        </Text>
        <Text variant="label">About {next.template.estimatedMinutes} min</Text>
        <Why reason={next.reason} />
        {next.template.items.map((i) => (
          <ItemRow key={`${i.order}-${i.exerciseId}`} item={i} />
        ))}
      </View>
    </Screen>
  );
}

export function PlanScreen() {
  const input = useEngineInput();
  const p = input?.programme;
  return (
    <Screen title="Plan">
      {p && (
        <Text variant="muted">
          Block week {p.blockWeek}. The rotation runs {p.rotation.join(" → ")}.
        </Text>
      )}
      {p?.templates.map((t) => (
        <View key={t.dayType} className="gap-3 rounded-lg border border-border bg-surface p-4">
          <Text variant="heading">
            {t.dayType} · {t.name}
          </Text>
          <Text variant="label">About {t.estimatedMinutes} min</Text>
          {t.items.map((i) => (
            <ItemRow key={`${i.order}-${i.exerciseId}`} item={i} />
          ))}
          {t.reasons.map((r) => (
            <Why key={`${r.ruleId}-${r.text}`} reason={r} />
          ))}
        </View>
      ))}
    </Screen>
  );
}
