// SPDX-License-Identifier: AGPL-3.0-or-later
// The numbers rule (SDD "AI layer"): the model must not invent numbers. Every
// number in the output must appear in the input.

const NUMBER = /\d+(?:[.,]\d+)?/g;

const norm = (s: string) => String(Number(s.replace(",", ".")));

/** Every number in a value, as text, from strings and numbers at any depth. */
export function numbersIn(value: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      out.add(norm(String(v)));
      // A model may round: 0.255 can read as 0.26 or 0.3.
      for (const d of [0, 1, 2]) out.add(norm(v.toFixed(d)));
      out.add(norm(String(Math.abs(v))));
    } else if (typeof v === "string") {
      for (const m of v.match(NUMBER) ?? []) out.add(norm(m));
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === "object") {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(value);
  return out;
}

/** The numbers in `text` that are not in `input`. Empty means the text passes. */
export function inventedNumbers(text: string, input: unknown): string[] {
  const allowed = numbersIn(input);
  return [...new Set((text.match(NUMBER) ?? []).map(norm))].filter((n) => !allowed.has(n));
}

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
