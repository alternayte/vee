// SPDX-License-Identifier: AGPL-3.0-or-later
// One client (PRD "Review"): only what the client shared. Sessions and sets to
// comment on, ladders, check-ins, tests and the plan; cards to approve or
// reject; plan changes the engine accepts now; and the message thread.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import catalogueJson from "@vee/catalogue/catalogue.v1.json";
import { useState } from "react";
import { api } from "../../api";
import { Button, ErrorText, Input, Section, Select, Table, Tag, TextArea } from "../../ui/kit";

const names = new Map(
  (catalogueJson as unknown as { exercises: { id: string; names: { en: string } }[] }).exercises.map((e) => [
    e.id,
    e.names.en,
  ]),
);
const exercise = (id: string) => names.get(id) ?? id;
const PORTION: Record<string, string> = {
  palm: "Protein (palms)",
  fist: "Vegetables (fists)",
  cupped: "Carbs (cupped hands)",
  thumb: "Fats (thumbs)",
};

type SetRow = {
  id: string;
  exercise: string;
  reps?: number;
  seconds?: number;
  kg?: number;
  side?: string;
  effort: string;
};
type SessionRow = {
  id: string;
  date: string;
  kind: string;
  day?: string;
  status: string;
  readiness?: string;
  sets: SetRow[];
};
type Change =
  | { kind: "swap"; dayType: string; family: string; to: string }
  | { kind: "sets"; dayType: string; exerciseId: string; sets: number }
  | { kind: "deload" };
type Card = {
  id: string;
  source: string;
  change: (Change & { why?: string }) | null;
  validation: { text: string }[];
  status: string;
  approved_by: string | null;
  created_at: string;
};
type Plan = {
  goal: string;
  days: {
    day: string;
    name: string;
    minutes: number;
    items: {
      exerciseId: string;
      exercise: string;
      role: string;
      sets: number;
      target: { unit: string; low: number; high: number };
      kg?: number;
    }[];
  }[];
  accepted: {
    swapOptions: { dayType: string; family: string; current: string; options: string[] }[];
    setsOptions: { dayType: string; exerciseId: string; sets: number }[];
    deloadAllowed: boolean;
  };
};
type Detail = {
  clientId: string;
  name: string;
  scopes: string[];
  note?: string;
  training?: {
    summary: { done: number; skipped: number; mainDone: number; setsLogged: number };
    sessions: SessionRow[];
    comments: { id: string; target_type: string; target_id: string; body: string; created_at: string }[];
    ladders: {
      stalledAtSessions: number;
      ladders: {
        family: string;
        exercise: string;
        rung: number;
        kg?: number;
        holdS?: number;
        best?: number;
        sessionsWithoutProgress: number;
      }[];
    };
    checkins: { date: string; energy: number; soreness: number; sleep: string; readiness: string }[];
    tests: { date: string; item: string; value: number; kg?: number }[];
    plan: Plan | { error: string };
    reviews: { week: string; words?: string; focus?: string }[];
    cards: Card[];
  };
  food?: { daysLogged: number; days: number; percentOfTarget: Record<string, number> };
  body?: {
    weighIns: number;
    slopeKgPerWeek: number | null;
    first?: { date: string; kg: number };
    last?: { date: string; kg: number };
  };
};

function describe(c: Change): string {
  if (c.kind === "deload") return "Start a deload week now";
  if (c.kind === "sets")
    return `Day ${c.dayType}: ${exercise(c.exerciseId)} to ${c.sets} ${c.sets === 1 ? "set" : "sets"}`;
  return `Day ${c.dayType}: ${exercise(c.to)} instead`;
}

const setText = (s: SetRow) =>
  [
    s.reps !== undefined ? `${s.reps} reps` : "",
    s.seconds !== undefined ? `${s.seconds} s` : "",
    s.kg !== undefined ? `${s.kg} kg` : "",
    s.side ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

function useAct(clientId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["client", clientId] });
    void qc.invalidateQueries({ queryKey: ["clients"] });
  };
}

function CommentBox({
  clientId,
  targetType,
  targetId,
}: {
  clientId: string;
  targetType: "session" | "set";
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const done = useAct(clientId);
  const send = useMutation({
    mutationFn: () =>
      api(`/coach/clients/${clientId}/comments`, { method: "POST", body: { targetType, targetId, body } }),
    onSuccess: () => {
      setBody("");
      setOpen(false);
      done();
    },
  });
  if (!open)
    return (
      <button type="button" className="text-xs text-brass hover:underline" onClick={() => setOpen(true)}>
        Comment
      </button>
    );
  return (
    <div className="flex flex-col gap-1">
      <TextArea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Your comment" />
      <div className="flex gap-2">
        <Button onClick={() => send.mutate()} disabled={!body.trim() || send.isPending}>
          Send
        </Button>
        <Button tone="plain" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <ErrorText error={send.error} />
    </div>
  );
}

function Sessions({ d }: { d: Detail }) {
  const t = d.training;
  if (!t) return null;
  const commentsOn = (id: string) => t.comments.filter((c) => c.target_id === id);
  return (
    <Section
      title="Sessions"
      aside={
        <span className="text-xs text-muted">
          Last 28 days: {t.summary.mainDone} main sessions, {t.summary.skipped} skipped,{" "}
          {t.summary.setsLogged} sets
        </span>
      }
    >
      <Table
        head={["Date", "Session", "Readiness", "Sets", ""]}
        empty="No sessions in the last 8 weeks."
        rows={t.sessions.map((s) => [
          s.date,
          <span key="k">
            {s.kind}
            {s.day ? ` ${s.day}` : ""} {s.status === "skipped" ? <Tag tone="warn">skipped</Tag> : null}
          </span>,
          s.readiness ? (
            <Tag key="r" tone={s.readiness === "full" ? "good" : "warn"}>
              {s.readiness}
            </Tag>
          ) : (
            ""
          ),
          <ul key="s" className="flex flex-col gap-1">
            {s.sets.map((x) => (
              <li key={x.id} className="flex flex-wrap items-baseline gap-2">
                <span>{x.exercise}</span>
                <span className="text-muted">
                  {setText(x)} · {x.effort}
                </span>
                {commentsOn(x.id).map((c) => (
                  <span key={c.id} className="text-brass">
                    “{c.body}”
                  </span>
                ))}
                <CommentBox clientId={d.clientId} targetType="set" targetId={x.id} />
              </li>
            ))}
          </ul>,
          <div key="c" className="flex flex-col gap-1">
            {commentsOn(s.id).map((c) => (
              <span key={c.id} className="text-brass">
                “{c.body}”
              </span>
            ))}
            <CommentBox clientId={d.clientId} targetType="session" targetId={s.id} />
          </div>,
        ])}
      />
    </Section>
  );
}

function Cards({ d }: { d: Detail }) {
  const done = useAct(d.clientId);
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "reject" }) =>
      api(`/coach/clients/${d.clientId}/cards/${v.id}`, { method: "POST", body: { decision: v.decision } }),
    onSuccess: done,
  });
  const cards = d.training?.cards ?? [];
  return (
    <Section title="Plan-change cards">
      <ErrorText error={decide.error} />
      <Table
        head={["Change", "From", "Status", ""]}
        empty="No cards."
        rows={cards.map((c) => [
          <div key="c" className="flex flex-col gap-1">
            <span className="font-medium">{c.change ? describe(c.change) : "Unknown change"}</span>
            {c.change?.why && <span className="text-muted">{c.change.why}</span>}
          </div>,
          c.source,
          <span key="s" className="flex gap-1">
            <Tag tone={c.status === "pending" ? "brass" : c.status === "accepted" ? "good" : "muted"}>
              {c.status}
            </Tag>
            {c.approved_by && c.source !== "coach" && <Tag tone="good">you approve</Tag>}
          </span>,
          c.status === "pending" && c.source !== "coach" ? (
            <span key="a" className="flex gap-2">
              {!c.approved_by && (
                <Button onClick={() => decide.mutate({ id: c.id, decision: "approve" })}>Approve</Button>
              )}
              <Button tone="plain" onClick={() => decide.mutate({ id: c.id, decision: "reject" })}>
                Reject
              </Button>
            </span>
          ) : (
            ""
          ),
        ])}
      />
    </Section>
  );
}

function Propose({ d }: { d: Detail }) {
  const plan = d.training?.plan;
  const [why, setWhy] = useState("");
  const [pick, setPick] = useState(0);
  const done = useAct(d.clientId);
  const send = useMutation({
    mutationFn: (change: Change) =>
      api(`/coach/clients/${d.clientId}/changes`, { method: "POST", body: { change, why } }),
    onSuccess: () => {
      setWhy("");
      done();
    },
  });
  if (!plan || "error" in plan) return null;
  const a = plan.accepted;
  const options: Change[] = [
    ...a.swapOptions.flatMap((o) =>
      o.options.map((to): Change => ({ kind: "swap", dayType: o.dayType, family: o.family, to })),
    ),
    ...a.setsOptions.map(
      (o): Change => ({ kind: "sets", dayType: o.dayType, exerciseId: o.exerciseId, sets: o.sets }),
    ),
    ...(a.deloadAllowed ? [{ kind: "deload" } as Change] : []),
  ];
  const chosen = options[pick];
  return (
    <Section
      title="Propose a plan change"
      aside={<span className="text-xs text-muted">Only changes the engine accepts now</span>}
    >
      <p className="text-muted">
        The client sees a card and accepts or rejects it, unless they let your changes apply without asking.
      </p>
      {options.length === 0 ? (
        <p className="text-muted">The engine accepts no change now.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Select value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label="Change">
            {options.map((c, n) => (
              <option key={JSON.stringify(c)} value={n}>
                {describe(c)}
              </option>
            ))}
          </Select>
          <Input
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Why, in one sentence, to the client"
          />
          <div>
            <Button
              onClick={() => chosen && send.mutate(chosen)}
              disabled={!why.trim() || !chosen || send.isPending}
            >
              Propose
            </Button>
          </div>
        </div>
      )}
      {send.isSuccess && <p className="text-good">The card is on the client's phone after the next sync.</p>}
      <ErrorText error={send.error} />
    </Section>
  );
}

function Thread({ d, me }: { d: Detail; me: string }) {
  const [body, setBody] = useState("");
  const q = useQuery({
    queryKey: ["thread", d.clientId],
    queryFn: () =>
      api<{ messages: { id: string; author_id: string; body: string | null; created_at: string }[] }>(
        `/coach/clients/${d.clientId}/messages`,
      ),
    refetchInterval: 30_000,
  });
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: () => api(`/coach/clients/${d.clientId}/messages`, { method: "POST", body: { body } }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["thread", d.clientId] });
    },
  });
  return (
    <Section title="Messages">
      <ErrorText error={q.error} />
      <ol className="flex flex-col gap-2">
        {(q.data?.messages ?? []).map((m) => (
          <li
            key={m.id}
            className={
              m.author_id === me
                ? "self-end rounded-md bg-raised p-2"
                : "self-start rounded-md border border-rule p-2"
            }
          >
            <p>{m.body}</p>
            <p className="text-xs text-muted">{new Date(m.created_at).toLocaleString()}</p>
          </li>
        ))}
      </ol>
      <TextArea value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Message ${d.name}`} />
      <div>
        <Button onClick={() => send.mutate()} disabled={!body.trim() || send.isPending}>
          Send
        </Button>
      </div>
      <ErrorText error={send.error} />
    </Section>
  );
}

export function ClientDetail({ clientId, me }: { clientId: string; me: string }) {
  const q = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => api<Detail>(`/coach/clients/${clientId}`),
  });
  if (q.error)
    return (
      <div className="flex flex-col gap-2">
        <ErrorText error={q.error} />
        <Link to="/" className="text-brass">
          Back to the clients
        </Link>
      </div>
    );
  const d = q.data;
  if (!d) return <p className="text-muted">Loading…</p>;
  const t = d.training;
  const plan = t?.plan && !("error" in t.plan) ? t.plan : undefined;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link to="/" className="text-brass">
          ← Clients
        </Link>
        <h1 className="text-xl font-semibold">{d.name}</h1>
        <span className="text-xs text-muted">Shares: {d.scopes.join(", ") || "nothing"}</span>
      </div>
      {d.note && <p className="text-muted">{d.note}</p>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {t && <Cards d={d} />}
          {t && <Propose d={d} />}
          <Sessions d={d} />
          {t && (
            <Section
              title="Ladders"
              aside={
                <span className="text-xs text-muted">Stalled at {t.ladders.stalledAtSessions} sessions</span>
              }
            >
              <Table
                head={["Ladder", "Exercise", "Rung", "Load or hold", "Best", "No progress"]}
                empty="No ladders yet."
                rows={t.ladders.ladders.map((l) => [
                  l.family,
                  l.exercise,
                  l.rung,
                  l.kg !== undefined ? `${l.kg} kg` : l.holdS !== undefined ? `${l.holdS} s` : "",
                  l.best ?? "",
                  l.sessionsWithoutProgress >= t.ladders.stalledAtSessions ? (
                    <Tag key="x" tone="bad">
                      {l.sessionsWithoutProgress}
                    </Tag>
                  ) : (
                    l.sessionsWithoutProgress
                  ),
                ])}
              />
            </Section>
          )}
          {plan && (
            <Section title="Plan" aside={<span className="text-xs text-muted">Goal: {plan.goal}</span>}>
              <Table
                head={["Day", "Exercise", "Role", "Sets", "Target"]}
                empty="No plan."
                rows={plan.days.flatMap((day) =>
                  day.items.map((i, n) => [
                    n === 0 ? `${day.day} · ${day.name} · ${day.minutes} min` : "",
                    i.exercise,
                    i.role,
                    i.sets,
                    `${i.target.low === i.target.high ? i.target.low : `${i.target.low}–${i.target.high}`} ${i.target.unit === "seconds" ? "s" : i.target.unit}${i.kg !== undefined ? ` at ${i.kg} kg` : ""}`,
                  ]),
                )}
              />
            </Section>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Thread d={d} me={me} />
          {t && (
            <Section title="Check-ins (28 days)">
              <Table
                head={["Date", "Energy", "Soreness", "Sleep", "Readiness"]}
                empty="No check-ins."
                rows={t.checkins.map((c) => [c.date, c.energy, c.soreness, c.sleep, c.readiness])}
              />
            </Section>
          )}
          {t && (
            <Section title="Tests">
              <Table
                head={["Date", "Test", "Result"]}
                empty="No tests."
                rows={t.tests.map((x) => [
                  x.date,
                  x.item,
                  `${x.value}${x.kg !== undefined ? ` at ${x.kg} kg` : ""}`,
                ])}
              />
            </Section>
          )}
          {d.food && (
            <Section title="Food (28 days)">
              <p>
                Logged on {d.food.daysLogged} of {d.food.days} days.
              </p>
              {d.food.daysLogged > 0 && (
                <Table
                  head={["Portion", "Of target"]}
                  empty=""
                  rows={Object.entries(d.food.percentOfTarget).map(([k, v]) => [PORTION[k] ?? k, `${v}%`])}
                />
              )}
            </Section>
          )}
          {d.body && (
            <Section title="Weight">
              <p>
                {d.body.weighIns} weigh-ins in 28 days.{" "}
                {d.body.slopeKgPerWeek === null
                  ? "Not enough for a trend."
                  : `Trend: ${d.body.slopeKgPerWeek} kg a week.`}
              </p>
            </Section>
          )}
          {t && t.reviews.length > 0 && (
            <Section title="Weekly reviews">
              {[...t.reviews].reverse().map((r) => (
                <div key={r.week} className="flex flex-col gap-1 border-b border-rule pb-2">
                  <span className="text-xs text-muted">Week to {r.week}</span>
                  {r.words && <p>{r.words}</p>}
                  {r.focus && <p className="text-brass">{r.focus}</p>}
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
