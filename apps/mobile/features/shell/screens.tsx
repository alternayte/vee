// SPDX-License-Identifier: AGPL-3.0-or-later
// Tabs whose feature steps come later. Each feature step replaces its tab
// with the real screen.
import { EmptyState, Screen } from "@/components/screen";

export function BodyScreen() {
  return (
    <Screen title="Body">
      <EmptyState text="Your tests, measurements and charts show here." />
    </Screen>
  );
}

export function CoachScreen() {
  return (
    <Screen title="Coach">
      <EmptyState text="AI and coach messages need an account and a connection." />
    </Screen>
  );
}
