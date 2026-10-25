// SPDX-License-Identifier: AGPL-3.0-or-later
import "./app.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CoachAccounts } from "./features/admin/coaches";
import { type Me, RequireCoach, SignOut, useMe } from "./features/auth/session";
import { ClientDetail } from "./features/clients/detail";
import { ClientList } from "./features/clients/list";
import { Invites } from "./features/invites/invites";

function Shell({ me }: { me: Me }) {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between gap-3 border-b border-rule bg-panel px-4 py-2">
        <Link to="/" className="font-semibold text-ink">
          Vee <span className="text-brass">coach</span>
        </Link>
        <nav className="flex items-center gap-3">
          {me.tier === "owner" && (
            <Link to="/owner" className="text-muted hover:text-ink">
              Owner
            </Link>
          )}
          <SignOut />
        </nav>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

const root = createRootRoute({ component: () => <RequireCoach>{(me) => <Shell me={me} />}</RequireCoach> });

const home = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: () => (
    <>
      <ClientList />
      <Invites />
    </>
  ),
});

const client = createRoute({
  getParentRoute: () => root,
  path: "/c/$clientId",
  component: function Client() {
    const { clientId } = useParams({ from: "/c/$clientId" });
    // The root route signs the coach in first, so the query is in the cache.
    const me = useMe().data;
    return <ClientDetail clientId={clientId} me={me?.userId ?? ""} />;
  },
});

const owner = createRoute({ getParentRoute: () => root, path: "/owner", component: CoachAccounts });

const router = createRouter({ routeTree: root.addChildren([home, client, owner]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queries = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000 } } });

const el = document.getElementById("root");
if (el)
  createRoot(el).render(
    <StrictMode>
      <QueryClientProvider client={queries}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
