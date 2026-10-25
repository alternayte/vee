// SPDX-License-Identifier: AGPL-3.0-or-later
// Kit with its real settings (PRD "Onboarding"). No kit at all is a valid answer.
import type { KitItem } from "@vee/engine";
import { uuidv7 } from "@vee/schema";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { num, setDraft, useDraft } from "./draft";
import { Field, Step } from "./step";

type Kind = KitItem["kind"];

const KINDS: { value: Kind; label: string }[] = [
  { value: "dial_db", label: "Dial dumbbell" },
  { value: "fixed_db", label: "Fixed dumbbells" },
  { value: "kettlebell", label: "Kettlebells" },
  { value: "band", label: "Band" },
  { value: "pullup_station", label: "Pull-up station" },
  { value: "bench", label: "Bench" },
  { value: "rings", label: "Rings" },
];

const kindName = (k: Kind) => KINDS.find((x) => x.value === k)?.label ?? k;

export function describeKit(k: KitItem): string {
  const pair = "count" in k && k.count === 2 ? "a pair" : "one";
  switch (k.kind) {
    case "dial_db":
      return `Dial dumbbell, ${pair}: ${k.params.min}–${k.params.max} kg in ${k.params.step} kg steps`;
    case "fixed_db":
    case "kettlebell":
      return `${kindName(k.kind)}, ${pair} of each: ${k.params.weights.join(", ")} kg`;
    case "band":
      return `Band, ${k.params.colour}, about ${k.params.estKg} kg`;
    case "pullup_station":
      return `Pull-up station: ${k.params.grips.join(" and ")} grip${k.params.grips.length > 1 ? "s" : ""}${k.params.dipHandles ? ", dip handles" : ""}`;
    default:
      return kindName(k.kind);
  }
}

const weightsOf = (t: string) =>
  t
    .split(/[ ,;]+/)
    .map((x) => num(x))
    .filter((x): x is number => x !== undefined && x > 0);

function AddForm({ kind, onAdd }: { kind: Kind; onAdd: (k: KitItem) => void }) {
  const [min, setMin] = useState("2");
  const [max, setMax] = useState("24");
  const [step, setStep] = useState("2");
  const [count, setCount] = useState<1 | 2>(1);
  const [weights, setWeights] = useState("");
  const [colour, setColour] = useState("");
  const [estKg, setEstKg] = useState("15");
  const [grips, setGrips] = useState<("straight" | "neutral")[]>(["straight"]);
  const [dip, setDip] = useState(true);

  let item: KitItem | undefined;
  const id = "";
  if (kind === "dial_db") {
    const [a, b, s] = [num(min), num(max), num(step)];
    if (a !== undefined && b !== undefined && s !== undefined && a > 0 && b > a && s > 0)
      item = { id, kind, count, params: { min: a, max: b, step: s } };
  } else if (kind === "fixed_db" || kind === "kettlebell") {
    const w = weightsOf(weights);
    if (w.length > 0) item = { id, kind, count, params: { weights: [...new Set(w)].sort((x, y) => x - y) } };
  } else if (kind === "band") {
    const kg = num(estKg);
    if (colour.trim() && kg !== undefined && kg > 0)
      item = { id, kind, count: 1, params: { colour: colour.trim(), estKg: kg } };
  } else if (kind === "pullup_station") {
    if (grips.length > 0) item = { id, kind, count: 1, params: { grips, dipHandles: dip } };
  } else {
    item = { id, kind, count: 1, params: {} };
  }

  const countChoice = (
    <>
      <Text variant="label">How many</Text>
      <Choice
        options={[
          { value: 1, label: "One" },
          { value: 2, label: "A pair" },
        ]}
        selected={[count]}
        onToggle={(v) => setCount(v as 1 | 2)}
      />
    </>
  );

  return (
    <View className="gap-3 rounded-lg border border-border bg-surface p-4">
      {kind === "dial_db" && (
        <>
          <Field label="Lightest setting" unit="kg" value={min} onChange={setMin} />
          <Field label="Heaviest setting" unit="kg" value={max} onChange={setMax} />
          <Field label="Step" unit="kg" value={step} onChange={setStep} />
          {countChoice}
        </>
      )}
      {(kind === "fixed_db" || kind === "kettlebell") && (
        <>
          <Field label="Weights, separated by commas" unit="kg" value={weights} onChange={setWeights} />
          {countChoice}
        </>
      )}
      {kind === "band" && (
        <>
          <Text variant="label">Colour</Text>
          <Input accessibilityLabel="Colour" value={colour} onChangeText={setColour} />
          <Field label="Approximate resistance" unit="kg" value={estKg} onChange={setEstKg} />
        </>
      )}
      {kind === "pullup_station" && (
        <>
          <Text variant="label">Grips</Text>
          <Choice
            options={[
              { value: "straight", label: "Straight bar" },
              { value: "neutral", label: "Neutral grips" },
            ]}
            selected={grips}
            onToggle={(g) => setGrips((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))}
          />
          <Choice
            options={[{ value: "dip", label: "Dip handles" }]}
            selected={dip ? ["dip"] : []}
            onToggle={() => setDip(!dip)}
          />
        </>
      )}
      <Button
        label={`Add ${kindName(kind).toLowerCase()}`}
        disabled={!item}
        className={item ? "" : "opacity-40"}
        onPress={() => item && onAdd(item)}
      />
    </View>
  );
}

export function KitScreen() {
  const kit = useDraft((s) => s.kit);
  const [kind, setKind] = useState<Kind>();

  return (
    <Step
      step="kit"
      title="Your kit"
      intro="Add each item with its real settings. The plan uses only what you have. No kit is fine: bodyweight work still gives a full plan."
      nextLabel={kit.length === 0 ? "I have no kit" : "Next"}
      next={() => router.push("/welcome/time")}
    >
      {kit.map((k, n) => (
        <View
          key={k.id}
          className="flex-row items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <Text className="flex-1">{describeKit(k)}</Text>
          <Button
            label="Remove"
            variant="ghost"
            onPress={() => setDraft({ kit: kit.filter((_, i) => i !== n) })}
          />
        </View>
      ))}
      <Text variant="label">Add an item</Text>
      <Choice
        options={KINDS}
        selected={kind ? [kind] : []}
        onToggle={(k) => setKind(k === kind ? undefined : k)}
      />
      {kind && (
        <AddForm
          key={kind}
          kind={kind}
          onAdd={(item) => {
            setDraft({ kit: [...kit, { ...item, id: uuidv7() }] });
            setKind(undefined);
          }}
        />
      )}
    </Step>
  );
}
