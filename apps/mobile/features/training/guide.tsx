// SPDX-License-Identifier: AGPL-3.0-or-later
// How to do an exercise (docs/specs/exercise-clips.md): a looping clip in the
// theme colours, the cues and the muscles. `just media` writes the clips into
// assets/clips from the private repo; a build without them shows cues only.
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { CirclePlay } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Text, type TextVariantProps } from "@/components/ui/text";
import { useTokens } from "@/features/theme/use-tokens";
import { catalogue } from "./catalogue";

type Clip = { light: number; dark: number };

const clips: Record<string, Clip> = (() => {
  try {
    // An optional dependency: Metro bundles a throw when the folder is absent.
    return require("../../assets/clips");
  } catch {
    return {};
  }
})();

const exercise = (id: string) => catalogue.exercises.find((e) => e.id === id);

/** The clip on a surface tile; nothing when the exercise has no clip. */
export function ExerciseClip({ id, size }: { id: string; size?: number }) {
  const { theme } = useTokens();
  const still = useReducedMotion();
  const clip = clips[id];
  if (!clip) return null;
  return (
    <View
      className="overflow-hidden rounded-lg bg-surface"
      style={size ? { width: size, height: size } : { width: "100%", aspectRatio: 1 }}
    >
      <Image
        source={clip[theme]}
        autoplay={!still}
        contentFit="contain"
        style={{ width: "100%", height: "100%" }}
        accessibilityLabel={`${exercise(id)?.names.en ?? id}, shown by a figure`}
      />
    </View>
  );
}

/** An exercise name that opens the exercise sheet. */
export function ExerciseName({
  id,
  label,
  variant,
  className,
}: {
  id: string;
  label?: string;
  variant?: TextVariantProps["variant"];
  className?: string;
}) {
  const { color } = useTokens();
  const name = label ?? exercise(id)?.names.en ?? id;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={name}
      accessibilityHint="Shows how to do the exercise"
      hitSlop={6}
      onPress={() => router.push({ pathname: "/exercise/[id]", params: { id } })}
      className={`flex-row items-center gap-2 ${className ?? ""}`}
      testID={`exercise-name-${id}`}
    >
      <Text variant={variant} className="shrink">
        {name}
      </Text>
      {clips[id] && <CirclePlay size={16} color={color["text-muted"]} />}
    </Pressable>
  );
}

const muscleName = (m: string) => m[0]?.toUpperCase() + m.slice(1).replace("-", " ");

/** The clip at full width, every cue and the muscles worked. */
export function HowTo({ id }: { id: string }) {
  const e = exercise(id);
  if (!e) return null;
  const muscles = Object.entries(e.muscles)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .map(([m]) => muscleName(m));
  return (
    <View className="gap-4">
      <ExerciseClip id={e.id} />
      <View className="gap-2" testID="exercise-cues">
        {e.cues.map((c, i) => (
          <Text key={c}>
            {i + 1}. {c}
          </Text>
        ))}
      </View>
      <Text variant="label">Muscles: {muscles.join(", ")}</Text>
    </View>
  );
}

export function ExerciseSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const e = exercise(id ?? "");
  if (!e) return <Screen title="Exercise">{null}</Screen>;
  return (
    <Screen title={e.names.en} settings={false}>
      <HowTo id={e.id} />
      <Button label="Close" variant="secondary" onPress={() => router.back()} testID="exercise-close" />
    </Screen>
  );
}
