// SPDX-License-Identifier: AGPL-3.0-or-later
// An invite code for a new client. The client enters it in the app and picks
// what you may see.
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api";
import { Button, ErrorText, Section } from "../../ui/kit";

export function Invites() {
  const make = useMutation({
    mutationFn: () => api<{ code: string; expiresAt: string }>("/coach/invites", { method: "POST" }),
  });
  return (
    <Section title="Invite a client">
      <p className="text-muted">
        The client enters the code in Vee under Settings → Coach. The code works once and expires in 7 days.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => make.mutate()} disabled={make.isPending}>
          Make an invite code
        </Button>
        {make.data && (
          <span className="text-lg font-semibold tracking-widest text-brass" data-testid="invite-code">
            {make.data.code}
          </span>
        )}
        {make.data && (
          <span className="text-xs text-muted">
            Expires {new Date(make.data.expiresAt).toLocaleDateString()}
          </span>
        )}
      </div>
      <ErrorText error={make.error} />
    </Section>
  );
}
