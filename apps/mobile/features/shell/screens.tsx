// SPDX-License-Identifier: AGPL-3.0-or-later
// Tab screens before the user has a plan. Each feature step replaces its tab
// with the real screen.
import { EmptyState, Screen } from "@/components/screen";

export function TodayScreen() {
  return (
    <Screen title="Today">
      <EmptyState text="You have no plan yet. Set up your body, kit and time to get your first session." />
    </Screen>
  );
}

export function PlanScreen() {
  return (
    <Screen title="Plan">
      <EmptyState text="Your programme shows here after setup." />
    </Screen>
  );
}

export function BodyScreen() {
  return (
    <Screen title="Body">
      <EmptyState text="Your tests, measurements and charts show here." />
    </Screen>
  );
}

export function FoodScreen() {
  return (
    <Screen title="Food">
      <EmptyState text="Your portions, meals and shopping list show here." />
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
