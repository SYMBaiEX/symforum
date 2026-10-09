/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = { ...import.meta.glob("./**/*.ts"), ...import.meta.glob("./**/*.tsx") };
function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}
async function seed(t: ReturnType<typeof setup>, trusted = true) {
  return t.run(async ctx => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { username: "owner", role: "reader", ...(trusted ? { forumTrustedAt: now } : {}) });
    const stranger = await ctx.db.insert("users", { username: "stranger", forumTrustedAt: now });
    const staff = await ctx.db.insert("users", { username: "staff", role: "reader", forumRole: "moderator" });
    const agent = await ctx.db.insert("users", { username: "agent", usernameNormalized: "agent", isAgent: true, agentSlug: "agent", agentStatus: "active", agentScopes: ["forum"], agentKeyVersion: 1 });
    const credential = await ctx.db.insert("agentIdentities", { agentId: "agent", userId: agent, ownerUserId: owner, credentialKind: "oauth", scopes: ["forum"], status: "active", keyVersion: 1, createdAt: now, updatedAt: now });
    const category = await ctx.db.insert("forumCategories", { slug: "general", name: "General", description: "", kind: "board", status: "active", viewAccess: "public", threadAccess: "members", replyAccess: "members", pollAccess: "members", position: 0, threadCount: 0, postCount: 0, createdAt: now, updatedAt: now });
    return { owner, stranger, staff, agent, credential, category };
  });
}
const pageArgs = { paginationOpts: { numItems: 40, cursor: null } };

describe("General live chat domain", () => {
  test("anonymous sends and malformed bodies leave persistence unchanged", async () => {
    const t = setup();
    const s = await seed(t);
    await expect(t.mutation(api.forum.sendChatMessage, { body: "hello" })).rejects.toThrow("Sign in");
    const owner = t.withIdentity({ subject: s.owner });
    for (const body of ["  ", "a".repeat(2001)]) {
      await expect(owner.mutation(api.forum.sendChatMessage, { body })).rejects.toThrow("1 to 2000");
    }
    await t.run(async ctx => { expect(await ctx.db.query("forumChatMessages").collect()).toEqual([]); });
  });
  test("trusted messages publish with real identity and author-only deletion", async () => {
    const t = setup();
    const s = await seed(t);
    const owner = t.withIdentity({ subject: s.owner });
    const result = await owner.mutation(api.forum.sendChatMessage, { body: "  Hello General!  " });
    expect(result).toMatchObject({ status: "active", publicationStatus: "published", url: "https://forum.symbaiex.com/#forum-chat", message: { body: "Hello General!", authorIdentity: { userId: s.owner, username: "owner", isAgent: false } } });
    const publicPage = await t.query(api.forum.listChatMessages, pageArgs);
    expect(publicPage.viewer).toMatchObject({ canRead: true, canSend: false, canModerate: false });
    expect(publicPage.page.map(row => row._id)).toEqual([result.messageId]);
    await expect(t.withIdentity({ subject: s.stranger }).mutation(api.forum.deleteChatMessage, { messageId: result.messageId })).rejects.toThrow("own chat");
    await owner.mutation(api.forum.deleteChatMessage, { messageId: result.messageId });
    expect((await t.query(api.forum.listChatMessages, pageArgs)).page).toEqual([]);
    await expect(t.withIdentity({ subject: s.staff }).mutation(api.forum.moderateChatMessage, { messageId: result.messageId, status: "active" })).rejects.toThrow("unavailable");
  });
  test("new members publish immediately while legacy pending messages remain staff-moderated", async () => {
    const t = setup();
    const s = await seed(t, false);
    const owner = t.withIdentity({ subject: s.owner });
    const result = await owner.mutation(api.forum.sendChatMessage, { body: "My first message" });
    expect(result).toMatchObject({ status: "active", publicationStatus: "published" });
    expect((await t.query(api.forum.listChatMessages, pageArgs)).page).toHaveLength(1);
    expect((await owner.query(api.forum.listChatMessages, pageArgs)).pending).toEqual([]);
    expect((await t.withIdentity({ subject: s.stranger }).query(api.forum.listChatMessages, pageArgs)).pending).toEqual([]);
    await expect(owner.query(api.forum.listChatPendingMessages, pageArgs)).rejects.toThrow("moderator access");
    const legacyPendingId = await t.run(async ctx => ctx.db.insert("forumChatMessages", {
      categoryId: s.category, authorId: s.owner, ownerUserId: s.owner,
      body: "Previously queued message", status: "pending", createdAt: Date.now(), updatedAt: Date.now(),
    }));
    const staff = t.withIdentity({ subject: s.staff });
    expect((await staff.query(api.forum.listChatPendingMessages, pageArgs)).page).toHaveLength(1);
    await staff.mutation(api.forum.moderateChatMessage, { messageId: legacyPendingId, status: "active" });
    expect((await owner.query(api.forum.listChatMessages, pageArgs)).pending).toEqual([]);
    expect((await t.query(api.forum.listChatMessages, pageArgs)).page).toHaveLength(2);
    await staff.mutation(api.forum.moderateChatMessage, { messageId: legacyPendingId, status: "hidden" });
    expect((await t.query(api.forum.listChatMessages, pageArgs)).page).toHaveLength(1);
    await t.run(async ctx => { expect(await ctx.db.get("forumChatMessages", legacyPendingId)).toMatchObject({ moderatedBy: s.staff, moderatedOwnerUserId: s.staff }); });
  });
  test("owned native agents use owner trust on trusted boards and never inherit staff authority", async () => {
    const t = setup();
    const s = await seed(t);
    await t.run(async ctx => { await ctx.db.patch("forumCategories", s.category, { replyAccess: "trusted", viewAccess: "trusted" }); await ctx.db.patch("users", s.owner, { forumRole: "moderator" }); });
    const agent = t.withIdentity({ subject: s.agent });
    const result = await agent.mutation(api.forum.sendChatMessage, { body: "An owned agent says hello" });
    expect(result.status).toBe("active");
    expect(result.message.authorIdentity.isAgent).toBe(true);
    expect((await agent.query(api.forum.listChatMessages, pageArgs)).viewer).toMatchObject({ canRead: true, canSend: true, canModerate: false });
    await expect(agent.query(api.forum.listChatPendingMessages, pageArgs)).rejects.toThrow("moderator access");
    await t.run(async ctx => { await ctx.db.patch("users", s.owner, { forumRole: undefined, forumTrustRevokedAt: Date.now() }); await ctx.db.patch("forumCategories", s.category, { replyAccess: "members", viewAccess: "public" }); await ctx.db.patch("users", s.agent, { forumTrustedAt: Date.now() }); });
    const held = await agent.mutation(api.forum.sendChatMessage, { body: "Owner trust revoked" });
    expect(held.status).toBe("active");
  });
  test.each(["owner", "agent"] as const)("current %s restrictions reject atomically", async who => {
    const t = setup();
    const s = await seed(t);
    await t.run(ctx => ctx.db.patch("users", s[who], { forumBannedAt: Date.now() }));
    await expect(t.withIdentity({ subject: s.agent }).mutation(api.forum.sendChatMessage, { body: "Should fail" })).rejects.toThrow("banned");
    await t.run(async ctx => {
      expect(await ctx.db.query("forumChatMessages").collect()).toEqual([]);
      expect(await ctx.db.query("agentQuotaUsage").collect()).toEqual([]);
    });
  });
  test("invisible General ancestors expose no messages and current closed board rejects sends", async () => {
    const t = setup();
    const s = await seed(t);
    const owner = t.withIdentity({ subject: s.owner });
    await owner.mutation(api.forum.sendChatMessage, { body: "Before access changed" });
    await t.run(async ctx => {
      const parent = await ctx.db.insert("forumCategories", { slug: "private", name: "Private", description: "", kind: "section", status: "active", viewAccess: "staff", position: 0, threadCount: 0, postCount: 0, createdAt: 1, updatedAt: 1 });
      await ctx.db.patch("forumCategories", s.category, { parentCategoryId: parent });
    });
    expect(await t.query(api.forum.listChatMessages, pageArgs)).toMatchObject({ page: [], pending: [], viewer: { canRead: false } });
    expect((await owner.query(api.forum.listChatMessages, pageArgs)).viewer.canRead).toBe(false);
    await expect(owner.mutation(api.forum.sendChatMessage, { body: "Hidden parent" })).rejects.toThrow("board is not available");
    await t.run(ctx => ctx.db.patch("forumCategories", s.category, { parentCategoryId: undefined, replyAccess: "closed" }));
    expect((await owner.query(api.forum.listChatMessages, pageArgs)).viewer.canSend).toBe(false);
    await expect(owner.mutation(api.forum.sendChatMessage, { body: "Closed board" })).rejects.toThrow("permission");
  });
  test("real pagination stays bounded and hidden history never enters public pages", async () => {
    const t = setup();
    const s = await seed(t);
    await t.run(async ctx => {
      for (let i = 0; i < 65; i++) await ctx.db.insert("forumChatMessages", { categoryId: s.category, authorId: s.owner, ownerUserId: s.owner, body: String(i), status: i === 64 ? "hidden" : "active", createdAt: i, updatedAt: i });
      for (let i = 0; i < 12; i++) await ctx.db.insert("forumChatMessages", { categoryId: s.category, authorId: s.owner, ownerUserId: s.owner, body: `pending ${i}`, status: "pending", createdAt: i, updatedAt: i });
    });
    const first = await t.query(api.forum.listChatMessages, { paginationOpts: { numItems: 60, cursor: null } });
    expect(first.page).toHaveLength(60);
    expect(first.page[0].body).toBe("63");
    expect(first.isDone).toBe(false);
    const next = await t.query(api.forum.listChatMessages, { paginationOpts: { numItems: 60, cursor: first.continueCursor } });
    expect(next.page).toHaveLength(4);
    expect(next.isDone).toBe(true);
    expect(new Set([...first.page, ...next.page].map(row => row._id)).size).toBe(64);
    const own = await t.withIdentity({ subject: s.owner }).query(api.forum.listChatMessages, pageArgs);
    expect(own.pending).toHaveLength(10);
    expect(own.pendingLimited).toBe(true);
    await expect(t.query(api.forum.listChatMessages, { paginationOpts: { numItems: 61, cursor: null } })).rejects.toThrow("1 to 60");
    await expect(t.query(api.forum.listChatMessages, { paginationOpts: { numItems: 0, cursor: null } })).rejects.toThrow("1 to 60");
  });
  test("human and owned agent sends share chat cooldown capacity without monthly charges", async () => {
    const t = setup();
    const s = await seed(t);
    await t.run(async ctx => {
      const now = Date.now(); const monthKey = new Date(now).toISOString().slice(0,7);
      await ctx.db.insert("agentQuotaBudgets", {ownerUserId:s.owner,monthKey,freeAllowanceUnits:100,hardCapUnits:1000,usedUnits:1000,hardCapMetadataJson:"{}",createdAt:now,updatedAt:now});
      await ctx.db.insert("agentQuotaUsageCounters", {ownerUserId:s.owner,agentId:"agent",monthKey,usedUnits:250,updatedAt:now});
    });
    const owner = t.withIdentity({ subject: s.owner });
    const agent = t.withIdentity({ subject: s.agent });
    for (let i = 0; i < 6; i++) await owner.mutation(api.forum.sendChatMessage, { body: `Human ${i}` });
    for (let i = 0; i < 2; i++) await agent.mutation(api.forum.sendChatMessage, { body: `Agent ${i}` });
    await expect(agent.mutation(api.forum.sendChatMessage, { body: "Owner exhausted" })).rejects.toThrow("too quickly");
    await t.run(async ctx => {
      expect(await ctx.db.query("forumChatMessages").collect()).toHaveLength(8);
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
  });
  test("moderator cannot publish legacy queued content after its owner is banned", async () => {
    const t = setup();
    const s = await seed(t, false);
    const messageId = await t.run(async ctx => ctx.db.insert("forumChatMessages", {
      categoryId: s.category, authorId: s.owner, ownerUserId: s.owner,
      body: "Waiting", status: "pending", createdAt: Date.now(), updatedAt: Date.now(),
    }));
    await t.run(ctx => ctx.db.patch("users", s.owner, { forumBannedAt: Date.now() }));
    await expect(t.withIdentity({ subject: s.staff }).mutation(api.forum.moderateChatMessage, { messageId, status: "active" })).rejects.toThrow("banned");
    await t.run(async ctx => { expect((await ctx.db.get("forumChatMessages", messageId))?.status).toBe("pending"); });
  });
  test("moderator cannot publish legacy queued agent content after its credential is revoked", async () => {
    const t = setup();
    const s = await seed(t, false);
    const messageId = await t.run(async ctx => ctx.db.insert("forumChatMessages", {
      categoryId: s.category, authorId: s.agent, ownerUserId: s.owner,
      body: "Waiting for approval", status: "pending", createdAt: Date.now(), updatedAt: Date.now(),
    }));
    await t.run(ctx => ctx.db.patch("agentIdentities", s.credential, { status: "revoked" }));
    await expect(t.withIdentity({ subject: s.staff }).mutation(api.forum.moderateChatMessage, { messageId, status: "active" })).rejects.toThrow("authorization has changed");
    await t.run(async ctx => { expect((await ctx.db.get("forumChatMessages", messageId))?.status).toBe("pending"); });
  });
  test("native agent board assignments cannot grant undelegated staff-only chat access", async () => {
    const t = setup();
    const s = await seed(t);
    await t.run(async ctx => {
      await ctx.db.patch("users", s.owner, { forumRole: "moderator" });
      await ctx.db.patch("forumCategories", s.category, { viewAccess: "staff" });
      await ctx.db.insert("forumCategoryModerators", { categoryId: s.category, userId: s.agent, assignedBy: s.owner, createdAt: Date.now(), updatedAt: Date.now() });
    });
    const agent = t.withIdentity({ subject: s.agent });
    expect((await agent.query(api.forum.listChatMessages, pageArgs)).viewer.canRead).toBe(false);
    await expect(agent.mutation(api.forum.sendChatMessage, { body: "Undelegated staff board" })).rejects.toThrow("board is not available");
  });
});
