// SPDX-License-Identifier: AGPL-3.0-or-later
// V7: human coaching. Every coach route as a coach without a link is 403,
// scopes limit what a coach reads, every coach read is audited (I8), a
// revoke ends access, and the client cannot forge links, cards or messages.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exportPKCS8, generateKeyPair } from "jose";
import type { App } from "../src/app";
import { freshDatabase, OWNER_EMAIL, query, request, signIn, startApp } from "./harness";
import { insert, onboard } from "./onboard";

let app: App;
const pushes: { url: string; body: string }[] = [];
const fcm = (async (url: string, init: RequestInit) => {
  pushes.push({ url, body: String(init.body) });
  if (url.includes("oauth2")) return Response.json({ access_token: "fcm-token", expires_in: 3600 });
  return Response.json({ name: "projects/p/messages/1" });
}) as unknown as typeof fetch;

type User = { token: string; userId: string };
let owner: User;
let coachA: User;
let coachB: User;
let client: User;
let plan: Awaited<ReturnType<typeof onboard>>;

const call = (path: string, who: User, method = "GET", body?: unknown) =>
  request(app, path, {
    method,
    token: who.token,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const upload = (who: User, batch: unknown[]) => call("/sync/upload", who, "POST", { batch });

const audits = async (actor: string) =>
  Number(
    (await query<{ n: string }>("SELECT count(*) AS n FROM audit_log WHERE actor_id = $1", [actor]))[0]?.n,
  );

async function link(scopes: string[], who = client, by = coachA) {
  const inv = (await (await call("/coach/invites", by, "POST")).json()) as { code: string };
  const r = await call("/coach-links/accept", who, "POST", { code: inv.code, scopes });
  return {
    status: r.status,
    body: (await r.json()) as { linkId: string; coachName: string; error?: string },
    code: inv.code,
  };
}

beforeAll(async () => {
  await freshDatabase();
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const sa = {
    project_id: "p",
    client_email: "push@p.iam.gserviceaccount.com",
    private_key: await exportPKCS8(privateKey),
  };
  app = await startApp({ FCM_SERVICE_ACCOUNT: JSON.stringify(sa) }, { pushFetch: fcm });
  owner = await signIn(app, OWNER_EMAIL);
  coachA = await signIn(app, "coach-a@example.test");
  coachB = await signIn(app, "coach-b@example.test");
  client = await signIn(app, "client@example.test");
  plan = await onboard(client.userId);
  for (const email of ["coach-a@example.test", "coach-b@example.test"])
    expect((await call("/admin/coaches", owner, "POST", { email, coach: true })).status).toBe(200);
});

afterAll(async () => {
  await app.close();
});

describe("coach tier", () => {
  test("only the owner grants it, and each grant is audited", async () => {
    const r = await call("/admin/coaches", client, "POST", { email: "coach-a@example.test", coach: false });
    expect(r.status).toBe(403);
    const rows = await query<{ action: string }>("SELECT action FROM audit_log WHERE actor_id = $1", [
      owner.userId,
    ]);
    expect(rows.filter((x) => x.action === "grant_coach")).toHaveLength(2);
  });

  test("a plus user cannot open the dashboard routes", async () => {
    expect((await call("/coach/clients", client)).status).toBe(403);
    expect((await call("/coach/invites", client, "POST")).status).toBe(403);
  });
});

describe("invites", () => {
  test("a code shows the coach's name, links once, and syncs the link to the client", async () => {
    const inv = (await (await call("/coach/invites", coachA, "POST")).json()) as { code: string };
    const preview = await call(`/coach-links/invite/${inv.code.toLowerCase()}`, client);
    expect(await preview.json()).toEqual({ coachName: "coach-a@example.test" });
    const ok = await call("/coach-links/accept", client, "POST", { code: inv.code, scopes: ["training"] });
    expect(ok.status).toBe(200);
    const rows = await query<{ user_id: string; coach_id: string; status: string; scopes: string }>(
      "SELECT user_id, coach_id, status, scopes FROM coach_links WHERE client_id = $1",
      [client.userId],
    );
    expect(rows).toEqual([
      { user_id: client.userId, coach_id: coachA.userId, status: "active", scopes: '["training"]' },
    ]);
    const again = await call("/coach-links/accept", coachB, "POST", { code: inv.code, scopes: [] });
    expect(again.status).toBe(404);
  });

  test("a coach cannot be their own client", async () => {
    expect((await link([], coachA, coachA)).status).toBe(409);
  });
});

describe("coach access", () => {
  test("the coach reads only the granted scopes, and each read is audited with the last access", async () => {
    const before = await audits(coachA.userId);
    const r = await call(`/coach/clients/${client.userId}`, coachA);
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.training).toBeDefined();
    expect(body.food).toBeUndefined();
    expect(body.body).toBeUndefined();
    expect(await audits(coachA.userId)).toBe(before + 1);
    const l = await query<{ last_access_at: string | null }>(
      "SELECT last_access_at FROM coach_links WHERE coach_id = $1 AND client_id = $2",
      [coachA.userId, client.userId],
    );
    expect(l[0]?.last_access_at).toBeTruthy();
  });

  test("a coach with no link gets 403 on every client route", async () => {
    const id = client.userId;
    const item = plan.templates[0]?.items[0];
    const routes: [string, string, unknown?][] = [
      [`/coach/clients/${id}`, "GET"],
      [`/coach/clients/${id}/messages`, "GET"],
      [`/coach/clients/${id}/messages`, "POST", { body: "hi" }],
      [`/coach/clients/${id}/comments`, "POST", { targetType: "session", targetId: "x", body: "hi" }],
      [
        `/coach/clients/${id}/changes`,
        "POST",
        { change: { kind: "sets", dayType: "A", exerciseId: item?.exerciseId, sets: 1 }, why: "x" },
      ],
      [`/coach/clients/${id}/cards/x`, "POST", { decision: "reject" }],
    ];
    for (const [path, method, body] of routes) {
      const r = await call(path, coachB, method, body);
      expect([path, r.status]).toEqual([path, 403]);
    }
    const list = (await (await call("/coach/clients", coachB)).json()) as { clients: unknown[] };
    expect(list.clients).toEqual([]);
  });

  test("a coach change is a pending coach card, and the client gets a push without the text", async () => {
    await call("/push/token", client, "POST", { token: "device-token-0123456789" });
    pushes.length = 0;
    const item = plan.templates[0]?.items[0];
    const r = await call(`/coach/clients/${client.userId}/changes`, coachA, "POST", {
      change: { kind: "sets", dayType: "A", exerciseId: item?.exerciseId, sets: 1 },
      why: "A short week.",
    });
    expect(r.status).toBe(200);
    const cards = await query<{ source: string; status: string; approved_by: string }>(
      "SELECT source, status, approved_by FROM ai_proposals WHERE user_id = $1 AND source = 'coach'",
      [client.userId],
    );
    expect(cards).toEqual([{ source: "coach", status: "pending", approved_by: coachA.userId }]);
    const sent = pushes.find((p) => p.url.includes("messages:send"));
    expect(JSON.parse(sent?.body ?? "{}").message).toMatchObject({
      token: "device-token-0123456789",
      notification: { title: "Your coach proposes a plan change" },
    });
    expect(sent?.body).not.toContain("short week");
  });

  test("a change the engine refuses is 409 with the reason", async () => {
    const r = await call(`/coach/clients/${client.userId}/changes`, coachA, "POST", {
      change: { kind: "deload" },
      why: "x",
    });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { message: string }).message).toMatch(/deload needs/);
  });

  test("the coach approves or rejects an AI card, but not a coach card", async () => {
    const at = new Date().toISOString();
    const ai = (id: string) => ({
      id,
      user_id: client.userId,
      source: "review",
      change: JSON.stringify({ kind: "deload", why: "x" }),
      validation: "[]",
      status: "pending",
      created_at: at,
      updated_at: at,
    });
    await insert("ai_proposals", [ai("card-a"), ai("card-b")]);
    const path = (card: string) => `/coach/clients/${client.userId}/cards/${card}`;
    expect((await call(path("card-a"), coachA, "POST", { decision: "approve" })).status).toBe(200);
    expect((await call(path("card-b"), coachA, "POST", { decision: "reject" })).status).toBe(200);
    const rows = await query<{ id: string; status: string; approved_by: string | null }>(
      "SELECT id, status, approved_by FROM ai_proposals WHERE id IN ('card-a', 'card-b') ORDER BY id",
    );
    expect(rows).toEqual([
      { id: "card-a", status: "pending", approved_by: coachA.userId },
      { id: "card-b", status: "rejected", approved_by: null },
    ]);
    const coachCard = (
      await query<{ id: string }>("SELECT id FROM ai_proposals WHERE user_id = $1 AND source = 'coach'", [
        client.userId,
      ])
    )[0];
    expect((await call(path(coachCard?.id ?? ""), coachA, "POST", { decision: "reject" })).status).toBe(404);
  });

  test("a comment needs a target of this client", async () => {
    const r = await call(`/coach/clients/${client.userId}/comments`, coachA, "POST", {
      targetType: "session",
      targetId: "not-theirs",
      body: "Good work.",
    });
    expect(r.status).toBe(404);
  });

  test("messages go both ways, and the list puts unread client messages first", async () => {
    expect(
      (await call(`/coach/clients/${client.userId}/messages`, coachA, "POST", { body: "How was day A?" }))
        .status,
    ).toBe(200);
    const linkId = (
      await query<{ id: string }>("SELECT id FROM coach_links WHERE coach_id = $1 AND client_id = $2", [
        coachA.userId,
        client.userId,
      ])
    )[0]?.id;
    const at = new Date(Date.now() + 1000).toISOString();
    const up = await upload(client, [
      {
        op: "PUT",
        table: "messages",
        id: "m-client-1",
        data: {
          coach_link_id: linkId,
          author_id: client.userId,
          body: "Good, thanks.",
          created_at: at,
          updated_at: at,
        },
      },
    ]);
    expect(((await up.json()) as { rejected: unknown[] }).rejected).toEqual([]);
    const thread = (await (await call(`/coach/clients/${client.userId}/messages`, coachA)).json()) as {
      messages: { body: string }[];
    };
    expect(thread.messages.map((m) => m.body)).toEqual(["How was day A?", "Good, thanks."]);
    const list = (await (await call("/coach/clients", coachA)).json()) as {
      clients: { clientId: string; attention: { unreadMessages: number } }[];
    };
    expect(list.clients[0]).toMatchObject({ clientId: client.userId, attention: { unreadMessages: 1 } });
  });
});

describe("client writes to coach tables", () => {
  const codes = async (r: Response) =>
    ((await r.json()) as { rejected: { id: string; code: string }[] }).rejected.map((x): unknown[] => [
      x.id,
      x.code,
    ]);

  test("the client cannot create a link, change who it links, forge an approval or write a comment", async () => {
    const linkId = (
      await query<{ id: string }>("SELECT id FROM coach_links WHERE client_id = $1 AND coach_id = $2", [
        client.userId,
        coachA.userId,
      ])
    )[0]?.id;
    const at = new Date().toISOString();
    const r = await upload(client, [
      {
        op: "PUT",
        table: "coach_links",
        id: "fake",
        data: {
          coach_id: coachB.userId,
          client_id: client.userId,
          status: "active",
          created_at: at,
          updated_at: at,
        },
      },
      { op: "PATCH", table: "coach_links", id: linkId, data: { coach_id: coachB.userId } },
      { op: "PATCH", table: "coach_links", id: linkId, data: { status: "active" } },
      { op: "PATCH", table: "ai_proposals", id: "card-b", data: { approved_by: coachA.userId } },
      {
        op: "PUT",
        table: "comments",
        id: "c1",
        data: {
          target_type: "session",
          target_id: "s",
          author_id: coachA.userId,
          created_at: at,
          updated_at: at,
        },
      },
      {
        op: "PATCH",
        table: "coach_links",
        id: linkId,
        data: { scopes: '["training","food"]', auto_apply: 1 },
      },
    ]);
    expect(await codes(r)).toEqual([
      ["fake", "read-only"],
      [linkId, "read-only"],
      [linkId, "invalid"],
      ["card-b", "read-only"],
      ["c1", "read-only"],
    ]);
    const detail = (await (await call(`/coach/clients/${client.userId}`, coachA)).json()) as Record<
      string,
      unknown
    >;
    expect(detail.food).toBeDefined();
  });

  test("the client cannot write as the coach, edit the coach's message, or post on another link", async () => {
    const coachMessage = (
      await query<{ id: string; coach_link_id: string }>(
        "SELECT id, coach_link_id FROM messages WHERE author_id = $1",
        [coachA.userId],
      )
    )[0];
    const at = new Date().toISOString();
    const r = await upload(client, [
      {
        op: "PUT",
        table: "messages",
        id: "m2",
        data: {
          coach_link_id: coachMessage?.coach_link_id,
          author_id: coachA.userId,
          body: "x",
          created_at: at,
          updated_at: at,
        },
      },
      { op: "PATCH", table: "messages", id: coachMessage?.id, data: { body: "changed" } },
      {
        op: "PUT",
        table: "messages",
        id: "m3",
        data: { coach_link_id: "other", author_id: client.userId, body: "x", created_at: at, updated_at: at },
      },
    ]);
    expect(await codes(r)).toEqual([
      ["m2", "forbidden"],
      [coachMessage?.id, "forbidden"],
      ["m3", "forbidden"],
    ]);
  });

  test("a revoke through sync ends the coach's access on the next request", async () => {
    const linkId = (
      await query<{ id: string }>("SELECT id FROM coach_links WHERE client_id = $1 AND coach_id = $2", [
        client.userId,
        coachA.userId,
      ])
    )[0]?.id;
    expect((await call(`/coach/clients/${client.userId}`, coachA)).status).toBe(200);
    const r = await upload(client, [
      { op: "PATCH", table: "coach_links", id: linkId, data: { status: "revoked" } },
    ]);
    expect(await codes(r)).toEqual([]);
    expect((await call(`/coach/clients/${client.userId}`, coachA)).status).toBe(403);
    expect((await call(`/coach/clients/${client.userId}/messages`, coachA)).status).toBe(403);
  });
});
