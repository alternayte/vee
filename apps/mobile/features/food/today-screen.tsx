// SPDX-License-Identifier: AGPL-3.0-or-later
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import { dailyTotal, MOMENTS, type Moment, PORTIONS, sumPortions } from "@vee/nutrition";
import { SEED_SAVED_MEALS } from "@vee/nutrition/seed";
import { food_logs, food_targets } from "@vee/schema";
import { and, eq, isNull } from "drizzle-orm";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { db } from "@/features/db/database";
import {
  ensureTargets,
  localDate,
  logPortion,
  logSavedMeal,
  momentAt,
  readTargets,
  undoLastLog,
} from "./data";
import { PortionBar, PortionButton } from "./portion-ui";

const MOMENT_NAME: Record<Moment, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export function FoodTodayScreen() {
  const date = localDate();
  const [moment, setMoment] = useState<Moment>(momentAt());

  useEffect(() => {
    void ensureTargets();
  }, []);

  const { data: targetRows } = useQuery(
    toCompilableQuery(db.select().from(food_targets).where(isNull(food_targets.deleted_at)).limit(1)),
  );
  const { data: logs } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(food_logs)
        .where(and(eq(food_logs.date, date), isNull(food_logs.deleted_at))),
    ),
  );

  const targets = readTargets(targetRows[0]);
  const daily = targets ? dailyTotal(targets) : undefined;
  const done = sumPortions(
    logs.map((l) => ({ palm: l.palm ?? 0, fist: l.fist ?? 0, cupped: l.cupped ?? 0, thumb: l.thumb ?? 0 })),
  );

  return (
    <Screen title="Food">
      <View className="gap-3 rounded-lg border border-border bg-surface p-4">
        <Text variant="heading">Today</Text>
        {daily ? (
          PORTIONS.map((p) => <PortionBar key={p} portion={p} done={done[p]} target={daily[p]} />)
        ) : (
          <Text variant="muted">Your portion targets load.</Text>
        )}
      </View>

      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
        {MOMENTS.map((m) => (
          <Pressable
            key={m}
            accessibilityRole="radio"
            accessibilityState={{ selected: m === moment }}
            onPress={() => setMoment(m)}
            className={
              m === moment
                ? "rounded-full bg-accent px-4 py-2"
                : "rounded-full border border-border bg-surface px-4 py-2"
            }
          >
            <Text className={m === moment ? "text-accent-text" : "text-text"}>{MOMENT_NAME[m]}</Text>
          </Pressable>
        ))}
      </View>

      <View className="flex-row gap-2">
        {PORTIONS.map((p) => (
          <PortionButton key={p} portion={p} onAdd={(amount) => void logPortion(date, moment, p, amount)} />
        ))}
      </View>
      <Text variant="muted">Tap to add one portion. Press and hold to add half.</Text>

      <View className="gap-2">
        <Text variant="heading">Saved meals</Text>
        {SEED_SAVED_MEALS.map((m) => (
          <Button
            key={m.id}
            variant="secondary"
            label={m.name}
            onPress={() => void logSavedMeal(date, m)}
            className="justify-start"
          />
        ))}
      </View>

      <Button variant="ghost" label="Undo the last log" onPress={() => void undoLastLog(date)} />

      <View className="flex-row gap-2">
        <Link href="/food/library" asChild>
          <Button variant="secondary" label="Meals" className="flex-1" />
        </Link>
        <Link href="/food/plan" asChild>
          <Button variant="secondary" label="Week plan" className="flex-1" />
        </Link>
        <Link href="/food/shopping" asChild>
          <Button variant="secondary" label="Shopping" className="flex-1" />
        </Link>
      </View>
    </Screen>
  );
}
