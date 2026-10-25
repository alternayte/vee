// SPDX-License-Identifier: AGPL-3.0-or-later
// The session (PRD "Session flow"): a 3-tap check-in, the warm-up, one card
// per set with one-tap logging, the rest timer, and a short summary. The tap
// writes the set first, then the runner moves, then the haptic fires (I5).
import { aimFor, type PrescribedItem, type Reason, type Step, sessionSteps } from "@vee/engine";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import * as Notifications from "expo-notifications";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Text } from "@/components/ui/text";
import { scheduleAll } from "@/features/reminders/schedule";
import { catalogue } from "@/features/training/catalogue";
import { live } from "@/modules/vee-live";
import { useTodayAdjust } from "./adjust";
import {
  type CheckinAnswers,
  finishSession,
  type LoggedSet,
  logSet,
  readSession,
  skipSession,
  startSession,
  undoSet,
} from "./data";
import {
  addRest,
  afterSet,
  closed,
  endRest,
  loadRunner,
  type Runner,
  undoLast,
  useRunner,
  warmupDone,
} from "./runner";

const exercise = (id: string) => catalogue.exercises.find((e) => e.id === id);
const nameOf = (id: string) => exercise(id)?.names.en ?? id;

const SCALE = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
const SLEEP = [
  { value: "good", label: "Good" },
  { value: "ok", label: "OK" },
  { value: "bad", label: "Bad" },
] as const;

export function CheckInScreen() {
  const [energy, setEnergy] = useState<number>();
  const [soreness, setSoreness] = useState<number>();
  const [sleep, setSleep] = useState<CheckinAnswers["sleep"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const adjust = useTodayAdjust((s) => s.adjust);
  const ready = energy !== undefined && soreness !== undefined && sleep !== undefined;
  return (
    <Screen title="Check-in" settings={false}>
      <Text variant="label">Energy (1 low, 5 high)</Text>
      <Choice options={SCALE} selected={energy ? [energy] : []} onToggle={setEnergy} />
      <Text variant="label">Soreness (1 none, 5 very sore)</Text>
      <Choice options={SCALE} selected={soreness ? [soreness] : []} onToggle={setSoreness} />
      <Text variant="label">Sleep last night</Text>
      <Choice options={[...SLEEP]} selected={sleep ? [sleep] : []} onToggle={setSleep} />
      <Button
        label={busy ? "Starting…" : "Start the session"}
        disabled={!ready || busy}
        testID="checkin-start"
        onPress={async () => {
          if (!ready) return;
          setBusy(true);
          try {
            // The rest-end alert is a local notification: Android 13+ asks once, here.
            await Notifications.requestPermissionsAsync().catch(() => undefined);
            const id = await startSession({ energy, soreness, sleep }, adjust);
            useTodayAdjust.getState().clear();
            router.replace({ pathname: "/session/[id]", params: { id } });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Vee cannot start the session.");
            setBusy(false);
          }
        }}
      />
      {error && <Text variant="muted">{error}</Text>}
    </Screen>
  );
}

function target(i: PrescribedItem): string {
  const t = i.target;
  const range = t.low === t.high ? `${t.low}` : `${t.low}–${t.high}`;
  return t.unit === "seconds" ? `${range} s` : `${range} reps`;
}

function loadText(i: PrescribedItem): string | undefined {
  const e = exercise(i.exerciseId);
  if (i.loadKg !== undefined) return e?.load === "dial" ? `Dial ${i.loadKg}` : `${i.loadKg} kg`;
  if (i.band) return `Band, ${i.band.setting}`;
  return undefined;
}

function Warmup({ items, onDone }: { items: PrescribedItem[]; onDone: () => void }) {
  return (
    <View className="gap-3">
      <Text variant="heading">Warm-up</Text>
      {items.map((i) => (
        <View key={`${i.order}-${i.exerciseId}`} className="flex-row justify-between gap-3">
          <Text className="flex-1">{nameOf(i.exerciseId)}</Text>
          <Text variant="label">
            {i.sets} × {target(i)}
            {loadText(i) ? ` · ${loadText(i)}` : ""}
          </Text>
        </View>
      ))}
      <Text variant="muted">Light sets to get warm. Vee does not log them.</Text>
      <Button label="Warm-up done" onPress={onDone} testID="warmup-done" />
    </View>
  );
}

const EFFORTS: { value: LoggedSet["effort"]; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "good", label: "Good" },
  { value: "hard", label: "Hard" },
  { value: "failed", label: "Failed" },
];

function SetCard({
  item,
  step,
  total,
  index,
  aim,
  onLog,
}: {
  item: PrescribedItem;
  step: Step;
  total: number;
  index: number;
  aim: number;
  onLog: (value: number, effort: LoggedSet["effort"]) => Promise<void>;
}) {
  const [value, setValue] = useState(aim);
  const [pressed, setPressed] = useState<string>();
  useEffect(() => setValue(aim), [aim]);
  const e = exercise(item.exerciseId);
  const seconds = item.target.unit === "seconds";
  const stepBy = seconds ? 5 : 1;
  const load = loadText(item);
  return (
    <View className="gap-4" testID="set-card">
      <Text variant="label">
        Step {index + 1} of {total}
      </Text>
      <Text variant="title">{nameOf(item.exerciseId)}</Text>
      <Text variant="label">
        Rung {e?.rung ?? 1} · {target(item)}
        {item.tempo ? ` · tempo ${item.tempo}` : ""}
      </Text>
      {load && (
        <Text variant="number" testID="set-load">
          {load}
        </Text>
      )}
      <Text variant="heading">
        Set {step.set} of {item.sets}
        {step.side ? ` · ${step.side === "left" ? "left side" : "right side"}` : ""}
      </Text>
      <View className="flex-row items-center justify-center gap-6">
        <Button
          label="−"
          variant="secondary"
          onPress={() => setValue((v) => Math.max(0, v - stepBy))}
          accessibilityLabel={seconds ? "5 seconds fewer" : "One rep fewer"}
        />
        <Text variant="number" testID="set-value">
          {value}
          {seconds ? " s" : ""}
        </Text>
        <Button
          label="+"
          variant="secondary"
          onPress={() => setValue((v) => v + stepBy)}
          accessibilityLabel={seconds ? "5 seconds more" : "One rep more"}
        />
      </View>
      <Text variant="muted">{seconds ? "Seconds held" : "Reps done"}. Tap how it felt to log the set.</Text>
      <View className="flex-row flex-wrap gap-2">
        {EFFORTS.map((f) => (
          <Pressable
            key={f.value}
            accessibilityRole="button"
            accessibilityLabel={`${f.label}: log the set`}
            testID={`effort-${f.value}`}
            // The look changes on touch-down; the write happens on release.
            onPressIn={() => setPressed(f.value)}
            onPressOut={() => setPressed(undefined)}
            onPress={() => void onLog(value, f.value)}
            className={`h-14 min-w-[22%] flex-1 items-center justify-center rounded-lg border ${pressed === f.value ? "border-accent bg-accent" : "border-border bg-surface"}`}
          >
            <Text
              className={pressed === f.value ? "font-inter-semibold text-accent-text" : "font-inter-semibold"}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {e?.cues.slice(0, 2).map((c) => (
        <Text key={c} variant="muted">
          {c}
        </Text>
      ))}
    </View>
  );
}

function Rest({ runner, next, onEnd }: { runner: Runner; next: string; onEnd: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((new Date(runner.restEndsAt ?? 0).getTime() - now) / 1000));
  // The end fires once: a second call would skip a step.
  const ended = useRef(false);
  useEffect(() => {
    if (left === 0 && !ended.current) {
      ended.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onEnd();
    }
  }, [left, onEnd]);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <View className="items-center gap-4" testID="rest">
      <Text variant="label">Rest</Text>
      <Text
        className="text-[96px] font-inter-semibold"
        style={{ fontVariant: ["tabular-nums"] }}
        testID="rest-left"
      >
        {mm}:{ss}
      </Text>
      <Text variant="muted">Next: {next}</Text>
      <View className="flex-row gap-2">
        <Button label="+30 s" variant="secondary" onPress={() => void addRest(runner, next)} />
        <Button
          label="Skip rest"
          onPress={() => {
            if (ended.current) return;
            ended.current = true;
            onEnd();
          }}
          testID="rest-skip"
        />
      </View>
    </View>
  );
}

function Summary({
  reasons,
  onFinish,
  finished,
}: {
  reasons?: Reason[];
  onFinish: () => void;
  finished: boolean;
}) {
  if (!finished)
    return (
      <View className="gap-3">
        <Text variant="heading">All sets done</Text>
        <Button label="Finish the session" onPress={onFinish} testID="finish" />
      </View>
    );
  return (
    <View className="gap-3" testID="summary">
      <Text variant="heading">Session done</Text>
      {(reasons ?? []).length === 0 && (
        <Text variant="muted">Nothing moves this time. The next session keeps the same targets.</Text>
      )}
      {(reasons ?? []).map((r) => (
        <Text key={`${r.ruleId}-${r.text}`}>{r.text}</Text>
      ))}
      <Button label="Back to Today" onPress={() => router.replace("/")} testID="summary-done" />
    </View>
  );
}

export function RunnerScreen() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const runner = useRunner((s) => s.runner);
  const [session, setSession] = useState<Awaited<ReturnType<typeof readSession>>>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const s = await readSession(id);
      if (!s) {
        setError("This session is not on this phone.");
        return;
      }
      setSession(s);
      useRunner.setState({ runner: await loadRunner(id, s.rx.warmup.length > 0) });
    })();
  }, [id]);

  const steps = useMemo(() => (session ? sessionSteps(session.rx, catalogue) : []), [session]);

  // The Live Update: "Set done" and "+30 s" from the notification come back here.
  const actions = useRef<{ done?: () => void; add30?: () => void }>({});
  useEffect(() => {
    const sub = live.onAction((a) => (a === "done" ? actions.current.done?.() : actions.current.add30?.()));
    return () => sub?.remove();
  }, []);
  const liveKey = runner ? `${runner.phase}|${runner.cursor}|${runner.restEndsAt ?? ""}` : "";
  useEffect(() => {
    if (!session || !runner || runner.sessionId !== id || !liveKey) return;
    if (runner.phase === "summary") {
      live.end();
      return;
    }
    // During rest the notification shows what comes next.
    const s = steps[runner.phase === "rest" ? runner.cursor + 1 : runner.cursor] ?? steps[runner.cursor];
    const it = s ? session.rx.items[s.item] : undefined;
    if (!s || !it) return;
    const lastStep = new Map(steps.map((x, n) => [x.item, n]));
    const done = [...lastStep.values()].filter((n) => n < runner.cursor).length;
    live.start({
      sessionTitle: session.rx.dayType ? `Session ${session.rx.dayType}` : "Session",
      exercise: runner.phase === "warmup" ? "Warm-up" : nameOf(it.exerciseId),
      setLabel:
        runner.phase === "warmup"
          ? "Light sets first"
          : `Set ${s.set} of ${it.sets}${s.side ? ` · ${s.side}` : ""}`,
      restEndsAt: runner.phase === "rest" ? (runner.restEndsAt ?? null) : null,
      progress: done,
      segments: session.rx.items.length,
    });
  }, [liveKey, session, id, runner, steps]);

  if (error) return <Screen title="Session">{<Text>{error}</Text>}</Screen>;
  if (!session || !runner || runner.sessionId !== id) return <Screen title="Session">{null}</Screen>;

  const step = steps[runner.cursor];
  const item = step ? session.rx.items[step.item] : undefined;
  const nextStep = steps[runner.cursor + 1];
  const nextText = nextStep
    ? `${nameOf(session.rx.items[nextStep.item]?.exerciseId ?? "")}, set ${nextStep.set}`
    : "the end of the session";
  const state = item ? session.input.history.progress.find((p) => p.family === item.family) : undefined;

  const log = async (value: number, effort: LoggedSet["effort"]) => {
    if (!item || !step) return;
    try {
      const setId = await logSet(runner.sessionId, {
        exerciseId: item.exerciseId,
        ...(step.side ? { side: step.side } : {}),
        ...(item.target.unit === "seconds" ? { seconds: value } : { reps: value }),
        ...(item.loadKg !== undefined ? { loadKg: item.loadKg } : {}),
        effort,
      });
      await afterSet(runner, setId, step, runner.cursor === steps.length - 1, nextText);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setError("Vee could not save the set. Try again.");
    }
  };

  actions.current = {
    done: () => {
      if (runner.phase === "work" && item) void log(aimFor(item, state), "good");
      else if (runner.phase === "rest") void endRest(runner);
    },
    add30: () => {
      if (runner.phase === "rest") void addRest(runner, nextText);
    },
  };

  return (
    <Screen title={session.rx.dayType ? `Session ${session.rx.dayType}` : "Session"} settings={false}>
      {session.rx.readinessMode !== "full" && (
        <Text variant="muted">
          {session.rx.readinessMode === "trimmed"
            ? "Your check-in was low, so each movement has one set fewer today."
            : "Your check-in was low, so today is a short recovery session."}
        </Text>
      )}
      {runner.phase === "warmup" && (
        <Warmup items={session.rx.warmup} onDone={() => void warmupDone(runner)} />
      )}
      {runner.phase === "work" && item && step && (
        <SetCard
          key={runner.cursor}
          item={item}
          step={step}
          total={steps.length}
          index={runner.cursor}
          aim={aimFor(item, state)}
          onLog={log}
        />
      )}
      {runner.phase === "rest" && <Rest runner={runner} next={nextText} onEnd={() => void endRest(runner)} />}
      {runner.phase === "summary" && (
        <Summary
          finished={runner.reasons !== undefined}
          reasons={runner.reasons}
          onFinish={async () => {
            await closed(runner, await finishSession(runner.sessionId));
            void scheduleAll();
          }}
        />
      )}
      {runner.logged.length > 0 && runner.reasons === undefined && (
        <Button
          label="Undo the last set"
          variant="ghost"
          onPress={async () => {
            const last = runner.logged.at(-1);
            if (!last) return;
            await undoSet(last);
            await undoLast(runner);
          }}
        />
      )}
      {runner.reasons === undefined && (
        <Button
          label="Stop and skip this session"
          variant="ghost"
          onPress={() =>
            Alert.alert("Skip this session?", "The sets you logged stay. A skip has no penalty.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Skip",
                style: "destructive",
                onPress: async () => {
                  await skipSession(runner.sessionId);
                  live.end();
                  void scheduleAll();
                  router.replace("/");
                },
              },
            ])
          }
        />
      )}
      {error && <Text variant="muted">{error}</Text>}
    </Screen>
  );
}
