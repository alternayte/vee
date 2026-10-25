// SPDX-License-Identifier: AGPL-3.0-or-later
// The Live Update notification for the session runner (Android only).
import { type EventSubscription, requireOptionalNativeModule } from "expo";

export type LiveParams = {
  sessionTitle: string;
  exercise: string;
  setLabel: string;
  /** ISO time the rest ends; null clears it. */
  restEndsAt?: string | null;
  /** Exercises done. */
  progress: number;
  /** Exercises in the session: one segment each. */
  segments: number;
};

type Native = {
  start(p: LiveParams): void;
  update(p: Partial<LiveParams>): void;
  end(): void;
  addListener(event: "onAction", fn: (e: { action: "done" | "add30" }) => void): EventSubscription;
};

const native = requireOptionalNativeModule<Native>("VeeLive");

export const live = {
  start: (p: LiveParams) => native?.start(p),
  update: (p: Partial<LiveParams>) => native?.update(p),
  end: () => native?.end(),
  onAction: (fn: (action: "done" | "add30") => void) => native?.addListener("onAction", (e) => fn(e.action)),
};
