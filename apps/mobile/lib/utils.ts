// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The theme font classes are one font-family group, so the last one wins.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-family": ["font-inter", "font-inter-medium", "font-inter-semibold"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
