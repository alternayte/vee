// SPDX-License-Identifier: AGPL-3.0-or-later
// The meal library shows only meals that pass every check (I7).
import { checkMeal, type Meal, portionsPerServing, WEEKNIGHT_MAX_MIN } from "@vee/nutrition";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Screen } from "@/components/screen";
import { Text } from "@/components/ui/text";
import { ingredients, libraryMeals, loadRules } from "./data";

export function useAllowedMeals(): Meal[] | undefined {
  const [allowed, setAllowed] = useState<Meal[] | undefined>();
  useEffect(() => {
    void loadRules().then(({ exclusions, household }) => {
      setAllowed(
        libraryMeals().filter((m) => {
          const slot = m.minutes <= WEEKNIGHT_MAX_MIN || m.noCook ? "weeknight" : "weekend";
          return checkMeal(m, ingredients(), exclusions, household, { slot }).status === "pass";
        }),
      );
    });
  }, []);
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

export function LibraryScreen() {
  const allowed = useAllowedMeals();
  return (
    <Screen title="Meals">
      <Text variant="muted">
        Every meal here is lactose-free, fits your rules and has at least 1 palm of protein.
      </Text>
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
