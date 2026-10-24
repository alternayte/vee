// SPDX-License-Identifier: AGPL-3.0-or-later
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import { portionsPerServing } from "@vee/nutrition";
import { meals } from "@vee/schema";
import { eq } from "drizzle-orm";
import { useLocalSearchParams } from "expo-router";
import { Pressable, View } from "react-native";
import { EmptyState, Screen } from "@/components/screen";
import { Text } from "@/components/ui/text";
import { db } from "@/features/db/database";
import { ingredients, mealById, rateMeal } from "./data";
import { PORTION_LABEL } from "./portion-ui";

export function MealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const meal = id ? mealById(id) : undefined;
  const { data: rows } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(meals)
        .where(eq(meals.id, id ?? "")),
    ),
  );
  if (!meal) {
    return (
      <Screen title="Meal">
        <EmptyState text="This meal is not in your library." />
      </Screen>
    );
  }
  const rating = rows[0]?.rating ?? 0;
  const per = portionsPerServing(meal, ingredients());
  const nameOf = (i: string) => ingredients().find((x) => x.id === i)?.name ?? i;

  return (
    <Screen title={meal.name}>
      <Text variant="label">
        {meal.minutes} min · {meal.servings} servings · lactose-free
      </Text>
      <View className="gap-1 rounded-lg border border-border bg-surface p-4">
        <Text variant="heading">One serving</Text>
        {(Object.keys(per) as (keyof typeof per)[]).map((p) => (
          <Text key={p}>
            {PORTION_LABEL[p].name}: {per[p].toFixed(1)} {PORTION_LABEL[p].units}
          </Text>
        ))}
      </View>
      <View className="gap-1">
        <Text variant="heading">Ingredients</Text>
        {meal.ingredients.map((mi) => (
          <Text key={`${mi.ingredientId}-${mi.role}`}>
            {nameOf(mi.ingredientId)}: {mi.qty} {mi.unit === "piece" ? "" : mi.unit}
            {mi.role === "plate_extra" ? " (extra on your plate)" : ""}
          </Text>
        ))}
      </View>
      <View className="gap-2">
        <Text variant="heading">Steps</Text>
        {meal.steps.map((s, i) => (
          <Text key={s}>
            {i + 1}. {s}
          </Text>
        ))}
      </View>
      <View className="gap-2">
        <Text variant="heading">Your rating</Text>
        <View className="flex-row gap-2" accessibilityRole="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityLabel={`${n} of 5`}
              accessibilityState={{ selected: n === rating }}
              onPress={() => void rateMeal(meal.id, n)}
              className={
                n <= rating
                  ? "h-12 w-12 items-center justify-center rounded-md bg-accent"
                  : "h-12 w-12 items-center justify-center rounded-md border border-border bg-surface"
              }
            >
              <Text className={n <= rating ? "text-accent-text" : "text-text"}>{n}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Screen>
  );
}
