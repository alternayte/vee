// SPDX-License-Identifier: AGPL-3.0-or-later
// The client list, most attention first (PRD "Web dashboard"): misses, low
// readiness, stalls, cards to check and unread messages.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../api";
import { ErrorText, Section, Table, Tag } from "../../ui/kit";

export type Attention = {
  skipped: number;
  lowReadiness: number;
  stalled: number;
  pendingCards: number;
  unreadMessages: number;
  score: number;
};
type Row = { clientId: string; name: string; scopes: string[]; attention: Attention };

const count = (n: number, tone: "warn" | "bad" | "brass") =>
  n > 0 ? <Tag tone={tone}>{n}</Tag> : <span className="text-muted">0</span>;

export function ClientList() {
  const q = useQuery({
    queryKey: ["clients"],
    queryFn: () => api<{ clients: Row[] }>("/coach/clients"),
    refetchInterval: 60_000,
  });
  return (
    <Section title="Clients" aside={<span className="text-xs text-muted">Most attention first</span>}>
      <ErrorText error={q.error} />
      <Table
        head={["Client", "Skipped (7 days)", "Low check-ins", "Stalled", "Cards", "Unread", "Shared"]}
        empty={q.isPending ? "Loading…" : "No clients yet. Make an invite code and give it to a client."}
        rows={(q.data?.clients ?? []).map((c) => [
          <Link
            key="n"
            to="/c/$clientId"
            params={{ clientId: c.clientId }}
            className="font-medium text-ink underline-offset-2 hover:underline"
          >
            {c.name}
          </Link>,
          count(c.attention.skipped, "warn"),
          count(c.attention.lowReadiness, "warn"),
          count(c.attention.stalled, "bad"),
          count(c.attention.pendingCards, "brass"),
          count(c.attention.unreadMessages, "brass"),
          <span key="s" className="text-muted">
            {c.scopes.join(", ") || "nothing"}
          </span>,
        ])}
      />
    </Section>
  );
}
