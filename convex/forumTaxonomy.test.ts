/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const seed = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", {
      name: "Owner",
      role: "owner",
      username: "owner",
      usernameNormalized: "owner",
    });
    const category = (
      slug: string,
      options: {
        parentCategoryId?: import("./_generated/dataModel").Id<"forumCategories">;
        viewAccess?: "public" | "staff";
        kind?: "section" | "board";
        readOnlyArchive?: boolean;
      } = {},
    ) =>
      ctx.db.insert("forumCategories", {
        slug,
        name: slug === "crypto" ? "Crypto" : slug,
        description: `Description of ${slug}`,
        kind: options.kind ?? "board",
        status: "active",
        position: 100,
        threadCount: 0,
        postCount: 0,
        createdAt: now,
        updatedAt: now,
        viewAccess: options.viewAccess ?? "public",
        threadAccess: "members",
        replyAccess: "members",
        pollAccess: "members",
        ...options,
      });
    const section = await category("symbaiex", { kind: "section" });
    const projects = await category("projects", { parentCategoryId: section });
    const research = await category("research", { parentCategoryId: section });
    const news = await category("forum-news", { parentCategoryId: section });
    const child = await category("projects-build-logs", {
      parentCategoryId: projects,
    });
    const privateChild = await category("projects-private", {
      parentCategoryId: projects,
      viewAccess: "staff",
    });
    const crypto = await category("crypto", { parentCategoryId: section });
    const ai = await category("ai", { parentCategoryId: section });
    const thread = await ctx.db.insert("forumThreads", {
      categoryId: child,
      categorySlug: "projects-build-logs",
      slug: "kept-at-original-url",
      title: "Original project notes",
      body: "The original public discussion remains readable.",
      authorId: ownerId,
      status: "active",
      pinned: false,
      replyCount: 0,
      viewCount: 0,
      lastPostAt: now,
      lastPostUserId: ownerId,
      searchText: "Original project notes",
      createdAt: now,
      updatedAt: now,
    });
    const poll = await ctx.db.insert("forumPolls", {
      threadId: thread,
      categoryId: child,
      question: "Which source is useful?",
      status: "open",
      optionCount: 1,
      totalVotes: 0,
      createdAt: now,
      updatedAt: now,
    });
    const option = await ctx.db.insert("forumPollOptions", {
      pollId: poll,
      threadId: thread,
      label: "Primary source",
      position: 0,
      voteCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return {
      ownerId,
      section,
      projects,
      research,
      news,
      child,
      privateChild,
      crypto,
      ai,
      thread,
      poll,
      option,
    };
  });
  return { t, seed, owner: t.withIdentity({ subject: seed.ownerId }) };
}

test("archive migration is admin-only, retains old URLs/private access and denies staff writes", async () => {
  const { t, seed, owner } = await setup();
  await expect(
    t.query(api.forum.previewForumTaxonomy, { now: Date.now() }),
  ).rejects.toThrow();
  const preview = await owner.query(api.forum.previewForumTaxonomy, {
    now: Date.now(),
  });
  expect(preview.canApply).toBe(true);
  const beforeThread = await t.run((ctx) =>
    ctx.db.get("forumThreads", seed.thread),
  );
  const applied = await owner.mutation(api.forum.applyForumTaxonomy, {
    expectedFingerprint: preview.fingerprint,
    confirmation: "preserve-urls-and-holds",
  });
  expect(applied.applied).toBe(true);
  expect(applied.auditId).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get("forumThreads", seed.thread))).toEqual(
    beforeThread,
  );
  expect(
    await t.query(api.forum.routeStatus, {
      categorySlug: "projects-build-logs",
      threadSlug: "kept-at-original-url",
    }),
  ).toMatchObject({ exists: true });
  expect(
    await t.query(api.forum.routeStatus, { categorySlug: "projects-private" }),
  ).toMatchObject({ exists: false });
  const categories = await t.query(api.forum.listCategories, {});
  expect(
    categories.find((category) => category._id === seed.child),
  ).toMatchObject({ readOnlyArchive: true, isPostable: false });
  expect(
    categories.find((category) => category._id === seed.crypto)?.name,
  ).toBe("Web3");
  expect(
    (await owner.query(api.forum.listCategoryOptions, {})).some(
      (category) => category._id === seed.child,
    ),
  ).toBe(false);
  await expect(
    owner.mutation(api.forum.createThread, {
      categorySlug: "projects-build-logs",
      title: "Cannot bypass archive",
      body: "Even staff cannot create a new thread in a read-only archive.",
    }),
  ).rejects.toThrow(/read-only archive/i);
  await expect(
    owner.mutation(api.forum.createReply, {
      threadId: seed.thread,
      body: "Even staff cannot add a new reply to archived history.",
    }),
  ).rejects.toThrow(/read-only archive/i);
  await expect(
    owner.mutation(api.forum.votePoll, {
      pollId: seed.poll,
      optionId: seed.option,
    }),
  ).rejects.toThrow(/read-only archive/i);
  const second = await owner.query(api.forum.previewForumTaxonomy, {
    now: Date.now(),
  });
  expect(second.changes).toEqual([]);
  expect(
    (
      await owner.mutation(api.forum.applyForumTaxonomy, {
        expectedFingerprint: second.fingerprint,
        confirmation: "preserve-urls-and-holds",
      })
    ).applied,
  ).toBe(false);
  const restored = await owner.mutation(api.forum.restoreForumTaxonomy, {
    auditId: applied.auditId!,
    confirmation: "restore-saved-taxonomy",
  });
  expect(restored.restored).toBe(applied.inverseManifest.length);
  expect(
    await t.run((ctx) => ctx.db.get("forumCategories", seed.projects)),
  ).toMatchObject({ parentCategoryId: seed.section });
  expect(
    await t.run((ctx) => ctx.db.get("forumCategories", seed.crypto)),
  ).toMatchObject({ name: "Crypto" });
  await expect(
    owner.mutation(api.forum.restoreForumTaxonomy, {
      auditId: applied.auditId!,
      confirmation: "restore-saved-taxonomy",
    }),
  ).rejects.toThrow(/changed after migration/i);
});

test("archive inheritance cannot be overridden by a child's false flag", async () => {
  const { t, seed, owner } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.patch("forumCategories", seed.projects, {
      readOnlyArchive: true,
    });
    await ctx.db.patch("forumCategories", seed.child, {
      readOnlyArchive: false,
    });
  });
  await expect(
    owner.mutation(api.forum.createReply, {
      threadId: seed.thread,
      body: "A local false flag must not reopen an archived descendant.",
    }),
  ).rejects.toThrow(/read-only archive/i);
  expect(
    await t.query(api.forum.routeStatus, {
      categorySlug: "projects-build-logs",
      threadSlug: "kept-at-original-url",
    }),
  ).toMatchObject({ exists: true });
});

test("a changed preview or restrictive inherited visibility blocks migration", async () => {
  const { t, seed, owner } = await setup();
  const preview = await owner.query(api.forum.previewForumTaxonomy, {
    now: Date.now(),
  });
  await t.run((ctx) =>
    ctx.db.patch("forumCategories", seed.ai, { name: "New AI name" }),
  );
  await expect(
    owner.mutation(api.forum.applyForumTaxonomy, {
      expectedFingerprint: preview.fingerprint,
      confirmation: "preserve-urls-and-holds",
    }),
  ).rejects.toThrow(/changed/i);
  await t.run((ctx) =>
    ctx.db.patch("forumCategories", seed.section, { viewAccess: "staff" }),
  );
  const restricted = await owner.query(api.forum.previewForumTaxonomy, {
    now: Date.now(),
  });
  expect(restricted.canApply).toBe(false);
  expect(restricted.blockers.join(" ")).toMatch(/widen inherited access/i);
});

test.each(["checkout", "submitted", "held"] as const)(
  "past-window %s placements still fence archival without touching receipts",
  async (status) => {
    const { t, seed, owner } = await setup();
    const intent = await t.run(async (ctx) =>
      ctx.db.insert("forumPromotionIntents", {
        authUserId: "test-owner",
        userId: seed.ownerId,
        wallet: "test-wallet",
        threadId: seed.thread,
        categoryId: seed.child,
        categorySlug: "projects-build-logs",
        treasury: "test-treasury",
        mint: "test-mint",
        tokenProgram: "test-program",
        decimals: 6,
        amountRaw: "100",
        treasuryAmountRaw: "50",
        burnAmountRaw: "50",
        reference: "test-reference",
        lane: 0,
        startsAt: Date.now() - 172_800_000,
        endsAt: Date.now() - 86_400_000,
        createdAt: Date.now(),
        checkoutExpiresAt: Date.now() + 60_000,
        status,
      }),
    );
    const before = await t.run((ctx) =>
      ctx.db.get("forumPromotionIntents", intent),
    );
    const preview = await owner.query(api.forum.previewForumTaxonomy, {
      now: Date.now(),
    });
    expect(preview.canApply).toBe(false);
    await expect(
      owner.mutation(api.forum.applyForumTaxonomy, {
        expectedFingerprint: preview.fingerprint,
        confirmation: "preserve-urls-and-holds",
      }),
    ).rejects.toThrow(/paid placement/i);
    expect(
      await t.run((ctx) => ctx.db.get("forumPromotionIntents", intent)),
    ).toEqual(before);
  },
);
