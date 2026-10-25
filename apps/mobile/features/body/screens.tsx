// SPDX-License-Identifier: AGPL-3.0-or-later
// Body (PRD "Body and progress"): capability is the headline, weight is a
// background signal. Weight speaks only through rule N1. Tests, destinations,
// the muscle map, consistency, the ladder map and photos. An optional
// biometric lock covers this tab and the photos (SDD "Lost or stolen phone").
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import {
  type Criterion,
  consistency,
  DESTINATIONS,
  destinationGap,
  GROUP_NAMES,
  muscleWeek,
  rungHistory,
  type TestItem,
  testDue,
} from "@vee/engine";
import { emaSeries, MIN_WEIGH_INS, weeklySlope, weightOutlook } from "@vee/nutrition";
import {
  body_metrics,
  destinations,
  food_targets,
  photos,
  test_results,
  tests,
  ui_prefs,
  uuidv7,
} from "@vee/schema";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import * as ImagePicker from "expo-image-picker";
import * as LocalAuthentication from "expo-local-authentication";
import { Link } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Image, PanResponder, Pressable, View } from "react-native";
import { create } from "zustand";
import { EmptyState, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { db } from "@/features/db/database";
import { localDate } from "@/features/food/data";
import { ReviewsSection } from "@/features/review/screens";
import { useTokens } from "@/features/theme/use-tokens";
import { catalogue } from "@/features/training/catalogue";
import { useEngineInput } from "@/features/training/screens";
import { Columns, dayIndex, LineChart, type Point, TargetBars } from "./charts";
import {
  addDestination,
  addMetric,
  MEASURES,
  type Measure,
  POSES,
  type Pose,
  photoFile,
  removeDestination,
  removePhoto,
  savePhoto,
  saveTest,
} from "./data";
import { connectHealth, healthConnected, importWeights } from "./health";
import { MuscleMap } from "./muscle-map";

// ── Lock ───────────────────────────────────────────────────────────────────

export const LOCK_KEY = "body_lock";
const useUnlocked = create<{ unlocked: boolean }>(() => ({ unlocked: false }));

export async function setBodyLock(on: boolean) {
  await db.delete(ui_prefs).where(eq(ui_prefs.key, LOCK_KEY));
  if (on) await db.insert(ui_prefs).values({ id: uuidv7(), key: LOCK_KEY, value: "1" });
}

/** Shows the children only after a fingerprint or face check, when the lock is on. */
function Locked({ children }: { children: ReactNode }) {
  const { data } = useQuery(toCompilableQuery(db.select().from(ui_prefs).where(eq(ui_prefs.key, LOCK_KEY))));
  const unlocked = useUnlocked((s) => s.unlocked);
  if (data.length === 0 || unlocked) return <>{children}</>;
  return (
    <View className="gap-3">
      <EmptyState text="The Body tab and your photos are locked." />
      <Button
        label="Unlock"
        onPress={async () => {
          const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Body" });
          if (r.success) useUnlocked.setState({ unlocked: true });
        }}
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3 rounded-lg border border-border bg-surface p-4">
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function NavRow({ href, label }: { href: string; label: string }) {
  const { color } = useTokens();
  return (
    <Link href={href as never} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        className="flex-row items-center justify-between rounded-lg border border-border bg-surface p-4"
      >
        <Text>{label}</Text>
        <ChevronRight color={color["text-muted"]} />
      </Pressable>
    </Link>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Weight ─────────────────────────────────────────────────────────────────

/** The target band of the lean-gain rule N1: +0.05 to +0.25 kg a week from the first trend point. */
const BAND = { low: 0.05, high: 0.25 };

function Weight() {
  const { data: rows } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(body_metrics)
        .where(and(eq(body_metrics.kind, "weight"), isNull(body_metrics.deleted_at)))
        .orderBy(asc(body_metrics.measured_at)),
    ),
  );
  const { data: targets } = useQuery(
    toCompilableQuery(db.select().from(food_targets).where(isNull(food_targets.deleted_at)).limit(1)),
  );
  const [kg, setKg] = useState("");
  const [hc, setHc] = useState<boolean>();
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    void healthConnected().then(setHc);
  }, []);
  const weighIns = rows
    .filter((r) => r.value !== null)
    .map((r) => ({ date: r.measured_at.slice(0, 10), kg: r.value as number }));
  const ema = emaSeries(weighIns);
  const start = ema[0];
  const points: Point[] = ema.map((p) => {
    const weeks = start ? (dayIndex(p.date) - dayIndex(start.date)) / 7 : 0;
    return {
      x: dayIndex(p.date),
      y: p.kg,
      label: p.date,
      ...(start ? { low: start.kg + BAND.low * weeks, high: start.kg + BAND.high * weeks } : {}),
    };
  });
  const recent = weighIns.filter((w) => dayIndex(w.date) > dayIndex(localDate()) - 21);
  // The same rule as N1: no slope from fewer than MIN_WEIGH_INS weigh-ins in 3 weeks.
  const slope = recent.length >= MIN_WEIGH_INS ? Math.round(weeklySlope(recent) * 100) / 100 : undefined;
  const latest = ema.at(-1);
  const t = targets[0];
  const n1 =
    t?.adjusted_at && dayIndex(localDate()) - dayIndex(t.adjusted_at) <= 14 && t.reason
      ? (JSON.parse(t.reason) as { text: string }).text
      : undefined;
  const outlook = weightOutlook(weighIns, localDate());
  return (
    <Section title="Weight">
      <LineChart
        points={points}
        unit="kg"
        dots={false}
        summary={
          latest
            ? `Trend ${round1(latest.kg)} kg${slope !== undefined ? `, ${slope > 0 ? "+" : ""}${slope} kg a week over 3 weeks` : ""}${slope === undefined ? `. A weekly trend needs ${MIN_WEIGH_INS} weigh-ins in 3 weeks` : ""}. The grey band is your target gain.`
            : "No weigh-ins yet."
        }
      />
      {n1 && <Text>{n1}</Text>}
      <View className="flex-row gap-2">
        <Input
          value={kg}
          onChangeText={setKg}
          keyboardType="decimal-pad"
          placeholder="Weight in kg"
          className="flex-1"
          accessibilityLabel="Weight in kg"
          testID="weight-input"
        />
        <Button
          label="Add"
          disabled={!(Number(kg) > 20 && Number(kg) < 300)}
          testID="weight-add"
          onPress={async () => {
            await addMetric("weight", round1(Number(kg)));
            setKg("");
          }}
        />
      </View>
      {hc === false && (
        <Button
          label="Read weight and sleep from Health Connect"
          variant="secondary"
          onPress={async () => {
            const ok = await connectHealth();
            setHc(ok);
            setMessage(
              ok
                ? `${await importWeights()} weigh-ins read.`
                : "Health Connect is not on this phone, or Vee has no permission.",
            );
          }}
        />
      )}
      {hc && (
        <Button
          label="Read new weigh-ins from Health Connect"
          variant="ghost"
          onPress={async () => setMessage(`${await importWeights()} weigh-ins read.`)}
        />
      )}
      {message && <Text variant="muted">{message}</Text>}
      {!outlook && weighIns.length > 0 && (
        <Text variant="muted">An outlook needs weigh-ins over at least 3 weeks.</Text>
      )}
      {outlook && (
        <View className="gap-1">
          <Text variant="label">If your trend holds</Text>
          {outlook.map((o) => (
            <Text key={o.months}>
              In {o.months} months: {o.low}–{o.high} kg
            </Text>
          ))}
          <Text variant="muted">
            The range is your own trend's uncertainty. It widens with time and is not a promise.
          </Text>
        </View>
      )}
    </Section>
  );
}

// ── Measurements ───────────────────────────────────────────────────────────

const MEASURE_NAME: Record<Measure, string> = {
  waist: "Waist",
  chest: "Chest",
  shoulder: "Shoulders",
  arm: "Arm",
};

function Measurements() {
  const { data: rows } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(body_metrics)
        .where(isNull(body_metrics.deleted_at))
        .orderBy(desc(body_metrics.measured_at)),
    ),
  );
  const [kind, setKind] = useState<Measure>("waist");
  const [cm, setCm] = useState("");
  const latest = (k: Measure) => rows.find((r) => r.kind === k && r.value !== null)?.value ?? undefined;
  const waist = latest("waist");
  const shoulder = latest("shoulder");
  return (
    <Section title="Measurements">
      {MEASURES.map((k) => (
        <View key={k} className="flex-row justify-between">
          <Text variant="label">{MEASURE_NAME[k]}</Text>
          <Text>{latest(k) !== undefined ? `${latest(k)} cm` : "–"}</Text>
        </View>
      ))}
      {waist && shoulder && (
        <Text>Shoulder-to-waist ratio: {Math.round((shoulder / waist) * 100) / 100}</Text>
      )}
      <Choice
        options={MEASURES.map((k) => ({ value: k, label: MEASURE_NAME[k] }))}
        selected={[kind]}
        onToggle={setKind}
      />
      <View className="flex-row gap-2">
        <Input
          value={cm}
          onChangeText={setCm}
          keyboardType="decimal-pad"
          placeholder="cm"
          className="flex-1"
          accessibilityLabel={`${MEASURE_NAME[kind]} in cm`}
        />
        <Button
          label="Add"
          disabled={!(Number(cm) > 10 && Number(cm) < 250)}
          onPress={async () => {
            await addMetric(kind, round1(Number(cm)));
            setCm("");
          }}
        />
      </View>
      <Text variant="muted">Measure the waist once a month, at the navel, after breathing out.</Text>
    </Section>
  );
}

// ── Tests and destinations ─────────────────────────────────────────────────

export const TEST_ITEMS: { item: TestItem; label: string; unit: string }[] = [
  { item: "hang", label: "Dead hang", unit: "s" },
  { item: "pullups", label: "Strict pull-ups", unit: "reps" },
  { item: "pushups", label: "Push-ups", unit: "reps" },
  { item: "carry", label: "Suitcase carry, per side", unit: "s" },
  { item: "burpees", label: "Burpees in 3 min", unit: "reps" },
  { item: "waist", label: "Waist", unit: "cm" },
];
const itemLabel = (i: TestItem) => TEST_ITEMS.find((t) => t.item === i)?.label ?? i;
const itemUnit = (i: TestItem) => TEST_ITEMS.find((t) => t.item === i)?.unit ?? "";

function useTestResults() {
  const { data } = useQuery(
    toCompilableQuery(
      db
        .select({ date: tests.date, item: test_results.item, value: test_results.value })
        .from(test_results)
        .innerJoin(tests, eq(tests.id, test_results.test_id))
        .where(and(isNull(test_results.deleted_at), isNull(tests.deleted_at)))
        .orderBy(asc(tests.date)),
    ),
  );
  return data
    .filter((r) => r.value !== null)
    .map((r) => ({ date: r.date, item: r.item as TestItem, value: r.value as number }));
}

function Destinations() {
  const results = useTestResults();
  const { data: rows } = useQuery(
    toCompilableQuery(db.select().from(destinations).where(isNull(destinations.deleted_at))),
  );
  const [name, setName] = useState("");
  const [item, setItem] = useState<TestItem>("hang");
  const [value, setValue] = useState("");
  const mine = rows.map((r) => ({
    id: r.id,
    name: r.name,
    criteria: (r.criteria ? JSON.parse(r.criteria) : []) as Criterion[],
  }));
  const all = [...DESTINATIONS.map((d) => ({ id: undefined, ...d })), ...mine];
  return (
    <Section title="Destinations">
      {all.map((d) => (
        <View key={d.id ?? d.name} className="gap-1">
          <Text>{d.name}</Text>
          {destinationGap(d.criteria, results).map((g) => (
            <Text key={g.item} variant="muted">
              {itemLabel(g.item)}: {g.have ?? "not tested"} of {g.want} {itemUnit(g.item)}
              {g.met ? " · reached" : ""}
            </Text>
          ))}
          {d.id && (
            <Button label="Remove" variant="ghost" onPress={() => void removeDestination(d.id as string)} />
          )}
        </View>
      ))}
      <Text variant="label">Add your own</Text>
      <Input
        value={name}
        onChangeText={setName}
        placeholder="Name, for example First muscle-up"
        accessibilityLabel="Destination name"
      />
      <Choice
        options={TEST_ITEMS.filter((t) => t.item !== "waist").map((t) => ({ value: t.item, label: t.label }))}
        selected={[item]}
        onToggle={setItem}
      />
      <View className="flex-row gap-2">
        <Input
          value={value}
          onChangeText={setValue}
          keyboardType="number-pad"
          placeholder={itemUnit(item)}
          className="flex-1"
          accessibilityLabel="Goal value"
        />
        <Button
          label="Add"
          disabled={!name.trim() || !(Number(value) > 0)}
          onPress={async () => {
            await addDestination(name.trim(), [{ item, value: Number(value) }]);
            setName("");
            setValue("");
          }}
        />
      </View>
    </Section>
  );
}

export function TestsScreen() {
  const results = useTestResults();
  const [values, setValues] = useState<Partial<Record<TestItem, string>>>({});
  const [saved, setSaved] = useState(false);
  const entered = TEST_ITEMS.filter((t) => Number(values[t.item]) > 0);
  return (
    <Screen title="Monthly test" settings={false}>
      <Locked>
        <Text variant="muted">
          About 10 minutes. Leave out what you cannot do today. A result can move a ladder up by at most 2
          rungs.
        </Text>
        {TEST_ITEMS.map((t) => (
          <View key={t.item} className="flex-row items-center gap-2">
            <Text className="flex-1">{t.label}</Text>
            <Input
              value={values[t.item] ?? ""}
              onChangeText={(v) => setValues((x) => ({ ...x, [t.item]: v }))}
              keyboardType="decimal-pad"
              placeholder={t.unit}
              className="w-28"
              accessibilityLabel={`${t.label} in ${t.unit}`}
              testID={`test-${t.item}`}
            />
          </View>
        ))}
        <Button
          label={saved ? "Saved" : "Save the test"}
          disabled={entered.length === 0 || saved}
          testID="test-save"
          onPress={async () => {
            await saveTest(entered.map((t) => ({ item: t.item, value: Number(values[t.item]) })));
            setSaved(true);
          }}
        />
        {TEST_ITEMS.map((t) => {
          const mine = results.filter((r) => r.item === t.item);
          if (mine.length === 0) return null;
          return (
            <Section key={t.item} title={t.label}>
              <LineChart
                points={mine.map((r) => ({ x: dayIndex(r.date), y: r.value, label: r.date }))}
                unit={t.unit}
                summary={`Latest ${mine.at(-1)?.value} ${t.unit}${mine.length > 1 ? `, first ${mine[0]?.value} ${t.unit}` : ""}.`}
              />
            </Section>
          );
        })}
        <Destinations />
      </Locked>
    </Screen>
  );
}

// ── Photos ─────────────────────────────────────────────────────────────────

/** Before and after: drag the line to compare. */
function Compare({ before, after }: { before: string; after: string }) {
  const [width, setWidth] = useState(1);
  const [split, setSplit] = useState(0.5);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => setSplit(Math.min(1, Math.max(0, e.nativeEvent.locationX / width))),
        onPanResponderMove: (e) => setSplit(Math.min(1, Math.max(0, e.nativeEvent.locationX / width))),
      }),
    [width],
  );
  const { color } = useTokens();
  return (
    <View
      className="overflow-hidden rounded-lg"
      style={{ aspectRatio: 3 / 4 }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel="Before and after photo. Drag to compare."
      {...pan.panHandlers}
    >
      <Image
        source={{ uri: after }}
        style={{ position: "absolute", width: "100%", height: "100%" }}
        resizeMode="cover"
      />
      <View style={{ position: "absolute", width: `${split * 100}%`, height: "100%", overflow: "hidden" }}>
        <Image source={{ uri: before }} style={{ width, height: "100%" }} resizeMode="cover" />
      </View>
      <View
        style={{
          position: "absolute",
          left: `${split * 100}%`,
          top: 0,
          bottom: 0,
          width: 2,
          backgroundColor: color.accent,
        }}
      />
    </View>
  );
}

export function PhotosScreen() {
  const { data: rows } = useQuery(
    toCompilableQuery(
      db.select().from(photos).where(isNull(photos.deleted_at)).orderBy(asc(photos.taken_at)),
    ),
  );
  const [pose, setPose] = useState<Pose>("front");
  const [error, setError] = useState<string>();
  const mine = rows.filter((r) => r.pose === pose);
  const first = mine[0];
  const last = mine.at(-1);
  return (
    <Screen title="Photos" settings={false}>
      <Locked>
        <Text variant="muted">
          Once a month: front, side and back, in the same light. The photos stay on this phone. They never go
          to the AI.
        </Text>
        <Choice
          options={POSES.map((p) => ({ value: p, label: p[0]?.toUpperCase() + p.slice(1) }))}
          selected={[pose]}
          onToggle={setPose}
        />
        <Button
          label={`Take a ${pose} photo`}
          onPress={async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              setError("Vee needs the camera permission for this.");
              return;
            }
            const r = await ImagePicker.launchCameraAsync({ quality: 0.8, exif: false });
            const uri = r.assets?.[0]?.uri;
            if (!r.canceled && uri) await savePhoto(pose, uri);
          }}
        />
        {error && <Text variant="muted">{error}</Text>}
        {first && last && first.id !== last.id && (
          <Section title={`${first.taken_at.slice(0, 10)} → ${last.taken_at.slice(0, 10)}`}>
            <Compare before={photoFile(first.id).uri} after={photoFile(last.id).uri} />
          </Section>
        )}
        {mine.length === 0 && <EmptyState text={`No ${pose} photos yet.`} />}
        <View className="flex-row flex-wrap gap-2">
          {[...mine].reverse().map((p) => (
            <View key={p.id} className="w-[31%] gap-1">
              <Image
                source={{ uri: photoFile(p.id).uri }}
                style={{ width: "100%", aspectRatio: 3 / 4 }}
                className="rounded-md"
              />
              <Text variant="label">{p.taken_at.slice(0, 10)}</Text>
              <Button label="Delete" variant="ghost" onPress={() => void removePhoto(p.id)} />
            </View>
          ))}
        </View>
      </Locked>
    </Screen>
  );
}

// ── Body ───────────────────────────────────────────────────────────────────

const familyName = (id: string) => catalogue.families.find((f) => f.id === id)?.names.en ?? id;

export function BodyScreen() {
  const input = useEngineInput();
  const week = input ? muscleWeek(input) : undefined;
  const windows = input ? consistency(input, 6) : [];
  const ladders = useMemo(() => (input ? rungHistory(input) : {}), [input]);
  return (
    <Screen title="Body">
      <Locked>
        {input && testDue(input) && (
          <View className="gap-2 rounded-lg border border-accent bg-surface p-4">
            <Text variant="heading">The monthly test is due</Text>
            <Text variant="muted">10 minutes: hang, pull-ups, push-ups, carry, burpees and waist.</Text>
            <Link href="/body/tests" asChild>
              <Button label="Do the test" testID="test-due" />
            </Link>
          </View>
        )}
        <Weight />
        <Measurements />
        {week && (
          <Section title="Muscles">
            <MuscleMap week={week} />
            <TargetBars
              rows={(Object.keys(week.sets) as (keyof typeof week.sets)[]).map((g) => ({
                label: GROUP_NAMES[g],
                value: week.sets[g],
                target: week.target[g],
              }))}
            />
            <Text variant="muted">Sets in the last 7 days. The line is your goal's weekly target.</Text>
          </Section>
        )}
        {windows.length > 0 && (
          <Section title="Consistency">
            <Columns rows={windows.map((w) => ({ label: w.to.slice(5), value: w.done, of: w.planned }))} />
            <Text variant="muted">
              Main sessions per 4 weeks. The plan has {windows[0]?.planned ?? 0} in 4 weeks.
            </Text>
          </Section>
        )}
        {Object.keys(ladders).length > 0 && (
          <Section title="Ladder map">
            {Object.entries(ladders).map(([family, steps]) => (
              <View key={family} className="gap-1">
                <Text>{familyName(family)}</Text>
                <Text variant="muted">
                  {steps.map((s) => `rung ${s.rung} (${s.date.slice(5)})`).join(" → ")}
                </Text>
              </View>
            ))}
          </Section>
        )}
        <NavRow href="/body/tests" label="Tests and destinations" />
        <NavRow href="/body/photos" label="Progress photos" />
        <ReviewsSection />
      </Locked>
    </Screen>
  );
}
