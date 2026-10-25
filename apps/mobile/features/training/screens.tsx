// SPDX-License-Identifier: AGPL-3.0-or-later
// Today and Plan read the stored programme. Today starts the session runner,
// or resumes it after a crash; the full Plan screen (B09) builds on these.
import type { Joint, Severity } from "@vee/catalogue";
import {
  type EngineInput,
  nextSession,
  type PrescribedItem,
  type Prescription,
  prescribe,
  type Reason,
  type SessionTemplate,
  type TemplateItem,
} from "@vee/engine";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { aiPost } from "@/features/ai/client";
import { TellMeMore } from "@/features/ai/tell-me-more";
import { localDate } from "@/features/food/data";
import { scheduleAll } from "@/features/reminders/schedule";
import { useTodayAdjust } from "@/features/session/adjust";
import { activeSessionId, skipNext } from "@/features/session/data";
import { catalogue } from "./catalogue";
import { addTodayFlags, readEngineInput } from "./data";

export function useEngineInput(): EngineInput | undefined {
  const [input, setInput] = useState<EngineInput>();
  useFocusEffect(
    useCallback(() => {
      void readEngineInput().then(setInput);
    }, []),
  );
  return input;
}

const exerciseName = (id: string) => catalogue.exercises.find((e) => e.id === id)?.names.en ?? id;

export function describeItem(i: TemplateItem | PrescribedItem): string {
  const target = i.target.low === i.target.high ? `${i.target.low}` : `${i.target.low}–${i.target.high}`;
  const unit = i.target.unit === "seconds" ? "s" : "reps";
  const load = i.loadKg === undefined ? "" : ` at ${i.loadKg} kg`;
  return `${i.sets} × ${target} ${unit}${load}`;
}

function ItemRow({ item }: { item: TemplateItem | PrescribedItem }) {
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

type Adjustment = {
  minutes?: number;
  flags?: { joint: Joint; severity: Severity }[];
  focus?: string[];
  note?: string;
};

function describeAdjustment(a: Adjustment): string[] {
  const out: string[] = [];
  if (a.minutes !== undefined) out.push(`${a.minutes} min today`);
  for (const f of a.flags ?? [])
    out.push(
      `${f.joint.replace("-", " ")}: ${f.severity === "acute" ? "sharp pain" : "some pain"}, today only`,
    );
  if (a.focus?.length) out.push(`Keep first: ${a.focus.join(", ")}`);
  if (a.note) out.push(a.note);
  return out;
}

function AdjustToday({ template, onApply }: { template: SessionTemplate; onApply: (a: Adjustment) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Adjustment>();
  const [message, setMessage] = useState<string>();
  const lines = proposal ? describeAdjustment(proposal) : [];
  return (
    <View className="gap-3 rounded-lg border border-border bg-surface p-4">
      <Text variant="label">Anything different today?</Text>
      <Input
        testID="adjust-input"
        value={text}
        onChangeText={setText}
        placeholder="Only 20 min, or: my left shoulder is sore"
        maxLength={300}
      />
      <Button
        label={busy ? "Asking…" : "Adjust today"}
        variant="secondary"
        disabled={busy || text.trim() === ""}
        onPress={async () => {
          setBusy(true);
          setMessage(undefined);
          setProposal(undefined);
          const r = await aiPost<Adjustment>("/ai/adjust-today", { text: text.trim(), template });
          if (r.ok) setProposal(r.value);
          else setMessage(r.message);
          setBusy(false);
        }}
      />
      {message && <Text variant="muted">{message}</Text>}
      {proposal && lines.length === 0 && <Text variant="muted">Nothing to change from that text.</Text>}
      {proposal && lines.length > 0 && (
        <View className="gap-2">
          {lines.map((l) => (
            <Text key={l}>{l}</Text>
          ))}
          <View className="flex-row gap-2">
            <Button
              label="Use this"
              onPress={() => {
                onApply(proposal);
                setProposal(undefined);
                setText("");
              }}
            />
            <Button label="Ignore" variant="ghost" onPress={() => setProposal(undefined)} />
          </View>
        </View>
      )}
    </View>
  );
}

/** "I only have 20 min" without AI (PRD "Time cut"); 0 is the full session. */
const TIME_OPTIONS = [
  { value: 0, label: "Full" },
  { value: 30, label: "30 min" },
  { value: 20, label: "20 min" },
  { value: 15, label: "15 min" },
];

export function TodayScreen() {
  const input = useEngineInput();
  const [adjusted, setAdjusted] = useState<Prescription>();
  const [active, setActive] = useState<string>();
  const [skipped, setSkipped] = useState(false);
  const [minutes, setMinutes] = useState(0);
  useFocusEffect(
    useCallback(() => {
      void activeSessionId().then(setActive);
    }, []),
  );
  if (!input?.programme) return <Screen title="Today">{null}</Screen>;
  const next = nextSession(input);

  async function apply(a: Adjustment) {
    if (!input) return;
    const today = localDate();
    if (a.flags?.length) await addTodayFlags(a.flags, today);
    useTodayAdjust.getState().set({
      ...(a.minutes !== undefined ? { minutes: a.minutes } : {}),
      ...(a.focus?.length ? { focus: a.focus } : {}),
    });
    const flags = [
      ...input.flags,
      ...(a.flags ?? []).map((f) => ({ ...f, activeFrom: today, activeTo: today })),
    ];
    setAdjusted(
      prescribe({ ...input, flags }, next.template, {
        readiness: "full",
        ...(a.minutes !== undefined ? { minutes: a.minutes } : {}),
        ...(a.focus?.length ? { focus: a.focus } : {}),
      }),
    );
  }

  const items = adjusted?.items ?? next.template.items;
  return (
    <Screen title="Today">
      <View className="gap-2">
        <Text variant="label">Time today</Text>
        <Choice
          options={TIME_OPTIONS}
          selected={[minutes]}
          onToggle={(m) => {
            setMinutes(m);
            void apply(m ? { minutes: m } : {});
          }}
        />
        {minutes > 0 && (
          <Text variant="muted">Accessories go first, then sets. The main movement stays.</Text>
        )}
      </View>
      <View className="gap-3 rounded-lg border border-border bg-surface p-4">
        <Text variant="label">Next session</Text>
        <Text variant="heading" testID="next-session">
          {next.template.dayType} · {next.template.name}
        </Text>
        <Text variant="label" testID="next-minutes">
          About {adjusted?.estimatedMinutes ?? next.template.estimatedMinutes} min
        </Text>
        <Why reason={next.reason} />
        <TellMeMore reasons={[next.reason]} />
        {items.map((i) => (
          <ItemRow key={`${i.order}-${i.exerciseId}`} item={i} />
        ))}
        {adjusted?.reasons.map((r) => (
          <Why key={`${r.ruleId}-${r.text}`} reason={r} />
        ))}
        {active ? (
          <Button
            label="Resume the session"
            onPress={() => router.push({ pathname: "/session/[id]", params: { id: active } })}
            testID="session-resume"
          />
        ) : (
          <Button
            label="Start the session"
            onPress={() => router.push("/session/start")}
            testID="session-start"
          />
        )}
        {!active && !skipped && (
          <Button
            label="Skip today"
            variant="ghost"
            onPress={async () => {
              await skipNext();
              setSkipped(true);
              void scheduleAll();
            }}
          />
        )}
        {skipped && <Text variant="muted">Skipped. This session stays next, with no penalty.</Text>}
      </View>
      <AdjustToday template={next.template} onApply={(a) => void apply(a)} />
    </Screen>
  );
}
