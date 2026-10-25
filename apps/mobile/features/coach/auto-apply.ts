// SPDX-License-Identifier: AGPL-3.0-or-later
// "Apply coach changes without asking" (SDD "Coach access"): for a coach with
// auto-apply on, the phone applies that coach's changes and approvals when
// they sync. The engine checks each one against the plan as it is now first
// (I4); a refused change stays a card with the reason.
import { toCompilableQuery } from "@powersync/drizzle-driver";
import { useQuery } from "@powersync/react";
import { type PlanChange, validateProposal } from "@vee/engine";
import { ai_proposals, coach_links } from "@vee/schema";
import { and, eq, isNull } from "drizzle-orm";
import { useEffect, useRef } from "react";
import { db } from "@/features/db/database";
import { readEngineInput, readProgramme, saveProgramme } from "@/features/training/data";

const setStatus = async (id: string, status: string) =>
  await db
    .update(ai_proposals)
    .set({ status, updated_at: new Date().toISOString() })
    .where(eq(ai_proposals.id, id));

export function useCoachAutoApply() {
  const { data: links } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(coach_links)
        .where(
          and(
            eq(coach_links.status, "active"),
            eq(coach_links.auto_apply, 1),
            isNull(coach_links.deleted_at),
          ),
        ),
    ),
  );
  const { data: pending } = useQuery(
    toCompilableQuery(
      db
        .select()
        .from(ai_proposals)
        .where(and(eq(ai_proposals.status, "pending"), isNull(ai_proposals.deleted_at))),
    ),
  );
  const running = useRef(false);

  useEffect(() => {
    const coaches = new Set(links.map((l) => l.coach_id));
    const due = pending.filter((p) => p.approved_by && coaches.has(p.approved_by));
    if (due.length === 0 || running.current) return;
    running.current = true;
    void (async () => {
      try {
        for (const p of due) {
          const input = await readEngineInput();
          const current = await readProgramme();
          if (!input?.programme || !current || !p.change) continue;
          const {
            why: _w,
            week: _k,
            ...change
          } = JSON.parse(p.change) as PlanChange & { why?: string; week?: string };
          const v = validateProposal(input, change as PlanChange);
          if (!v.ok) {
            await setStatus(p.id, "refused");
            continue;
          }
          await saveProgramme({ ...v.programme, id: current.id });
          await setStatus(p.id, "accepted");
        }
      } finally {
        running.current = false;
      }
    })();
  }, [links, pending]);
}
