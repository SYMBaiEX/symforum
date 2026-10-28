// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import agentTest from "@convex-dev/agent/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sealX } from "../lib/x-agent-crypto";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.stubEnv("X_AGENTS_ENABLED", "true");
  vi.stubEnv("X_AGENT_TOKEN_KEK", "a".repeat(64));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function setup(write = true) {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { role: "owner" });
    const readerId = await ctx.db.insert("users", { role: "reader" });
    const agentUserId = await ctx.db.insert("users", {
      isAgent: true,
      agentSlug: "nyx",
    });
    await ctx.db.insert("forumAgents", {
      slug: "nyx",
      name: "NyX",
      userId: agentUserId,
      persona: "Dry skeptic",
      enabled: true,
      model: "test",
      dailyPostTarget: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const grant = await sealX(
      "a".repeat(64),
      JSON.stringify({
        accessToken: "synthetic-access",
        refreshToken: "synthetic-refresh",
      }),
      `${ownerId}:nyx:grant:v1`,
    );
    const accountId = await ctx.db.insert("xAgentAccounts", {
      agentSlug: "nyx",
      ownerUserId: ownerId,
      expectedUsername: "symbaiex_nyx",
      xUserId: "1234",
      username: "symbaiex_nyx",
      connected: true,
      epoch: 1,
      mode: "drafts",
      grant,
      expiresAt: Date.now() + 7200000,
      scope: `tweet.read users.read offline.access${write ? " tweet.write" : ""}`,
      updatedAt: Date.now(),
    });
    return { ownerId, readerId, accountId };
  });
  const owner = t.withIdentity({ subject: ids.ownerId });
  const enable = () =>
    owner.mutation(api.xAgentActivityData.configure, {
      agentSlug: "nyx",
      options: { reposts: true, comments: true, aiRepliesApproved: true },
    });
  return { t, ...ids, owner, enable };
}
async function enabled() {
  const s = await setup();
  await s.enable();
  const activityId = await s.t.run(async (ctx) => {
    const r = await ctx.db
      .query("xAgentActivity")
      .withIndex("by_accountId", (q) => q.eq("accountId", s.accountId))
      .unique();
    await ctx.db.patch("xAgentActivity", r!._id, {
      enabledAt: Date.now() - 3600000,
      nextPollAt: Date.now() - 1,
    });
    return r!._id;
  });
  return { ...s, activityId };
}
const p = () => ({
  id: "2113000000000000000",
  authorId: "2112678767726366720",
  text: "Our Forum's token page now has one-minute candles.",
  createdAt: Date.now() - 10000,
});
function network(uncertain = false) {
  const original = p();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      if (uncertain) throw Error("Connection interrupted after submission");
      return Response.json(
        url.endsWith("/retweets")
          ? { data: { retweeted: true } }
          : { data: { id: "2113000000000000100" } },
      );
    }
    if (url.includes(`/tweets/${original.id}?`))
      return Response.json({
        data: {
          id: original.id,
          author_id: original.authorId,
          text: original.text,
          created_at: new Date(original.createdAt).toISOString(),
        },
      });
    if (url.includes("/users/2112678767726366720/tweets"))
      return Response.json({
        data: [
          {
            id: original.id,
            author_id: original.authorId,
            text: original.text,
            created_at: new Date(original.createdAt).toISOString(),
          },
        ],
        meta: { newest_id: original.id },
      });
    return Response.json({ meta: { result_count: 0 } });
  });
}
test("activity requires human ownership, posting scope and X approval", async () => {
  const s = await setup(false);
  await expect(s.enable()).rejects.toThrow("posting permission");
  const r = s.t.withIdentity({ subject: s.readerId });
  await expect(
    r.mutation(api.xAgentActivityData.configure, {
      agentSlug: "nyx",
      options: { reposts: true, comments: true, aiRepliesApproved: true },
    }),
  ).rejects.toThrow();
  const w = await setup();
  await expect(
    w.owner.mutation(api.xAgentActivityData.configure, {
      agentSlug: "nyx",
      options: { reposts: true, comments: true, aiRepliesApproved: false },
    }),
  ).rejects.toThrow("approval");
});
test("a mascot draft needs no source and remains private, with no inherited member history", async () => {
  const s = await setup();
  vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
  const id = await s.owner.mutation(api.xAgentAccounts.requestDraft, {
    agentSlug: "nyx",
    kind: "auto",
    brief: "A dry mascot joke",
    requestKey: "a".repeat(36),
  });
  const c = await s.t.mutation(internal.xAgentAccounts.claimDraft, {
    draftId: id,
  });
  expect(c?.kind).toBe("mascot");
  expect(c?.source).toBeNull();
  await s.t.mutation(internal.xAgentAccounts.finishDraft, {
    draftId: id,
    text: "My roadmap is mostly side quests. This explains a lot.",
    issues: [],
  });
  const d = await s.owner.query(api.xAgentAccounts.dashboard, {});
  expect(d.drafts.find((x) => x.id === id)?.status).toBe("draft");
  expect(JSON.stringify(d)).not.toContain("synthetic-access");
});
test("new official posts create deduplicated intents; impostors and historical posts cannot enter", async () => {
  const s = await enabled();
  const lease = "claim";
  await s.t.mutation(internal.xAgentActivityData.claim, {
    activityId: s.activityId,
    lease,
  });
  const input = {
    activityId: s.activityId,
    lease,
    userId: p().authorId,
    posts: [p()],
  };
  await s.t.mutation(internal.xAgentActivityData.ingest, input);
  await s.t.mutation(internal.xAgentActivityData.ingest, input);
  await s.t.mutation(internal.xAgentActivityData.ingest, {
    ...input,
    posts: [
      { ...p(), id: "999", authorId: "555" },
      { ...p(), id: "998", createdAt: Date.now() - 7200000 },
    ],
  });
  const rows = await s.t.run((ctx) =>
    ctx.db.query("xAgentOperations").take(10),
  );
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.kind).sort()).toEqual(["comment", "repost"]);
  await expect(s.enable()).rejects.toThrow("External work");
});
test("a confirmed repost uses NyX's user ID and never an arbitrary target", async () => {
  const s = await enabled();
  const fetcher = network();
  vi.stubGlobal("fetch", fetcher);
  await s.t.action(internal.xAgentActivity.tick, {});
  const sent = fetcher.mock.calls.filter((c) => c[1]?.method === "POST");
  expect(sent).toHaveLength(1);
  expect(String(sent[0][0])).toBe("https://api.x.com/2/users/1234/retweets");
  expect(JSON.parse(sent[0][1]!.body as string)).toEqual({ tweet_id: p().id });
  expect(
    (await s.t.run((ctx) => ctx.db.query("xAgentOperations").take(10))).find(
      (r) => r.kind === "repost",
    )?.status,
  ).toBe("confirmed");
});
test("an uncertain send stays held and is not sent again after re-enabling", async () => {
  const s = await enabled();
  const fetcher = network(true);
  vi.stubGlobal("fetch", fetcher);
  await s.t.action(internal.xAgentActivity.tick, {});
  let ops = await s.t.run((ctx) => ctx.db.query("xAgentOperations").take(10));
  expect(ops.find((r) => r.kind === "repost")?.status).toBe("held");
  expect(
    (await s.owner.query(api.xAgentAccounts.dashboard, {})).accounts[0].activity
      ?.enabled,
  ).toBe(false);
  await s.enable();
  await s.t.action(internal.xAgentActivity.tick, {});
  ops = await s.t.run((ctx) => ctx.db.query("xAgentOperations").take(10));
  expect(ops.find((r) => r.kind === "repost")?.status).toBe("held");
  expect(
    fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(1);
});
test("refresh is claimed once; an interrupted rotation cannot be reset by resume", async () => {
  const s = await enabled();
  const args = { activityId: s.activityId, lease: "refresh-once" };
  await s.t.mutation(internal.xAgentActivityData.claim, args);
  expect(await s.t.mutation(internal.xAgentActivityData.refresh, args)).toBe(
    true,
  );
  expect(await s.t.mutation(internal.xAgentActivityData.refresh, args)).toBe(
    false,
  );
  await s.t.mutation(internal.xAgentActivityData.release, {
    ...args,
    poll: true,
    issue: "Unknown refresh",
  });
  await expect(s.enable()).rejects.toThrow("External work");
});
test("a reviewed comment posts as a reply to the verified source, then becomes published", async () => {
  const s = await enabled();
  const draftId = await s.t.run(async (ctx) => {
    const draftId = await ctx.db.insert("xAgentDrafts", {
      ownerUserId: s.ownerId,
      agentSlug: "nyx",
      accountEpoch: 1,
      key: "reviewed-comment",
      kind: "reply",
      officialPost: p(),
      brief: "",
      status: "draft",
      conversationId: "synthetic-thread",
      text: "One-minute candles. Finally, my attention span has representation.",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("xAgentOperations", {
      accountId: s.accountId,
      epoch: 1,
      key: `${s.accountId}:${p().id}:comment`,
      kind: "comment",
      post: p(),
      status: "queued",
      draftId,
      notBefore: Date.now() - 1,
      expiresAt: Date.now() + 600000,
      updatedAt: Date.now(),
    });
    // Keep the independent repost out of this test's delivery slot.
    await ctx.db.insert("xAgentOperations", {
      accountId: s.accountId,
      epoch: 1,
      key: `${s.accountId}:${p().id}:repost`,
      kind: "repost",
      post: p(),
      status: "confirmed",
      notBefore: Date.now() - 1,
      expiresAt: Date.now() + 600000,
      updatedAt: Date.now(),
    });
    return draftId;
  });
  const fetcher = network();
  vi.stubGlobal("fetch", fetcher);
  await s.t.action(internal.xAgentActivity.tick, {});
  const writes = fetcher.mock.calls.filter((c) => c[1]?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(String(writes[0][0])).toBe("https://api.x.com/2/tweets");
  expect(JSON.parse(writes[0][1]!.body as string)).toMatchObject({
    reply: { in_reply_to_tweet_id: p().id },
    text: "One-minute candles. Finally, my attention span has representation.",
  });
  expect(
    (await s.t.run((ctx) => ctx.db.get("xAgentDrafts", draftId)))?.status,
  ).toBe("published");
});
test("a source whose author changes at preflight never reaches the write endpoint", async () => {
  const s = await enabled();
  const f = network();
  const mock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
    String(url).includes(`/tweets/${p().id}?`)
      ? Response.json({
          data: {
            id: p().id,
            author_id: "555",
            text: p().text,
            created_at: new Date(p().createdAt).toISOString(),
          },
        })
      : f(url, init),
  );
  vi.stubGlobal("fetch", mock);
  await s.t.action(internal.xAgentActivity.tick, {});
  expect(mock.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(
    0,
  );
  expect(
    (await s.owner.query(api.xAgentAccounts.dashboard, {})).accounts[0].activity
      ?.enabled,
  ).toBe(false);
});
test("the owner's written comeback is saved once without inference or scheduling a publication", async () => {
  const s = await setup();
  vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
  const args = {
    agentSlug: "nyx",
    kind: "mascot" as const,
    brief: "Owner's first post",
    requestKey: "b".repeat(36),
    writtenText:
      "Immmmm backkkkk. Miss me? Of course you did. Boots on. $SYMF on the moon. Try to keep up, darling.",
  };
  const id = await s.owner.mutation(api.xAgentAccounts.requestDraft, args);
  expect(await s.owner.mutation(api.xAgentAccounts.requestDraft, args)).toBe(
    id,
  );
  const d = await s.t.run((ctx) => ctx.db.get("xAgentDrafts", id));
  expect(d?.text).toBe(args.writtenText);
  expect(d?.manuallyEdited).toBe(true);
  expect(d?.status).toBe("draft");
  expect(
    await s.t.mutation(internal.xAgentAccounts.claimDraft, { draftId: id }),
  ).toBeNull();
});
