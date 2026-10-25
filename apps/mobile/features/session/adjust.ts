// SPDX-License-Identifier: AGPL-3.0-or-later
// "Adjust today" answers (minutes, focus) held until the session starts.
import { create } from "zustand";
import type { TodayAdjustment } from "./data";

export const useTodayAdjust = create<{
  adjust: TodayAdjustment;
  set: (a: TodayAdjustment) => void;
  clear: () => void;
}>((set) => ({
  adjust: {},
  set: (adjust) => set({ adjust }),
  clear: () => set({ adjust: {} }),
}));
