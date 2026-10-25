// SPDX-License-Identifier: AGPL-3.0-or-later
// Owner only (billing off): give the coach tier to an account, or take it back.
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import { Button, ErrorText, Input, Section } from "../../ui/kit";

export function CoachAccounts() {
  const [email, setEmail] = useState("");
  const set = useMutation({
    mutationFn: (coach: boolean) =>
      api<{ tier: string }>("/admin/coaches", { method: "POST", body: { email, coach } }),
  });
  return (
    <Section title="Coach accounts">
      <p className="text-muted">
        The person must sign in to Vee once first. Each change is in the audit log.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          type="email"
          placeholder="coach@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-72"
        />
        <Button onClick={() => set.mutate(true)} disabled={!email || set.isPending}>
          Make a coach
        </Button>
        <Button tone="plain" onClick={() => set.mutate(false)} disabled={!email || set.isPending}>
          Remove the coach tier
        </Button>
      </div>
      {set.data && (
        <p className="text-good">
          {email} is now on the {set.data.tier} tier.
        </p>
      )}
      <ErrorText error={set.error} />
    </Section>
  );
}
