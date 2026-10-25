// SPDX-License-Identifier: AGPL-3.0-or-later
// The muscle map (PRD "Muscle map"): a front and a back body diagram in three
// modes. The numbers come from the engine's muscleWeek; the drawing only
// shades them. A list under the diagram says the same in words.
import { Canvas, Circle, Group, RoundedRect } from "@shopify/react-native-skia";
import { GROUP_NAMES, type MuscleGroup, type MuscleWeek } from "@vee/engine";
import { useState } from "react";
import { View } from "react-native";
import { Choice } from "@/components/ui/choice";
import { Text } from "@/components/ui/text";
import { useTokens } from "@/features/theme/use-tokens";

type Box = { x: number; y: number; w: number; h: number };

/** Regions on a 100 × 200 figure; each side of the body is one box. */
const FRONT: Partial<Record<MuscleGroup, Box[]>> = {
  "side-delts": [
    { x: 18, y: 40, w: 14, h: 14 },
    { x: 68, y: 40, w: 14, h: 14 },
  ],
  chest: [{ x: 33, y: 42, w: 34, h: 22 }],
  core: [{ x: 36, y: 66, w: 28, h: 32 }],
  biceps: [
    { x: 14, y: 56, w: 12, h: 26 },
    { x: 74, y: 56, w: 12, h: 26 },
  ],
  quads: [
    { x: 33, y: 104, w: 15, h: 46 },
    { x: 52, y: 104, w: 15, h: 46 },
  ],
};
const BACK: Partial<Record<MuscleGroup, Box[]>> = {
  "rear-delts": [
    { x: 18, y: 40, w: 14, h: 14 },
    { x: 68, y: 40, w: 14, h: 14 },
  ],
  "lats-upper-back": [{ x: 33, y: 42, w: 34, h: 40 }],
  triceps: [
    { x: 14, y: 56, w: 12, h: 26 },
    { x: 74, y: 56, w: 12, h: 26 },
  ],
  "hamstrings-glutes": [
    { x: 33, y: 88, w: 34, h: 18 },
    { x: 33, y: 108, w: 15, h: 42 },
    { x: 52, y: 108, w: 15, h: 42 },
  ],
};
/** The whole figure; the group regions shade on top of it. */
const BASE: Box[] = [
  { x: 33, y: 40, w: 34, h: 66 },
  { x: 18, y: 40, w: 18, h: 14 },
  { x: 64, y: 40, w: 18, h: 14 },
  { x: 14, y: 50, w: 12, h: 58 },
  { x: 74, y: 50, w: 12, h: 58 },
  { x: 33, y: 100, w: 15, h: 90 },
  { x: 52, y: 100, w: 15, h: 90 },
];

type Mode = "volume" | "recovering" | "untrained";
const MODES = [
  { value: "volume" as const, label: "This week" },
  { value: "recovering" as const, label: "Recovering" },
  { value: "untrained" as const, label: "Untrained" },
];

function Figure({
  regions,
  fill,
  base,
  ox,
}: {
  regions: Partial<Record<MuscleGroup, Box[]>>;
  fill: (g: MuscleGroup) => { color: string; opacity: number };
  base: string;
  ox: number;
}) {
  return (
    <Group transform={[{ translateX: ox }]}>
      <Circle cx={50} cy={22} r={13} color={base} />
      {BASE.map((b) => (
        <RoundedRect key={`${b.x}-${b.y}`} x={b.x} y={b.y} width={b.w} height={b.h} r={5} color={base} />
      ))}
      {(Object.entries(regions) as [MuscleGroup, Box[]][]).flatMap(([g, boxes]) =>
        boxes.map((b) => {
          const f = fill(g);
          return (
            <RoundedRect
              key={`${g}-${b.x}-${b.y}`}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              r={5}
              color={f.color}
              opacity={f.opacity}
            />
          );
        }),
      )}
    </Group>
  );
}

export function MuscleMap({ week }: { week: MuscleWeek }) {
  const { color } = useTokens();
  const [mode, setMode] = useState<Mode>("volume");
  const fill = (g: MuscleGroup) => {
    if (mode === "volume") {
      const t = week.target[g] || 1;
      return {
        color: color.accent,
        opacity: Math.min(1, week.sets[g] / t) * 0.9 + 0.1 * (week.sets[g] > 0 ? 1 : 0),
      };
    }
    if (mode === "recovering") return { color: color.accent, opacity: week.recovering.includes(g) ? 1 : 0 };
    return { color: color.warning, opacity: week.untrained.includes(g) ? 1 : 0 };
  };
  const groups = Object.keys(GROUP_NAMES) as MuscleGroup[];
  const words =
    mode === "volume"
      ? groups.map(
          (g) => `${GROUP_NAMES[g]}: ${Math.round(week.sets[g] * 10) / 10} of ${week.target[g]} sets`,
        )
      : mode === "recovering"
        ? week.recovering.length
          ? [`Still recovering: ${week.recovering.map((g) => GROUP_NAMES[g]).join(", ")}.`]
          : ["Nothing is still recovering."]
        : week.untrained.length
          ? [`No sets in the last 7 days: ${week.untrained.map((g) => GROUP_NAMES[g]).join(", ")}.`]
          : ["Every group got sets in the last 7 days."];
  return (
    <View className="gap-3">
      <Choice options={MODES} selected={[mode]} onToggle={setMode} />
      <View className="items-center" accessible accessibilityLabel={words.join(" ")}>
        <Canvas style={{ width: 220, height: 200 }}>
          <Figure regions={FRONT} fill={fill} base={color["surface-raised"]} ox={5} />
          <Figure regions={BACK} fill={fill} base={color["surface-raised"]} ox={115} />
        </Canvas>
        <View className="w-[220px] flex-row justify-around">
          <Text variant="label">Front</Text>
          <Text variant="label">Back</Text>
        </View>
      </View>
      {/* In "this week" the bars below say the numbers; the other modes say them here. */}
      {mode !== "volume" &&
        words.map((w) => (
          <Text key={w} variant="muted">
            {w}
          </Text>
        ))}
    </View>
  );
}
