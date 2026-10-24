// SPDX-License-Identifier: AGPL-3.0-or-later
// Design tokens: one source for the mobile app and the coach web app.
// Brass-and-steel dark theme, a daylight theme, one status colour per meaning.

export type ThemeName = "dark" | "light";

export const COLOR_ROLES = [
  "background",
  "surface",
  "surface-raised",
  "border",
  "text",
  "text-muted",
  "accent",
  "accent-text",
  "good",
  "warning",
  "critical",
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

export const colors: Record<ThemeName, Record<ColorRole, string>> = {
  dark: {
    background: "#0e1114",
    surface: "#171b20",
    "surface-raised": "#20262d",
    border: "#323a43",
    text: "#e8eaed",
    "text-muted": "#9aa3ad",
    accent: "#c9a253",
    "accent-text": "#14110a",
    good: "#5cb87a",
    warning: "#e0a43c",
    critical: "#e5675c",
  },
  light: {
    background: "#f4f2ee",
    surface: "#ffffff",
    "surface-raised": "#ebe8e2",
    border: "#c9c4ba",
    text: "#16191d",
    "text-muted": "#535a63",
    accent: "#7d5d1c",
    "accent-text": "#ffffff",
    good: "#22693a",
    warning: "#8a5a00",
    critical: "#b3261e",
  },
};

/** Pairs that must pass WCAG AA (4.5:1) in both themes. */
export const CONTRAST_PAIRS: [fg: ColorRole, bg: ColorRole][] = [
  ["text", "background"],
  ["text", "surface"],
  ["text", "surface-raised"],
  ["text-muted", "background"],
  ["text-muted", "surface"],
  ["accent", "background"],
  ["accent", "surface"],
  ["accent-text", "accent"],
  ["good", "surface"],
  ["warning", "surface"],
  ["critical", "surface"],
];

export const type = {
  family: "Inter",
  /** Tabular figures for every number, so counters do not jump. */
  numeric: "tabular-nums",
  size: { xs: 12, sm: 14, base: 16, lg: 20, xl: 24, "2xl": 32, display: 56, dial: 96 },
} as const;

export const motion = {
  duration: { fast: 120, base: 160, max: 200 },
  easing: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

export const radius = { sm: 6, md: 10, lg: 16, full: 9999 } as const;

/** Haptic patterns. They fire for user events only, never for passive events. */
export const haptics = {
  tick: { kind: "impact", style: "light" },
  confirm: { kind: "notification", style: "success" },
  rungUp: { kind: "notification", style: "success", repeat: 2 },
  warning: { kind: "notification", style: "warning" },
} as const;

export type HapticName = keyof typeof haptics;

function channel(hex: string, i: number): number {
  const v = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The Uniwind theme CSS: every colour role as `--color-*` in both themes. */
export function themeCss(): string {
  const block = (t: ThemeName) =>
    [`    @variant ${t} {`, ...COLOR_ROLES.map((r) => `      --color-${r}: ${colors[t][r]};`), "    }"].join(
      "\n",
    );
  return [
    "/* SPDX-License-Identifier: AGPL-3.0-or-later */",
    "/* Generated from packages/tokens/src/index.ts by `bun run css`. Do not edit. */",
    "@layer theme {",
    "  :root {",
    block("dark"),
    block("light"),
    "  }",
    "}",
    "",
  ].join("\n");
}
