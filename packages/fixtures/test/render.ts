// SPDX-License-Identifier: AGPL-3.0-or-later
// Plain-text views of plans and prescriptions, so a golden diff is easy to review.
import type { Catalogue } from "@vee/catalogue";
import {
  type PrescribedItem,
  type Prescription,
  type Programme,
  type TemplateItem,
  weeklyVolume,
} from "@vee/engine";

const target = (i: TemplateItem | PrescribedItem) =>
  i.target.low === i.target.high
    ? `${i.target.low} ${i.target.unit}`
    : `${i.target.low}–${i.target.high} ${i.target.unit}`;

function line(i: TemplateItem | PrescribedItem): string {
  const parts = [`${i.order}. ${i.exerciseId} [${i.role}] ${i.sets} × ${target(i)}`];
  if (i.loadKg !== undefined) parts.push(`@ ${i.loadKg} kg`);
  if ("band" in i && i.band) parts.push(`band ${i.band.bandId}/${i.band.setting}`);
  if ("tempo" in i && i.tempo) parts.push(`tempo ${i.tempo}`);
  if (i.pairGroup !== undefined) parts.push(`pair ${i.pairGroup}`);
  return `  ${parts.join(" ")}`;
}

const rules = (rs: { ruleId: string; inputs: Record<string, number | string> }[]) =>
  rs.map((r) => (r.inputs.exercise ? `${r.ruleId}(${r.inputs.exercise})` : r.ruleId)).join(", ");

export function renderProgramme(p: Programme, cat: Pick<Catalogue, "exercises">): string {
  const out: string[] = [];
  for (const t of p.templates) {
    out.push(`${t.dayType} ${t.name} — ${t.estimatedMinutes} min`);
    out.push(...t.items.map(line));
    if (t.reasons.length > 0) out.push(`  reasons: ${rules(t.reasons)}`);
  }
  const v = weeklyVolume(p.templates, cat);
  out.push(
    `volume: ${Object.entries(v)
      .map(([g, n]) => `${g} ${Math.round(n * 10) / 10}`)
      .join(", ")}`,
  );
  return out.join("\n");
}

export function renderPrescription(p: Prescription): string {
  const out = [
    `${p.kind} ${p.dayType ?? ""} readiness=${p.readinessMode} deload=${p.deload} — ${p.estimatedMinutes} min`,
  ];
  if (p.warmup.length > 0) out.push("  warm-up:", ...p.warmup.map(line));
  out.push(...p.items.map(line));
  if (p.reasons.length > 0) out.push(`  reasons: ${rules(p.reasons)}`);
  return out.join("\n");
}
