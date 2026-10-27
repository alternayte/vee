// SPDX-License-Identifier: AGPL-3.0-or-later
// Plan (PRD "Session flow", "Progression"): the rotation and what comes next,
// each movement with every reason behind its numbers, the ladders, swaps the
// engine ranks, and the history to log, edit, move or remove past sessions.
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import {
  checkAllowed,
  type DayType,
  nextSession,
  type Reason,
  substitute,
  swapByUser,
  type TemplateItem,
} from "@vee/engine";
import { prescriptions, sessions, sets } from "@vee/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Link, router, useLocalSearchParams } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { EmptyState, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { TellMeMore } from "@/features/ai/tell-me-more";
import { db } from "@/features/db/database";
import { localDate } from "@/features/food/data";
import { type LoggedSet, logPastSession } from "@/features/session/data";
import { useTokens } from "@/features/theme/use-tokens";
import { catalogue } from "@/features/training/catalogue";
import { readProgramme, saveProgramme } from "@/features/training/data";
import { ExerciseName, HowTo } from "@/features/training/guide";
import { describeItem, useEngineInput } from "@/features/training/screens";
import { addSet, editSet, markDone, moveSession, removeSession, removeSet } from "./history";

const exercise = (id: string) => catalogue.exercises.find((e) => e.id === id);
const nameOf = (id: string) => exercise(id)?.names.en ?? id;
const familyName = (family: string) => catalogue.families.find((f) => f.id === family)?.names.en ?? family;

function Why({ reason }: { reason: Reason }) {
  return <Text variant="muted">{reason.text}</Text>;
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

function ItemLink({ item, day }: { item: TemplateItem; day: DayType }) {
  const { color } = useTokens();
  return (
    <Link href={{ pathname: "/plan/exercise/[id]", params: { id: item.exerciseId, day } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={nameOf(item.exerciseId)}
        testID={`plan-item-${day}`}
        className="flex-row items-center justify-between gap-3 py-1"
      >
        <Text className="flex-1">{nameOf(item.exerciseId)}</Text>
        <Text variant="label">{describeItem(item)}</Text>
        <ChevronRight size={16} color={color["text-muted"]} />
      </Pressable>
    </Link>
  );
}

export function PlanScreen() {
  const input = useEngineInput();
  const p = input?.programme;
  if (!input || !p) return <Screen title="Plan">{null}</Screen>;
  const next = nextSession(input).template.dayType;
  return (
    <Screen title="Plan">
      <Text variant="muted">
        Block week {p.blockWeek}. The rotation runs {p.rotation.join(" → ")}. Next: day {next}.
      </Text>
      <NavRow href="/plan/ladders" label="Ladders" />
      <NavRow href="/plan/history" label="History: log, edit or move a session" />
      {p.templates.map((t) => (
        <View
          key={t.dayType}
          className={`gap-2 rounded-lg border bg-surface p-4 ${t.dayType === next ? "border-accent" : "border-border"}`}
          testID={`plan-day-${t.dayType}`}
        >
          <Text variant="heading">
            {t.dayType} · {t.name}
            {t.dayType === next ? " · next" : ""}
          </Text>
          <Text variant="label">About {t.estimatedMinutes} min</Text>
          {t.items.map((i) => (
            <ItemLink key={`${i.order}-${i.exerciseId}`} item={i} day={t.dayType} />
          ))}
          {t.reasons.map((r) => (
            <Why key={`${r.ruleId}-${r.text}`} reason={r} />
          ))}
        </View>
      ))}
    </Screen>
  );
}

export function ExerciseScreen() {
  const { id, day } = useLocalSearchParams<{ id: string; day?: DayType }>();
  const input = useEngineInput();
  const [message, setMessage] = useState<string>();
  const e = exercise(id ?? "");
  const { data: history } = useQuery(
    toCompilableQuery(
      db
        .select({
          id: sets.id,
          session: sets.session_id,
          reps: sets.reps,
          seconds: sets.seconds,
          kg: sets.load_kg,
          effort: sets.effort,
          side: sets.side,
          date: sessions.date,
        })
        .from(sets)
        .innerJoin(sessions, eq(sessions.id, sets.session_id))
        .where(and(eq(sets.exercise_id, id ?? ""), isNull(sets.deleted_at), isNull(sessions.deleted_at)))
        .orderBy(asc(sessions.date)),
    ),
  );
  if (!input?.programme || !e) return <Screen title="Exercise">{null}</Screen>;
  const t = input.programme.templates.find((x) => x.dayType === day);
  const item = t?.items.find((i) => i.exerciseId === e.id);
  const state = input.history.progress.find((s) => s.family === e.family);
  const ladder = catalogue.exercises.filter((x) => x.family === e.family).sort((a, b) => a.rung - b.rung);
  const swaps = item ? substitute(input, e.id).slice(0, 8) : [];
  const reasons = item
    ? [
        item.reasons.exercise,
        ...item.reasons.sets,
        item.reasons.target,
        ...(item.reasons.load ? [item.reasons.load] : []),
      ]
    : [];
  const byDate = new Map<string, typeof history>();
  for (const h of history)
    byDate.set(`${h.date}|${h.session}`, [...(byDate.get(`${h.date}|${h.session}`) ?? []), h]);

  return (
    <Screen title={e.names.en} settings={false}>
      <Text variant="label">
        {familyName(e.family)} · rung {e.rung} of {ladder.length}
      </Text>
      <HowTo id={e.id} />
      {item && (
        <View className="gap-2 rounded-lg border border-border bg-surface p-4">
          <Text variant="heading">
            Day {day}: {describeItem(item)}
          </Text>
          {reasons.map((r) => (
            <Why key={`${r.ruleId}-${r.text}`} reason={r} />
          ))}
          <TellMeMore reasons={reasons} />
        </View>
      )}
      {state && (
        <Text variant="muted">
          {state.best !== undefined ? `Best set at this step: ${state.best}. ` : ""}
          Sessions without progress: {state.streaks?.stall ?? 0}.
        </Text>
      )}
      <Text variant="heading" accessibilityRole="header">
        Ladder
      </Text>
      {ladder.map((x) => {
        const allowed = checkAllowed(x, input.kit, input.flags, input.today).ok;
        return (
          <View key={x.id} className="flex-row justify-between gap-3">
            <ExerciseName
              id={x.id}
              label={`${x.rung}. ${x.names.en}${x.id === e.id ? " (you are here)" : ""}`}
              className="flex-1"
            />
            {!allowed && <Text variant="label">Not with your kit or flags</Text>}
          </View>
        );
      })}
      {item && day && (
        <>
          <Text variant="heading" accessibilityRole="header">
            Swap
          </Text>
          {swaps.length === 0 && (
            <Text variant="muted">Your kit and flags allow no other movement here.</Text>
          )}
          {swaps.map((c) => (
            <View
              key={c.exerciseId}
              className="gap-1 rounded-lg border border-border bg-surface p-3"
              testID="swap-option"
            >
              <ExerciseName id={c.exerciseId} />
              <Text variant="muted">{c.reason.text}</Text>
              <Button
                label={`Swap to ${nameOf(c.exerciseId)}`}
                variant="secondary"
                onPress={async () => {
                  const r = swapByUser(input, day, e.id, c.exerciseId);
                  if (!r.ok) {
                    setMessage(r.reason.text);
                    return;
                  }
                  const current = await readProgramme();
                  if (!current) return;
                  await saveProgramme({ ...r.programme, id: current.id });
                  router.replace({ pathname: "/plan/exercise/[id]", params: { id: c.exerciseId, day } });
                }}
              />
            </View>
          ))}
          {message && <Text variant="muted">{message}</Text>}
        </>
      )}
      <Text variant="heading" accessibilityRole="header">
        History
      </Text>
      {byDate.size === 0 && <Text variant="muted">No sets logged yet.</Text>}
      {[...byDate].reverse().map(([key, rows]) => {
        const [date, session] = key.split("|");
        return (
          <Link key={key} href={{ pathname: "/plan/history/[id]", params: { id: session ?? "" } }} asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Session on ${date}`}
              className="gap-1 py-1"
            >
              <Text variant="label">{date}</Text>
              <Text>
                {(rows ?? [])
                  .map(
                    (r) =>
                      `${r.reps ?? r.seconds ?? 0}${r.seconds !== null ? " s" : ""}${r.kg !== null ? ` @ ${r.kg} kg` : ""} ${r.effort}`,
                  )
                  .join(" · ")}
              </Text>
            </Pressable>
          </Link>
        );
      })}
    </Screen>
  );
}

export function LaddersScreen() {
  const input = useEngineInput();
  if (!input?.programme) return <Screen title="Ladders">{null}</Screen>;
  const families = [
    ...new Map(input.programme.templates.flatMap((t) => t.items.map((i) => [i.family, i] as const))).values(),
  ];
  return (
    <Screen title="Ladders" settings={false}>
      {families.map((i) => {
        const ladder = catalogue.exercises
          .filter((x) => x.family === i.family)
          .sort((a, b) => a.rung - b.rung);
        const now = exercise(i.exerciseId);
        const nextUp = ladder.find((x) => x.rung === (now?.rung ?? 0) + 1);
        return (
          <View key={i.family} className="gap-1 rounded-lg border border-border bg-surface p-4">
            <Text variant="heading">{familyName(i.family)}</Text>
            <Text>
              Rung {now?.rung ?? 1} of {ladder.length}: {nameOf(i.exerciseId)}
            </Text>
            {nextUp && <Text variant="muted">Next rung: {nextUp.names.en}</Text>}
            <View className="mt-1 flex-row gap-1">
              {ladder.map((x) => (
                <View
                  key={x.id}
                  className={`h-2 flex-1 rounded-full ${x.rung <= (now?.rung ?? 1) ? "bg-accent" : "bg-surface-raised"}`}
                />
              ))}
            </View>
          </View>
        );
      })}
    </Screen>
  );
}

const STATUS: Record<string, string> = {
  done: "Done",
  skipped: "Skipped",
  active: "Running",
  planned: "Planned",
};

export function HistoryScreen() {
  const input = useEngineInput();
  const { data: rows } = useQuery(
    toCompilableQuery(
      db.select().from(sessions).where(isNull(sessions.deleted_at)).orderBy(asc(sessions.date)),
    ),
  );
  const [date, setDate] = useState(localDate(new Date(Date.now() - 86_400_000)));
  const [day, setDay] = useState<string>();
  const [error, setError] = useState<string>();
  const days = input?.programme?.rotation ?? [];
  return (
    <Screen title="History" settings={false}>
      <View className="gap-3 rounded-lg border border-border bg-surface p-4">
        <Text variant="heading">Log a past session</Text>
        <Input
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          accessibilityLabel="Date of the session"
          testID="past-date"
        />
        <Choice
          options={days.map((d) => ({ value: d, label: `Day ${d}` }))}
          selected={day ? [day] : []}
          onToggle={setDay}
        />
        <Button
          label="Log this session"
          disabled={!day || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > localDate()}
          testID="past-log"
          onPress={async () => {
            if (!day) return;
            try {
              const id = await logPastSession(date, day);
              router.push({ pathname: "/plan/history/[id]", params: { id } });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Vee cannot log this session.");
            }
          }}
        />
        {error && <Text variant="muted">{error}</Text>}
      </View>
      {rows.length === 0 && <EmptyState text="No sessions yet." />}
      {[...rows].reverse().map((s) => (
        <Link key={s.id} href={{ pathname: "/plan/history/[id]", params: { id: s.id } }} asChild>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Session on ${s.date}`}
            className="flex-row justify-between rounded-lg border border-border bg-surface p-4"
            testID="history-row"
          >
            <Text>
              {s.date} · {s.day_type ? `day ${s.day_type}` : s.kind}
            </Text>
            <Text variant="label">{STATUS[s.status] ?? s.status}</Text>
          </Pressable>
        </Link>
      ))}
    </Screen>
  );
}

const EFFORTS = [
  { value: "easy", label: "Easy" },
  { value: "good", label: "Good" },
  { value: "hard", label: "Hard" },
  { value: "failed", label: "Failed" },
] as const;

type SetRow = typeof sets.$inferSelect;

function SetForm({
  sessionId,
  items,
  editing,
  onDone,
}: {
  sessionId: string;
  items: { exercise_id: string; load_kg: number | null; target: string | null }[];
  editing?: SetRow;
  onDone: () => void;
}) {
  const [exerciseId, setExercise] = useState(editing?.exercise_id ?? items[0]?.exercise_id ?? "");
  const unit = (
    JSON.parse(items.find((i) => i.exercise_id === exerciseId)?.target ?? "{}") as { unit?: string }
  ).unit;
  const seconds = unit === "seconds";
  const [value, setValue] = useState(String(editing?.reps ?? editing?.seconds ?? ""));
  const [kg, setKg] = useState(
    String(editing?.load_kg ?? items.find((i) => i.exercise_id === exerciseId)?.load_kg ?? ""),
  );
  const [effort, setEffort] = useState<LoggedSet["effort"]>(
    (editing?.effort as LoggedSet["effort"]) ?? "good",
  );
  const [side, setSide] = useState<"left" | "right" | undefined>(
    (editing?.side as "left" | "right" | null) ?? undefined,
  );
  const unilateral = exercise(exerciseId)?.unilateral ?? false;
  const n = Number(value);
  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-3">
      <Choice
        options={[...new Set(items.map((i) => i.exercise_id))].map((x) => ({ value: x, label: nameOf(x) }))}
        selected={[exerciseId]}
        onToggle={setExercise}
      />
      <Input
        value={value}
        onChangeText={setValue}
        keyboardType="number-pad"
        placeholder={seconds ? "Seconds" : "Reps"}
        accessibilityLabel={seconds ? "Seconds" : "Reps"}
        testID="set-value-input"
      />
      <Input
        value={kg}
        onChangeText={setKg}
        keyboardType="decimal-pad"
        placeholder="kg (empty for no load)"
        accessibilityLabel="Load in kg"
      />
      {unilateral && (
        <Choice
          options={[
            { value: "left", label: "Left" },
            { value: "right", label: "Right" },
          ]}
          selected={side ? [side] : []}
          onToggle={setSide}
        />
      )}
      <Choice options={[...EFFORTS]} selected={[effort]} onToggle={setEffort} />
      <Button
        label={editing ? "Save the set" : "Add the set"}
        disabled={!Number.isFinite(n) || n <= 0 || !exerciseId}
        testID="set-save"
        onPress={async () => {
          const s: LoggedSet = {
            exerciseId,
            effort,
            ...(seconds ? { seconds: n } : { reps: n }),
            ...(kg.trim() ? { loadKg: Number(kg) } : {}),
            ...(side ? { side } : {}),
          };
          if (editing) await editSet(editing.id, sessionId, s);
          else await addSet(sessionId, s);
          onDone();
        }}
      />
    </View>
  );
}

export function SessionEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: rows } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(sessions)
        .where(eq(sessions.id, id ?? "")),
    ),
  );
  const { data: logged } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(sets)
        .where(and(eq(sets.session_id, id ?? ""), isNull(sets.deleted_at)))
        .orderBy(asc(sets.logged_at)),
    ),
  );
  const { data: items } = useQuery(
    toCompilableQuery(
      db
        .select({
          exercise_id: prescriptions.exercise_id,
          load_kg: prescriptions.load_kg,
          target: prescriptions.target,
        })
        .from(prescriptions)
        .where(
          and(
            eq(prescriptions.session_id, id ?? ""),
            eq(prescriptions.section, "main"),
            isNull(prescriptions.deleted_at),
          ),
        )
        .orderBy(asc(prescriptions.item_order)),
    ),
  );
  const s = rows[0];
  const [date, setDate] = useState<string>();
  const [form, setForm] = useState<"add" | string>();
  if (!s || s.deleted_at)
    return <Screen title="Session">{<Text variant="muted">This session is removed.</Text>}</Screen>;
  const shownDate = date ?? s.date;
  return (
    <Screen title={`Session ${s.day_type ?? ""}`} settings={false}>
      <Text variant="label">
        {STATUS[s.status] ?? s.status} · {s.readiness_mode ?? "full"} readiness
      </Text>
      <View className="flex-row items-center gap-2">
        <Input
          value={shownDate}
          onChangeText={setDate}
          className="flex-1"
          accessibilityLabel="Date of the session"
          testID="edit-date"
        />
        <Button
          label="Move"
          variant="secondary"
          disabled={!/^\d{4}-\d{2}-\d{2}$/.test(shownDate) || shownDate === s.date || shownDate > localDate()}
          onPress={() => void moveSession(s.id, shownDate)}
        />
      </View>
      {s.status !== "done" && s.status !== "active" && (
        <Button label="Mark as done" variant="secondary" onPress={() => void markDone(s.id)} />
      )}
      <Text variant="heading" accessibilityRole="header">
        Sets
      </Text>
      {logged.length === 0 && <Text variant="muted">No sets yet.</Text>}
      {logged.map((x) =>
        form === x.id ? (
          <SetForm key={x.id} sessionId={s.id} items={items} editing={x} onDone={() => setForm(undefined)} />
        ) : (
          <View key={x.id} className="flex-row items-center justify-between gap-2" testID="logged-set">
            <Text className="flex-1">
              {nameOf(x.exercise_id)} · {x.reps ?? x.seconds}
              {x.seconds !== null ? " s" : " reps"}
              {x.load_kg !== null ? ` @ ${x.load_kg} kg` : ""}
              {x.side ? ` · ${x.side}` : ""} · {x.effort}
            </Text>
            <Button label="Edit" variant="ghost" onPress={() => setForm(x.id)} />
            <Button label="Delete" variant="ghost" onPress={() => void removeSet(x.id)} />
          </View>
        ),
      )}
      {form === "add" ? (
        <SetForm sessionId={s.id} items={items} onDone={() => setForm(undefined)} />
      ) : (
        items.length > 0 && (
          <Button label="Add a set" variant="secondary" onPress={() => setForm("add")} testID="set-add" />
        )
      )}
      <Text variant="muted">Vee recomputes every target from the corrected history.</Text>
      <Button
        label="Remove this session"
        variant="ghost"
        onPress={() =>
          Alert.alert("Remove this session?", "Its sets go too. Vee recomputes your targets.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Remove",
              style: "destructive",
              onPress: async () => {
                await removeSession(s.id);
                router.back();
              },
            },
          ])
        }
      />
    </Screen>
  );
}
