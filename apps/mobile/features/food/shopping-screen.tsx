// SPDX-License-Identifier: AGPL-3.0-or-later
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import { SHOP_SECTIONS, type ShopSection } from "@vee/nutrition";
import { shopping_items } from "@vee/schema";
import { and, eq, isNull } from "drizzle-orm";
import { Pressable, View } from "react-native";
import { EmptyState, Screen } from "@/components/screen";
import { Text } from "@/components/ui/text";
import { db } from "@/features/db/database";
import { ingredients, markStaple, setChecked, thisWeek } from "./data";

const SECTION_NAME: Record<ShopSection, string> = {
  produce: "Fruit and vegetables",
  "meat-fish": "Meat and fish",
  "dairy-eggs": "Dairy and eggs",
  "free-from": "Free-from",
  bakery: "Bakery",
  pantry: "Pantry",
  frozen: "Frozen",
  spices: "Spices",
  drinks: "Drinks",
};

const amount = (qty: number | null, unit: string | null) =>
  unit === "piece" ? `${qty ?? 0}` : `${Math.round(qty ?? 0)} ${unit ?? ""}`;

export function ShoppingScreen() {
  const week = thisWeek();
  const { data: rows } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(shopping_items)
        .where(and(eq(shopping_items.week, week), isNull(shopping_items.deleted_at))),
    ),
  );
  const info = (id: string) => ingredients().find((i) => i.id === id);

  if (rows.length === 0) {
    return (
      <Screen title="Shopping">
        <EmptyState text="The list is empty. Pick dinners in the week plan, then build the list." />
      </Screen>
    );
  }

  const left = rows.filter((r) => r.checked !== 1).length;
  return (
    <Screen title="Shopping">
      <Text testID="shopping-left">{left} items left to buy.</Text>
      {SHOP_SECTIONS.map((section) => {
        const items = rows
          .filter((r) => (info(r.ingredient_id)?.shopSection ?? "pantry") === section)
          .sort((a, b) =>
            (info(a.ingredient_id)?.name ?? "").localeCompare(info(b.ingredient_id)?.name ?? ""),
          );
        if (items.length === 0) return null;
        return (
          <View key={section} className="gap-2">
            <Text variant="heading">{SECTION_NAME[section]}</Text>
            {items.map((r) => {
              const done = r.checked === 1;
              const name = info(r.ingredient_id)?.name ?? r.ingredient_id;
              return (
                <View
                  key={r.id}
                  className="flex-row items-center gap-2 rounded-md border border-border bg-surface p-3"
                >
                  <Pressable
                    className="flex-1"
                    accessibilityRole="checkbox"
                    accessibilityLabel={name}
                    accessibilityState={{ checked: done }}
                    onPress={() => void setChecked(r.id, !done)}
                  >
                    <Text className={done ? "text-text-muted line-through" : "text-text"}>
                      {done ? "✓ " : ""}
                      {name}: {amount(r.qty, r.unit)}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Always have ${name}`}
                    onPress={() => void markStaple(r.ingredient_id).then(() => setChecked(r.id, true))}
                  >
                    <Text variant="label">Always have</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        );
      })}
    </Screen>
  );
}
