// SPDX-License-Identifier: AGPL-3.0-or-later
// Weekly reviews (PRD "Weekly review"): the engine's numbers, the AI's words,
// and up to 3 proposals. A proposal changes nothing until the user accepts
// it, and the engine checks it again on the phone first (I4).
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import type { ReviewNumbers } from "@vee/ai/types";
import { type PlanChange, type Reason, validateProposal } from "@vee/engine";
import { ai_proposals, reviews } from "@vee/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Link, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { EmptyState, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/features/account/account";
import { aiPost } from "@/features/ai/client";
import { ProposalCard, type StoredChange } from "@/features/ai/proposal-card";
import { db } from "@/features/db/database";
import { catalogue } from "@/features/training/catalogue";
import { readEngineInput, readProgramme, saveProgramme } from "@/features/training/data";

type Numbers = ReviewNumbers & { focus?: string };

const parse = <T,>(s: string | null): T | undefined => (s ? (JSON.parse(s) as T) : undefined);
const PORTION_NAME = { palm: "Protein", fist: "Vegetables", cupped: "Carbs", thumb: "Fats" } as const;

/** The weekly reviews, as a section of the Body screen. */
export function ReviewsSection() {
  const signedIn = useAccount((s) => s.status === "signed-in");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { data: rows } = useQuery(
    toCompilableQuery(
      db.select().from(reviews).where(isNull(reviews.deleted_at)).orderBy(desc(reviews.week)),
    ),
  );
  return (
    <View className="gap-3">
      <Text variant="heading" accessibilityRole="header">
        Weekly reviews
      </Text>
      {rows.length === 0 && (
        <EmptyState text="Your weekly review comes on Sunday evening. It needs an account and the plus tier." />
      )}
      {rows.map((r) => {
        const n = parse<Numbers>(r.numbers);
        return (
          <Link key={r.id} href={{ pathname: "/body/review/[week]", params: { week: r.week } }} asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Review of the week to ${r.week}`}
              className="gap-1 rounded-lg border border-border bg-surface p-4"
            >
              <Text>Week to {r.week}</Text>
              {n && (
                <Text variant="label">
                  {n.training.mainDone} of {n.training.mainPlanned} sessions · {n.training.movedUp.length}{" "}
                  moved up
                </Text>
              )}
            </Pressable>
          </Link>
        );
      })}
      {signedIn && (
        <Button
          label={busy ? "Making the review…" : "Make this week's review now"}
          variant="secondary"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setMessage(undefined);
            const r = await aiPost<{ week: string }>("/ai/weekly-review", {});
            setMessage(r.ok ? "The review is ready. It shows here after the next sync." : r.message);
            setBusy(false);
          }}
        />
      )}
      {message && <Text variant="muted">{message}</Text>}
    </View>
  );
}

function NumbersCard({ n }: { n: Numbers }) {
  const t = n.training;
  const line = (label: string, value: string) => (
    <View className="flex-row justify-between gap-3">
      <Text variant="label">{label}</Text>
      <Text>{value}</Text>
    </View>
  );
  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-4">
      {line("Main sessions", `${t.mainDone} of ${t.mainPlanned}`)}
      {line("Micro sessions", String(t.microDone))}
      {line("Sets logged", String(t.sets))}
      {line(
        "Readiness",
        `${t.readiness.full} full · ${t.readiness.trimmed} trimmed · ${t.readiness.recovery} recovery`,
      )}
      {line("Food logged", `${n.food.daysLogged} of ${n.food.days} days`)}
      {n.food.daysLogged > 0 &&
        (Object.keys(PORTION_NAME) as (keyof typeof PORTION_NAME)[]).map((p) =>
          line(PORTION_NAME[p], `${n.food.percentOfTarget[p]}% of target`),
        )}
      {line(
        "Weight trend",
        n.weight.slopeKgPerWeek === null
          ? `${n.weight.weighIns} weigh-ins, not enough for a trend`
          : `${n.weight.slopeKgPerWeek} kg a week`,
      )}
      {t.movedUp.map((m) => (
        <Text key={`up-${m.family}`}>
          Up: {m.exercise}{" "}
          {m.kind === "load"
            ? `${m.from} → ${m.to} kg`
            : m.kind === "hold"
              ? `${m.from} → ${m.to} s`
              : `rung ${m.from} → ${m.to}`}
        </Text>
      ))}
      {t.movedDown.map((m) => (
        <Text key={`down-${m.family}`}>
          Down: {m.exercise}{" "}
          {m.kind === "load"
            ? `${m.from} → ${m.to} kg`
            : m.kind === "hold"
              ? `${m.from} → ${m.to} s`
              : `rung ${m.from} → ${m.to}`}
        </Text>
      ))}
      {t.stalled.map((s) => (
        <Text key={`stall-${s.family}`}>
          Stalled: {s.exercise}, {s.sessions} sessions
        </Text>
      ))}
    </View>
  );
}

export function ReviewScreen() {
  const { week } = useLocalSearchParams<{ week: string }>();
  const { data: rows } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(reviews)
        .where(and(eq(reviews.week, week ?? ""), isNull(reviews.deleted_at)))
        .orderBy(desc(reviews.created_at))
        .limit(1),
    ),
  );
  const { data: proposals } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(ai_proposals)
        .where(and(eq(ai_proposals.status, "pending"), isNull(ai_proposals.deleted_at))),
    ),
  );
  const r = rows[0];
  const n = parse<Numbers>(r?.numbers ?? null);
  const mine = proposals
    .map((p) => ({
      id: p.id,
      change: parse<StoredChange>(p.change),
      reasons: parse<Reason[]>(p.validation) ?? [],
    }))
    .filter((p): p is { id: string; change: StoredChange; reasons: Reason[] } => p.change?.week === week);

  return (
    <Screen title="Weekly review">
      <Text variant="label">Week to {week}</Text>
      {n && <NumbersCard n={n} />}
      {r?.words ? (
        <Text testID="review-words">{r.words}</Text>
      ) : (
        <Text variant="muted">
          The AI did not write words this week. The numbers above come from the engine.
        </Text>
      )}
      {n?.focus && (
        <View className="gap-1">
          <Text variant="label">Focus for next week</Text>
          <Text>{n.focus}</Text>
        </View>
      )}
      {mine.map((p) => (
        <ProposalCard key={p.id} id={p.id} change={p.change} reasons={p.reasons} />
      ))}
    </Screen>
  );
}
