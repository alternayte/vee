// SPDX-License-Identifier: AGPL-3.0-or-later
// The meal library shows only meals that pass every check (I7).
import { checkMeal, type Meal, portionsPerServing, WEEKNIGHT_MAX_MIN } from "@vee/nutrition";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { aiPost } from "@/features/ai/client";
import { addMeal, ingredients, loadRules, refreshLibrary } from "./data";

export function useAllowedMeals(version = 0): Meal[] | undefined {
  const [allowed, setAllowed] = useState<Meal[] | undefined>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new version reloads the library after a meal is added
  useEffect(() => {
    void Promise.all([loadRules(), refreshLibrary()]).then(([{ exclusions, household }, library]) => {
      setAllowed(
        library.filter((m) => {
          const slot = m.minutes <= WEEKNIGHT_MAX_MIN || m.noCook ? "weeknight" : "weekend";
          return checkMeal(m, ingredients(), exclusions, household, { slot }).status === "pass";
        }),
      );
    });
  }, [version]);
  return allowed;
}

export function MealRow({ meal, right }: { meal: Meal; right?: React.ReactNode }) {
  const palm = portionsPerServing(meal, ingredients()).palm;
  const tag = meal.noCook ? "No cooking" : meal.minutes <= WEEKNIGHT_MAX_MIN ? "Weeknight" : "Weekend";
  return (
    <View className="flex-row items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <View className="flex-1 gap-1">
        <Text>{meal.name}</Text>
        <Text variant="label">
          {meal.minutes} min · {tag} · {palm.toFixed(1)} palms protein
        </Text>
      </View>
      {right}
    </View>
  );
}

/** Asks the AI for a dinner. The phone checks the draft again (I7) before the user can add it. */
function DraftMeal({ onAdded }: { onAdded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Meal>();
  const [message, setMessage] = useState<string>();
  const nameOf = (id: string) => ingredients().find((i) => i.id === id)?.name ?? id;

  return (
    <View className="gap-3 rounded-lg border border-border bg-surface p-4">
      <Text variant="label">New ideas</Text>
      {!draft && (
        <Button
          label={busy ? "Drafting…" : "Draft a new meal"}
          variant="secondary"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setMessage(undefined);
            const r = await aiPost<Meal>("/ai/meal-draft", {});
            if (!r.ok) setMessage(r.message);
            else {
              const { exclusions, household } = await loadRules();
              const self = household.find((m) => m.isSelf)?.id ?? "self";
              // The library is lactose-free for the user, so a draft must be too.
              if (!exclusions.some((x) => x.memberId === self && x.kind === "lactose"))
                exclusions.push({ memberId: self, kind: "lactose" });
              const slot = r.value.minutes <= WEEKNIGHT_MAX_MIN || r.value.noCook ? "weeknight" : "weekend";
              const check = checkMeal(r.value, ingredients(), exclusions, household, { slot });
              if (check.status === "pass") setDraft(r.value);
              else setMessage(check.violations.map((v) => v.reason.text).join(" "));
            }
            setBusy(false);
          }}
        />
      )}
      {message && <Text variant="muted">{message}</Text>}
      {draft && (
        <View className="gap-2" testID="meal-draft">
          <MealRow meal={draft} />
          {draft.ingredients.map((i) => (
            <Text key={`${i.ingredientId}-${i.role}`} variant="muted">
              {nameOf(i.ingredientId)}: {i.qty} {i.unit === "piece" ? "" : i.unit}
            </Text>
          ))}
          {draft.steps.map((step, n) => (
            <Text key={step}>
              {n + 1}. {step}
            </Text>
          ))}
          <View className="flex-row gap-2">
            <Button
              label="Add to library"
              onPress={async () => {
                await addMeal(draft);
                setDraft(undefined);
                onAdded();
              }}
            />
            <Button label="Discard" variant="ghost" onPress={() => setDraft(undefined)} />
          </View>
        </View>
      )}
    </View>
  );
}

export function LibraryScreen() {
  const [version, setVersion] = useState(0);
  const allowed = useAllowedMeals(version);
  return (
    <Screen title="Meals">
      <Text variant="muted">
        Every meal here is lactose-free, fits your rules and has at least 1 palm of protein.
      </Text>
      <DraftMeal onAdded={() => setVersion((v) => v + 1)} />
      {allowed?.map((m) => (
        <Link key={m.id} href={{ pathname: "/food/meal/[id]", params: { id: m.id } }} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel={m.name}>
            <MealRow meal={m} />
          </Pressable>
        </Link>
      ))}
    </Screen>
  );
}
