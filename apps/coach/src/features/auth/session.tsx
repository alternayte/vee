// SPDX-License-Identifier: AGPL-3.0-or-later
// Sign-in for coaches: the magic link opens in this browser and comes back
// here with a session cookie. The dashboard needs the coach (or owner) tier.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { ApiError, api } from "../../api";
import { Button, ErrorText, Input } from "../../ui/kit";

export type Me = { userId: string; tier: string };

export const useMe = () =>
  useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/coach/me"),
    retry: false,
  });

function SignIn() {
  const [email, setEmail] = useState("");
  const send = useMutation({
    mutationFn: () =>
      api("/api/auth/sign-in/magic-link", {
        method: "POST",
        body: { email, callbackURL: `${window.location.origin}/` },
      }),
  });
  return (
    <main className="mx-auto mt-24 flex max-w-sm flex-col gap-3 px-4">
      <h1 className="text-xl font-semibold">Vee for coaches</h1>
      {send.isSuccess ? (
        <p className="text-muted">Vee sent a link to {email}. Open it in this browser.</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <label htmlFor="email" className="flex flex-col gap-1 text-muted">
            Email
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={send.isPending}>
            Send the sign-in link
          </Button>
          <ErrorText error={send.error} />
        </form>
      )}
    </main>
  );
}

export function SignOut() {
  const qc = useQueryClient();
  return (
    <Button
      tone="plain"
      onClick={async () => {
        await api("/api/auth/sign-out", { method: "POST", body: {} }).catch(() => undefined);
        qc.clear();
        window.location.assign("/");
      }}
    >
      Sign out
    </Button>
  );
}

/** Shows the sign-in until there is a coach session. */
export function RequireCoach({ children }: { children: (me: Me) => ReactNode }) {
  const me = useMe();
  if (me.isPending) return <p className="p-6 text-muted">Loading…</p>;
  if (me.error instanceof ApiError && me.error.status === 403)
    return (
      <main className="mx-auto mt-24 flex max-w-sm flex-col gap-3 px-4">
        <h1 className="text-xl font-semibold">This account is not a coach account</h1>
        <p className="text-muted">Ask the owner of this Vee server to make you a coach.</p>
        <SignOut />
      </main>
    );
  if (me.error || !me.data) return <SignIn />;
  return <>{children(me.data)}</>;
}
