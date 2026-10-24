// SPDX-License-Identifier: AGPL-3.0-or-later
// Dial math. Loads are kg values from loadOptions, lightest first.

/** Above this jump ratio, the big-jump policy applies (SDD "One step up"). */
export const JUMP_LIMIT = 0.15;

const EPS = 1e-9;

export function jumpRatio(current: number, next: number): number {
  return next / current - 1;
}

export function isBigJump(current: number, next: number): boolean {
  return jumpRatio(current, next) > JUMP_LIMIT + EPS;
}

export function nextLoad(options: number[], current: number): number | undefined {
  return options.find((l) => l > current + EPS);
}

export function prevLoad(options: number[], current: number): number | undefined {
  return options.findLast((l) => l < current - EPS);
}

/** The nearest option at or below `load`, else the lightest option. */
export function snapLoad(options: number[], load: number): number | undefined {
  return options.findLast((l) => l <= load + EPS) ?? options[0];
}
