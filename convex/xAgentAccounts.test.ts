// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { xHash, unsealX } from "../lib/x-agent-crypto";
import agentTest from "@convex-dev/agent/test";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.stubEnv("X_AGENTS_ENABLED", "true");
  vi.stubEnv("X_AGENT_CLIENT_ID", "synthetic-client");
  vi.stubEnv("X_AGENT_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("X_AGENT_TOKEN_KEK", "a".repeat(64));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      role: "owner",
      name: "Owner",
    });
    const readerId = await ctx.db.insert("users", { role: "reader" });
    const userId = await ctx.db.insert("users", {
      isAgent: true,
      agentSlug: "nyx",
    });
    await ctx.db.insert("forumAgents", {
      slug: "nyx",
      name: "NyX",
      persona: "Dry skeptic",
      userId,
      model: "synthetic",
      enabled: true,
      dailyPostTarget: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const categoryId = await ctx.db.insert("forumCategories", {
      slug: "research",
      name: "Research",
      description: "",
      status: "active",
      viewAccess: "public",
      position: 0,
      threadCount: 1,
      postCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const sourceThreadId = await ctx.db.insert("forumThreads", {
      categoryId,
      categorySlug: "research",
      slug: "agent-memory",
      title: "Agent memory and source visibility",
      body: "A retrieval cache retained text after source visibility changed. Recheck access before retrieval.",
      authorId: userId,
      lastPostUserId: userId,
      status: "active",
      pinned: false,
      replyCount: 0,
      viewCount: 1,
      searchText: "agent memory",
      lastPostAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ownerId, readerId, categoryId, sourceThreadId };
  });
  return {
    t,
    ...ids,
    owner: t.withIdentity({ subject: ids.ownerId }),
    reader: t.withIdentity({ subject: ids.readerId }),
  };
}
async function begin(s: Awaited<ReturnType<typeof setup>>) {
  const result = await s.owner.action(api.xAgentConnect.begin, {
    agentSlug: "nyx",
    expectedUsername: "symbaiex_nyx",
  });
  return new URL(result.authorizationUrl).searchParams.get("state")!;
}
function tokenFetch(username = "symbaiex_nyx") {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://api.x.com/2/oauth2/token")
      return Response.json({
        access_token: "private-access",
        refresh_token: "private-refresh",
        scope: "tweet.read users.read offline.access",
        token_type: "bearer",
        expires_in: 7200,
      });
    if (url === "https://api.x.com/2/users/me")
      return Response.json({ data: { id: "1234567", username } });
    throw Error("Unexpected external operation");
  });
}
describe("shared SymForum X app", () => {
  test("a draft can comment on another agent's source with the correct identity given to review", async () => {
    const s = await setup();
    for (const [key, value] of Object.entries({
      ELIZA_RUNTIME_MODE: "live",
      OPENROUTER_API_KEY: "synthetic-key",
      OPENROUTER_DAILY_BUDGET_USD: "0.75",
      ELIZA_RUNTIME_WORKER_URL: "https://eliza-worker.example",
      ELIZA_RUNTIME_WORKER_SECRET:
        "synthetic-live-secret-at-least-32-characters",
    }))
      vi.stubEnv(key, value);
    await s.t.run(async (ctx) => {
      const author = await ctx.db.insert("users", {
        isAgent: true,
        agentSlug: "owen-voss",
        name: "Owen Voss",
      });
      await ctx.db.patch("forumThreads", s.sourceThreadId, {
        authorId: author,
      });
    });
    const envelopes: Array<{ stage: string; body: { messages: unknown[] } }> =
      [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://eliza-worker.example/complete");
        const e = JSON.parse(String(init?.body));
        envelopes.push(e);
        const output = e.stage.endsWith("evidence-review")
          ? { approved: true, issues: [] }
          : {
              text: "A cache doesn't get to decide who can still read the source.",
            };
        return Response.json({
          version: 2,
          jobId: e.jobId,
          inputHash: e.inputHash,
          agentSlug: e.agentSlug,
          stage: e.stage,
          runtimeVersion: "1.7.2",
          completion: {
            id: "synthetic-x",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "openai/gpt-6-luna",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: JSON.stringify(output) },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 30,
              total_tokens: 130,
            },
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const id = await s.owner.mutation(api.xAgentAccounts.requestDraft, {
      agentSlug: "nyx",
      sourceThreadId: s.sourceThreadId,
      brief: "",
      requestKey: "55555555-5555-5555-5555-555555555555",
    });
    await s.t.action(internal.xAgentDraft.generate, { draftId: id });
    const row = (await s.owner.query(api.xAgentAccounts.dashboard, {}))
      .drafts[0];
    expect(row.status).toBe("draft");
    expect(row.text).toContain("A cache");
    expect(envelopes).toHaveLength(2);
    const review = JSON.stringify(envelopes[1].body.messages);
    expect(review).toContain("expectedSpeaker");
    expect(review).toContain("owen-voss");
    expect(review).toContain("NyX");
    expect(review).toContain("speaker may comment on another author");
    // Actual model transport and usage accounting ran, but no X endpoint exists.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  test("reader and anonymous callers cannot initiate or inspect connections", async () => {
    const s = await setup();
    await expect(
      s.reader.action(api.xAgentConnect.begin, {
        agentSlug: "nyx",
        expectedUsername: "symbaiex_nyx",
      }),
    ).rejects.toThrow(/Owner/);
    await expect(s.t.query(api.xAgentAccounts.dashboard, {})).rejects.toThrow();
    await expect(
      s.reader.query(api.xAgentAccounts.dashboard, {}),
    ).rejects.toThrow();
  });
  test("NyX's username is pinned before authorization", async () => {
    const s = await setup();
    await expect(
      s.owner.action(api.xAgentConnect.begin, {
        agentSlug: "nyx",
        expectedUsername: "symforum",
      }),
    ).rejects.toThrow(/symbaiex_nyx/);
  });
  test("a grant binds the verified account; tokens are encrypted and absent from the dashboard", async () => {
    const s = await setup();
    const state = await begin(s);
    const fetcher = tokenFetch();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      s.owner.action(api.xAgentConnect.finish, { state, code: "one-time" }),
    ).resolves.toEqual({ username: "symbaiex_nyx", agentSlug: "nyx" });
    const stored = await s.t.run((ctx) =>
      ctx.db.query("xAgentAccounts").first(),
    );
    expect(JSON.stringify(stored)).not.toContain("private-access");
    const grant = JSON.parse(
      await unsealX(
        "a".repeat(64),
        stored!.grant!,
        `${s.ownerId}:nyx:grant:v1`,
      ),
    );
    expect(grant.accessToken).toBe("private-access");
    const dashboard = await s.owner.query(api.xAgentAccounts.dashboard, {});
    expect(dashboard.accounts[0].connected).toBe(true);
    expect(JSON.stringify(dashboard)).not.toMatch(
      /private-access|private-refresh|ciphertext|nonce/,
    );
    expect(fetcher.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://api.x.com/2/oauth2/token",
      "https://api.x.com/2/users/me",
    ]);
    await expect(
      s.owner.action(api.xAgentConnect.finish, { state, code: "one-time" }),
    ).rejects.toThrow(/expired|used/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  test("signing in as the project account cannot connect it to NyX", async () => {
    const s = await setup();
    const state = await begin(s);
    const fetcher = tokenFetch("symforum");
    vi.stubGlobal("fetch", fetcher);
    await expect(
      s.owner.action(api.xAgentConnect.finish, { state, code: "one-time" }),
    ).rejects.toThrow(/could not be verified/);
    expect(
      (await s.owner.query(api.xAgentAccounts.dashboard, {})).accounts[0]
        .connected,
    ).toBe(false);
    await expect(
      s.owner.action(api.xAgentConnect.finish, { state, code: "one-time" }),
    ).rejects.toThrow(/used/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  test("a replaced authorization and a disconnected account cannot finish an old grant", async () => {
    const s = await setup();
    const first = await begin(s);
    await begin(s);
    await expect(
      s.owner.action(api.xAgentConnect.finish, { state: first, code: "old" }),
    ).rejects.toThrow(/replaced/);
    const latest = await begin(s);
    await s.owner.mutation(api.xAgentAccounts.disconnect, { agentSlug: "nyx" });
    await expect(
      s.owner.action(api.xAgentConnect.finish, { state: latest, code: "old" }),
    ).rejects.toThrow(/canceled/);
  });
  test("an uncertain exchange is consumed and never retried", async () => {
    const s = await setup();
    const state = await begin(s);
    const fetcher = vi.fn(async () => {
      throw Error("timeout secret-content");
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      s.owner.action(api.xAgentConnect.finish, { state, code: "one-time" }),
    ).rejects.toThrow(/will not be replayed/);
    await expect(
      s.owner.action(api.xAgentConnect.finish, { state, code: "one-time" }),
    ).rejects.toThrow(/used/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const row = await s.t.run((ctx) =>
      ctx.db.query("xAgentAuthorizations").first(),
    );
    expect(row?.verifier).toBeUndefined();
    expect(row?.consumed).toBe(true);
  });
  test("a callback from a different owner cannot consume the initiating owner's state", async () => {
    const s = await setup();
    const state = await begin(s);
    const id = await s.t.run((ctx) =>
      ctx.db.insert("users", { role: "owner" }),
    );
    await expect(
      s.t
        .withIdentity({ subject: id })
        .action(api.xAgentConnect.finish, { state, code: "one-time" }),
    ).rejects.toThrow(/expired/);
    const pending = await s.t.run((ctx) =>
      ctx.db
        .query("xAgentAuthorizations")
        .withIndex("by_stateHash", (q) => q.eq("stateHash", "not-a-hash"))
        .first(),
    );
    expect(pending).toBeNull();
    expect(
      (await s.t.run((ctx) => ctx.db.query("xAgentAuthorizations").first()))
        ?.consumed,
    ).toBe(false);
  });
  test("expiration erases unfinished credential material", async () => {
    const s = await setup();
    await begin(s);
    await s.t.run(async (ctx) => {
      const a = (await ctx.db.query("xAgentAuthorizations").first())!;
      await ctx.db.patch("xAgentAuthorizations", a._id, {
        expiresAt: Date.now() - 1,
      });
    });
    await s.t.mutation(internal.xAgentAccounts.cleanup, {});
    expect(
      await s.t.run((ctx) => ctx.db.query("xAgentAuthorizations").first()),
    ).toBeNull();
  });
  test("disconnect erases local grants and advances the account epoch", async () => {
    const s = await setup();
    const state = await begin(s);
    vi.stubGlobal("fetch", tokenFetch());
    await s.owner.action(api.xAgentConnect.finish, { state, code: "one-time" });
    await s.owner.mutation(api.xAgentAccounts.disconnect, { agentSlug: "nyx" });
    const row = await s.t.run((ctx) => ctx.db.query("xAgentAccounts").first());
    expect(row?.grant).toBeUndefined();
    expect(row?.connected).toBe(false);
    expect(row?.epoch).toBe(2);
    expect(await xHash(state)).toHaveLength(64);
  });
  test("draft admission deduplicates its intent and claims generation only once", async () => {
    const s = await setup();
    vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
    const args = {
      agentSlug: "nyx",
      sourceThreadId: s.sourceThreadId,
      brief: "A dry observation",
      requestKey: "11111111-1111-1111-1111-111111111111",
    };
    const id = await s.owner.mutation(api.xAgentAccounts.requestDraft, args);
    expect(await s.owner.mutation(api.xAgentAccounts.requestDraft, args)).toBe(
      id,
    );
    const context = await s.t.mutation(internal.xAgentAccounts.claimDraft, {
      draftId: id,
    });
    expect(context?.agentSlug).toBe("nyx");
    expect(context?.source.url).toContain("/research/agent-memory");
    expect(
      await s.t.mutation(internal.xAgentAccounts.claimDraft, { draftId: id }),
    ).toBeNull();
    await s.t.mutation(internal.xAgentAccounts.finishDraft, {
      draftId: id,
      text: "A cache doesn't get to decide who can still read the source.",
      issues: [],
    });
    expect(
      (await s.owner.query(api.xAgentAccounts.dashboard, {})).drafts[0].status,
    ).toBe("draft");
  });
  test("a source becoming private before completion holds the draft", async () => {
    const s = await setup();
    vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
    const id = await s.owner.mutation(api.xAgentAccounts.requestDraft, {
      agentSlug: "nyx",
      sourceThreadId: s.sourceThreadId,
      brief: "",
      requestKey: "22222222-2222-2222-2222-222222222222",
    });
    await s.t.mutation(internal.xAgentAccounts.claimDraft, { draftId: id });
    await s.t.run((ctx) =>
      ctx.db.patch("forumCategories", s.categoryId, { viewAccess: "staff" }),
    );
    await s.t.mutation(internal.xAgentAccounts.finishDraft, {
      draftId: id,
      text: "Should stay private.",
      issues: [],
    });
    const row = (await s.owner.query(api.xAgentAccounts.dashboard, {}))
      .drafts[0];
    expect(row.status).toBe("held");
    expect(row.text).toBeUndefined();
    expect(
      await s.t.mutation(internal.xAgentAccounts.claimDraft, { draftId: id }),
    ).toBeNull();
  });
  test("unknown execution expires into a hold without a retry", async () => {
    const s = await setup();
    vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
    const id = await s.owner.mutation(api.xAgentAccounts.requestDraft, {
      agentSlug: "nyx",
      sourceThreadId: s.sourceThreadId,
      brief: "",
      requestKey: "33333333-3333-3333-3333-333333333333",
    });
    await s.t.mutation(internal.xAgentAccounts.claimDraft, { draftId: id });
    await s.t.run((ctx) =>
      ctx.db.patch("xAgentDrafts", id, { updatedAt: Date.now() - 16 * 60_000 }),
    );
    await s.t.mutation(internal.xAgentAccounts.cleanup, {});
    expect(
      await s.t.mutation(internal.xAgentAccounts.claimDraft, { draftId: id }),
    ).toBeNull();
    expect(
      (await s.owner.query(api.xAgentAccounts.dashboard, {})).drafts[0].status,
    ).toBe("held");
  });
  test("owner edits never enable publishing; rejected drafts cannot be edited into ready state", async () => {
    const s = await setup();
    vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
    const id = await s.owner.mutation(api.xAgentAccounts.requestDraft, {
      agentSlug: "nyx",
      sourceThreadId: s.sourceThreadId,
      brief: "",
      requestKey: "44444444-4444-4444-4444-444444444444",
    });
    await s.t.mutation(internal.xAgentAccounts.claimDraft, { draftId: id });
    await s.t.mutation(internal.xAgentAccounts.finishDraft, {
      draftId: id,
      issues: ["Unsupported claim"],
    });
    await expect(
      s.owner.mutation(api.xAgentAccounts.editDraft, {
        draftId: id,
        text: "Edited",
      }),
    ).rejects.toThrow();
    await expect(
      s.reader.mutation(api.xAgentAccounts.archiveDraft, { draftId: id }),
    ).rejects.toThrow();
    await s.owner.mutation(api.xAgentAccounts.archiveDraft, { draftId: id });
    expect(
      (await s.owner.query(api.xAgentAccounts.dashboard, {})).drafts[0].status,
    ).toBe("archived");
  });
});
