// SPDX-License-Identifier: AGPL-3.0-or-later
// Body charts (PRD "Charts"). Each chart has one series, in brass; bands and
// targets are muted ink. A press shows the value under the finger, and every
// chart carries a text summary for screen readers and a table view.
import { Inter_400Regular } from "@expo-google-fonts/inter";
import { Circle, useFont } from "@shopify/react-native-skia";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { AreaRange, CartesianChart, Line, Scatter, useChartPressState } from "victory-native";
import { Text } from "@/components/ui/text";
import { useTokens } from "@/features/theme/use-tokens";

export type Point = { x: number; y: number; label: string; low?: number; high?: number };

const DAY = 86_400_000;
export const dayIndex = (date: string) => Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY);
const shortDate = (x: number) => new Date(x * DAY).toISOString().slice(5, 10);

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <View className="gap-1">
      {rows.map(([a, b]) => (
        <View key={`${a}-${b}`} className="flex-row justify-between">
          <Text variant="label">{a}</Text>
          <Text>{b}</Text>
        </View>
      ))}
    </View>
  );
}

/** A line over dates, with an optional band (for example the weight target band). */
export function LineChart({
  points,
  unit,
  summary,
  dots = true,
}: {
  points: Point[];
  unit: string;
  summary: string;
  dots?: boolean;
}) {
  const { color } = useTokens();
  const font = useFont(Inter_400Regular, 11);
  const { state, isActive } = useChartPressState({ x: 0, y: { y: 0, low: 0, high: 0 } });
  const [shown, setShown] = useState<string>();
  const [table, setTable] = useState(false);
  useAnimatedReaction(
    () =>
      isActive
        ? `${shortDate(state.x.value.value)}: ${Math.round(state.y.y.value.value * 10) / 10} ${unit}`
        : undefined,
    (v) => runOnJS(setShown)(v),
    [isActive],
  );
  const banded = points.some((p) => p.low !== undefined);
  const data = points.map((p) => ({ x: p.x, y: p.y, low: p.low ?? p.y, high: p.high ?? p.y }));
  return (
    <View className="gap-2" accessible accessibilityLabel={summary}>
      <Text variant="muted">{shown ?? summary}</Text>
      {new Set(points.map((p) => p.x)).size >= 2 ? (
        <View style={{ height: 180 }}>
          <CartesianChart
            data={data}
            xKey="x"
            yKeys={["y", "low", "high"]}
            chartPressState={state}
            domainPadding={{ top: 12, bottom: 12, left: 8, right: 8 }}
            axisOptions={{
              font,
              tickCount: { x: 4, y: 4 },
              labelColor: color["text-muted"],
              lineColor: color.border,
              formatXLabel: shortDate,
              formatYLabel: (v) => `${Math.round(Number(v) * 10) / 10}`,
            }}
          >
            {({ points: p }) => (
              <>
                {banded && (
                  <AreaRange
                    upperPoints={p.high}
                    lowerPoints={p.low}
                    color={color["text-muted"]}
                    opacity={0.18}
                  />
                )}
                <Line points={p.y} color={color.accent} strokeWidth={2} />
                {dots && <Scatter points={p.y} radius={3} color={color.accent} />}
                {isActive && (
                  <Circle cx={state.x.position} cy={state.y.y.position} r={6} color={color.accent} />
                )}
              </>
            )}
          </CartesianChart>
        </View>
      ) : (
        <Text variant="muted">Not enough data for a chart yet.</Text>
      )}
      <Pressable accessibilityRole="button" onPress={() => setTable((t) => !t)}>
        <Text variant="label">{table ? "Hide the table" : "Show as a table"}</Text>
      </Pressable>
      {table && <Table rows={points.map((p) => [p.label, `${Math.round(p.y * 10) / 10} ${unit}`])} />}
    </View>
  );
}

/** Horizontal bars with a target tick: sets per muscle group against the goal. */
export function TargetBars({
  rows,
}: {
  rows: { label: string; value: number; target: number; note?: string }[];
}) {
  const { color } = useTokens();
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.target)));
  return (
    <View className="gap-2">
      {rows.map((r) => (
        <View
          key={r.label}
          className="gap-1"
          accessible
          accessibilityLabel={`${r.label}: ${Math.round(r.value * 10) / 10} of ${r.target} sets${r.note ? `, ${r.note}` : ""}`}
        >
          <View className="flex-row justify-between">
            <Text variant="label">
              {r.label}
              {r.note ? ` · ${r.note}` : ""}
            </Text>
            <Text variant="label">
              {Math.round(r.value * 10) / 10} / {r.target}
            </Text>
          </View>
          <View className="h-3 overflow-hidden rounded-full bg-surface-raised">
            <View
              style={{ width: `${(Math.min(r.value, max) / max) * 100}%`, backgroundColor: color.accent }}
              className="h-3 rounded-full"
            />
            <View
              style={{
                position: "absolute",
                left: `${(r.target / max) * 100}%`,
                top: 0,
                bottom: 0,
                width: 2,
                backgroundColor: color.text,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Columns against a planned count: consistency per 4 weeks. */
export function Columns({ rows }: { rows: { label: string; value: number; of: number }[] }) {
  const { color } = useTokens();
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.of)));
  return (
    <View className="flex-row items-end gap-2" style={{ height: 120 }}>
      {rows.map((r) => (
        <View
          key={r.label}
          className="flex-1 items-center gap-1"
          accessible
          accessibilityLabel={`${r.label}: ${r.value} of ${r.of}`}
        >
          <Text variant="label">{r.value}</Text>
          <View
            className="w-full justify-end overflow-hidden rounded-md bg-surface-raised"
            style={{ height: 80 }}
          >
            <View
              style={{ height: `${(Math.min(r.value, max) / max) * 100}%`, backgroundColor: color.accent }}
              className="w-full rounded-md"
            />
          </View>
          <Text variant="label">{r.label}</Text>
        </View>
      ))}
    </View>
  );
}
