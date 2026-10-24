// SPDX-License-Identifier: AGPL-3.0-or-later
// Weekly plan: pick 5 to 7 dinners, then build one shopping list.
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import { meal_plans } from "@vee/schema";
import { and, eq, isNull } from "drizzle-orm";
import { router } from "expo-router";
import { Pressable } from "react-native";
import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { db } from "@/features/db/database";
import { buildShopping, planIds, setPlan, thisWeek } from "./data";
import { MealRow, useAllowedMeals } from "./library-screen";

export const PLAN_MIN = 5;
export const PLAN_MAX = 7;

export function PlanScreen() {
  const week = thisWeek();
  const allowed = useAllowedMeals();
  const { data: rows } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(meal_plans)
        .where(and(eq(meal_plans.week, week), isNull(meal_plans.deleted_at)))
        .limit(1),
    ),
  );
  const picked = planIds(rows[0]?.meal_ids);

  const toggle = (id: string) => {
    if (picked.includes(id))
      void setPlan(
        week,
        picked.filter((x) => x !== id),
      );
    else if (picked.length < PLAN_MAX) void setPlan(week, [...picked, id]);
  };

  const ready = picked.length >= PLAN_MIN;
  return (
    <Screen title="Week plan">
      <Text testID="plan-count">
        {picked.length} of {PLAN_MIN} to {PLAN_MAX} dinners picked for week {week.slice(6)}.
      </Text>
      <Button
        label="Build the shopping list"
        disabled={!ready}
        className={ready ? "" : "opacity-50"}
        onPress={() => {
          void buildShopping(week).then(() => router.push("/food/shopping"));
        }}
      />
      {allowed?.map((m) => {
        const on = picked.includes(m.id);
        return (
          <Pressable
            key={m.id}
            accessibilityRole="checkbox"
            accessibilityLabel={m.name}
            accessibilityState={{ checked: on }}
            onPress={() => toggle(m.id)}
          >
            <MealRow
              meal={m}
              right={<Text className={on ? "text-good" : "text-text-muted"}>{on ? "In plan" : "Add"}</Text>}
            />
          </Pressable>
        );
      })}
    </Screen>
  );
}
