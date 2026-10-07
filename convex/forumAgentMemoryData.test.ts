/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import ragTest from "@convex-dev/rag/test";
import { defaultChunker } from "@convex-dev/rag";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { memoryIndexFunctions } from "./forumAgentMemoryData";
import { internal, components } from "./_generated/api";
import { OPENROUTER_EMBEDDING_MODEL } from "../lib/ai-models";
const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
async function setup() {
  const t = convexTest(schema, modules);
  ragTest.register(t);
  const ids = await t.run(async (ctx) => {
    const authorId = await ctx.db.insert("users", { name: "Memory author" });
    const categoryId = await ctx.db.insert("forumCategories", {
      slug: "memory-public",
      name: "Public",
      description: "Fixture",
      kind: "board",
      status: "active",
      viewAccess: "public",
      position: 0,
      threadCount: 1,
      postCount: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    const threadId = await ctx.db.insert("forumThreads", {
      categoryId,
      categorySlug: "memory-public",
      slug: "memory-source",
      title: "Full source",
      body: "Preserve this complete source and its reproducible observations.",
      authorId,
      status: "active",
      pinned: false,
      replyCount: 0,
      viewCount: 0,
      lastPostAt: 1,
      lastPostUserId: authorId,
      searchText: "full source",
      createdAt: 1,
      updatedAt: 1,
    });
    return { categoryId, threadId };
  });
  const claim = (token = "first", model = OPENROUTER_EMBEDDING_MODEL) =>
    t.mutation(memoryIndexFunctions.claim, {
      threadId: ids.threadId,
      token,
      model,
    });
  const commit = async (token = "first") => {
    const row = await t.run((ctx) =>
      ctx.db
        .query("forumAgentMemoryIndexes")
        .withIndex("by_threadId", (q) => q.eq("threadId", ids.threadId))
        .unique(),
    );
    const source = await t.query(
      internal.forumAgentEditorialData.readThreadForMemory,
      { threadId: ids.threadId },
    );
    if (!row?.leaseHash || !source)
      throw new Error("Expected source and lease");
    return await t.mutation(memoryIndexFunctions.commit, {
      threadId: ids.threadId,
      token,
      contentHash: row.leaseHash,
      chunks: defaultChunker(`${source.title}\n\n${source.body}`).map(
        (text) => ({ text, embedding: Array(1536).fill(0.01) }),
      ),
    });
  };
  return { t, ...ids, claim, commit };
}
describe("forum memory indexing admission and fenced commit", () => {
  test("completed content retries skip provider work, while model changes require a new index", async () => {
    const { t, threadId, claim, commit } = await setup();
    expect((await claim()).claimed).toBe(true);
    expect(await commit()).toMatchObject({ committed: true, reason: "ready" });
    expect(await claim("retry")).toEqual({
      claimed: false,
      reason: "unchanged",
    });
    expect(
      await t.action(internal.forumAgentMemory.indexForumThread, { threadId }),
    ).toEqual({ status: "skipped", reason: "unchanged" });
    expect((await claim("new-model", "different/model")).claimed).toBe(true);
    expect(await commit("new-model")).toMatchObject({
      committed: true,
      reason: "ready",
    });
  });
  test("duplicate claims are busy without additional recovery jobs or spend reservations", async () => {
    const { t, threadId, claim } = await setup();
    await claim();
    expect(await claim("duplicate")).toEqual({
      claimed: false,
      reason: "busy",
    });
    expect(
      await t.action(internal.forumAgentMemory.indexForumThread, { threadId }),
    ).toEqual({ status: "skipped", reason: "busy" });
    await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      expect(
        jobs.filter(
          (job) =>
            job.name === "forumAgentMemoryData:recoverLease" &&
            job.state.kind === "pending",
        ),
      ).toHaveLength(1);
      expect(
        jobs.filter((job) => job.name === "forumAgentMemory:indexForumThread"),
      ).toEqual([]);
      expect(await ctx.db.query("aiModelCallReservations").take(1)).toEqual([]);
    });
  });
  test("rapid edits coalesce one follow-up and reject the old vectors before RAG writes", async () => {
    const { t, threadId, claim } = await setup();
    const first = await claim();
    if (!first.claimed) throw new Error("Expected claim");
    for (const body of [
      "Edited complete source.",
      "The newest complete source.",
    ]) {
      await t.run((ctx) => ctx.db.patch("forumThreads", threadId, { body }));
      expect(await claim(`edit:${body}`)).toEqual({
        claimed: false,
        reason: "busy",
      });
    }
    const result = await t.mutation(memoryIndexFunctions.commit, {
      threadId,
      token: "first",
      contentHash: first.contentHash,
      chunks: [
        {
          text: `${first.source.title}\n\n${first.source.body}`,
          embedding: Array(1536).fill(0.01),
        },
      ],
    });
    expect(result).toMatchObject({ committed: false, reason: "changed" });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("forumAgentMemoryIndexes")
        .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
        .unique();
      expect(row?.completedHash).toBeUndefined();
      expect(
        (await ctx.db.system.query("_scheduled_functions").collect()).filter(
          (job) => job.name === "forumAgentMemory:indexForumThread",
        ),
      ).toHaveLength(1);
    });
    expect(
      (
        await t.query(components.rag.entries.list, {
          status: "ready",
          paginationOpts: { cursor: null, numItems: 10 },
        })
      ).page,
    ).toEqual([]);
    const next = await claim("newest");
    expect(next.claimed && next.source.body).toBe(
      "The newest complete source.",
    );
  });
  test("an edit without a second claim still schedules its newest content after stale completion", async () => {
    const { t, threadId, claim } = await setup();
    const first = await claim();
    if (!first.claimed) throw new Error("Expected claim");
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", threadId, {
        body: "An edit before any queued action starts.",
      }),
    );
    expect(
      await t.mutation(memoryIndexFunctions.commit, {
        threadId,
        token: "first",
        contentHash: first.contentHash,
        chunks: [],
      }),
    ).toMatchObject({ committed: false, reason: "changed" });
    expect(
      (
        await t.run((ctx) =>
          ctx.db.system.query("_scheduled_functions").collect(),
        )
      ).filter((job) => job.state.kind === "pending"),
    ).toHaveLength(1);
  });
  test("hidden boards fail closed both before embedding and before committing", async () => {
    const { t, categoryId, threadId, claim } = await setup();
    const first = await claim();
    if (!first.claimed) throw new Error("Expected claim");
    await t.run((ctx) =>
      ctx.db.patch("forumCategories", categoryId, { viewAccess: "members" }),
    );
    expect(
      await t.mutation(memoryIndexFunctions.commit, {
        threadId,
        token: "first",
        contentHash: first.contentHash,
        chunks: [],
      }),
    ).toMatchObject({ committed: false, reason: "hidden" });
    expect(await claim("hidden")).toEqual({ claimed: false, reason: "hidden" });
    expect(
      (
        await t.query(components.rag.entries.list, {
          status: "ready",
          paginationOpts: { cursor: null, numItems: 10 },
        })
      ).page,
    ).toEqual([]);

    await t.run(async (ctx) => {
      expect(
        (
          await ctx.db
            .query("forumAgentMemoryIndexes")
            .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
            .unique()
        )?.completedHash,
      ).toBeUndefined();
    });
  });
  test("expired claims cannot overwrite or release a newer lease", async () => {
    const { t, threadId, claim, commit } = await setup();
    const first = await claim();
    if (!first.claimed) throw new Error("Expected claim");
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("forumAgentMemoryIndexes")
        .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
        .unique();
      if (!row) throw new Error("Expected lease");
      await ctx.db.patch("forumAgentMemoryIndexes", row._id, {
        leaseExpiresAt: Date.now() - 1,
      });
      await ctx.db.patch("forumThreads", threadId, {
        body: "New lease owns the updated source.",
      });
    });
    expect((await claim("newer")).claimed).toBe(true);
    expect(
      await t.mutation(memoryIndexFunctions.commit, {
        threadId,
        token: "first",
        contentHash: first.contentHash,
        chunks: [],
      }),
    ).toMatchObject({ committed: false, reason: "lost-lease" });
    await t.mutation(memoryIndexFunctions.release, {
      threadId,
      token: "first",
    });
    expect(await commit("newer")).toMatchObject({ committed: true });
  });
  test("failed RAG input does not stamp completion and retries can recover", async () => {
    const { t, threadId, claim, commit } = await setup();
    const first = await claim();
    if (!first.claimed) throw new Error("Expected claim");
    await expect(
      t.mutation(memoryIndexFunctions.commit, {
        threadId,
        token: "first",
        contentHash: first.contentHash,
        chunks: [],
      }),
    ).rejects.toThrow("Invalid pre-embedded");
    await t.mutation(memoryIndexFunctions.release, {
      threadId,
      token: "first",
    });
    expect((await claim("retry")).claimed).toBe(true);
    expect(await commit("retry")).toMatchObject({ committed: true });
  });
  test("abandoned same-content leases recover with the existing two-retry ceiling", async () => {
    const { t, threadId } = await setup();
    for (let attempt = 0; attempt <= 2; attempt++) {
      const token = `abandoned:${attempt}`;
      expect(
        (
          await t.mutation(memoryIndexFunctions.claim, {
            threadId,
            model: OPENROUTER_EMBEDDING_MODEL,
            token,
            attempt,
          })
        ).claimed,
      ).toBe(true);
      expect(
        await t.mutation(memoryIndexFunctions.claim, {
          threadId,
          model: OPENROUTER_EMBEDDING_MODEL,
          token: "duplicate",
          attempt,
        }),
      ).toEqual({ claimed: false, reason: "busy" });
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("forumAgentMemoryIndexes")
          .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
          .unique();
        if (!row) throw new Error("Expected lease");
        expect(row.leaseAttempt).toBe(attempt);
        expect(
          (
            await ctx.db.system.get(
              "_scheduled_functions",
              row.leaseRecoveryId!,
            )
          )?.name,
        ).toBe("forumAgentMemoryData:recoverLease");
        await ctx.db.patch("forumAgentMemoryIndexes", row._id, {
          leaseExpiresAt: Date.now() - 1,
        });
      });
      expect(
        await t.mutation(memoryIndexFunctions.recover, {
          threadId,
          token,
          attempt,
        }),
      ).toEqual({ recovered: true, retryScheduled: attempt < 2 });
      const retries = (
        await t.run((ctx) =>
          ctx.db.system.query("_scheduled_functions").collect(),
        )
      ).filter((job) => job.name === "forumAgentMemory:indexForumThread");
      expect(retries).toHaveLength(Math.min(attempt + 1, 2));
      if (attempt < 2)
        expect(retries.at(-1)?.args).toEqual([
          { threadId, attempt: attempt + 1 },
        ]);
    }
    expect(
      await t.mutation(memoryIndexFunctions.claim, {
        threadId,
        model: OPENROUTER_EMBEDDING_MODEL,
        token: "excess",
        attempt: 3,
      }),
    ).toEqual({ claimed: false, reason: "retry-limit" });
  });
  test("recovery preserves a newer edit even when the abandoned generation exhausted its retries", async () => {
    const { t, threadId } = await setup();
    await t.mutation(memoryIndexFunctions.claim, {
      threadId,
      model: OPENROUTER_EMBEDDING_MODEL,
      token: "old",
      attempt: 2,
    });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("forumAgentMemoryIndexes")
        .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
        .unique();
      if (!row) throw new Error("Expected lease");
      await ctx.db.patch("forumAgentMemoryIndexes", row._id, {
        leaseExpiresAt: Date.now() - 1,
      });
      await ctx.db.patch("forumThreads", threadId, {
        body: "This newest edited source needs its own bounded attempt.",
      });
    });
    expect(
      await t.mutation(memoryIndexFunctions.recover, {
        threadId,
        token: "old",
        attempt: 2,
      }),
    ).toEqual({ recovered: true, retryScheduled: true });
    const retries = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      )
    ).filter((job) => job.name === "forumAgentMemory:indexForumThread");
    expect(retries).toHaveLength(1);
    expect(retries[0]?.args).toEqual([{ threadId, attempt: 0 }]);
  });
  test("successful completion cancels recovery so no provider action runs later", async () => {
    vi.useFakeTimers();
    try {
      const { t, threadId, claim, commit } = await setup();
      await claim();
      expect(await commit()).toMatchObject({ committed: true });
      const jobs = await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      expect(
        jobs.find((job) => job.name === "forumAgentMemoryData:recoverLease")
          ?.state.kind,
      ).toBe("canceled");
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(
        await t.mutation(memoryIndexFunctions.recover, {
          threadId,
          token: "first",
          attempt: 0,
        }),
      ).toEqual({ recovered: false, retryScheduled: false });
      await t.run(async (ctx) => {
        expect(await ctx.db.query("aiModelCallReservations").take(1)).toEqual(
          [],
        );
        expect(
          (await ctx.db.system.query("_scheduled_functions").collect()).filter(
            (job) => job.name === "forumAgentMemory:indexForumThread",
          ),
        ).toEqual([]);
      });
    } finally {
      vi.useRealTimers();
    }
  });
  test("stale recovery cannot clear, cancel, or schedule over a newer lease", async () => {
    const { t, threadId, claim } = await setup();
    await claim();
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("forumAgentMemoryIndexes")
        .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
        .unique();
      if (!row) throw new Error("Expected lease");
      await ctx.db.patch("forumAgentMemoryIndexes", row._id, {
        leaseExpiresAt: Date.now() - 1,
      });
    });
    await claim("newer");
    expect(
      await t.mutation(memoryIndexFunctions.recover, {
        threadId,
        token: "first",
        attempt: 0,
      }),
    ).toEqual({ recovered: false, retryScheduled: false });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("forumAgentMemoryIndexes")
        .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
        .unique();
      expect(row?.leaseToken).toBe("newer");
      expect(
        (await ctx.db.system.get("_scheduled_functions", row!.leaseRecoveryId!))
          ?.state.kind,
      ).toBe("pending");
      expect(
        (await ctx.db.system.query("_scheduled_functions").collect()).filter(
          (job) => job.name === "forumAgentMemory:indexForumThread",
        ),
      ).toEqual([]);
    });
  });
  test("releasing a lease cancels expiry recovery and retains a coalesced edit follow-up", async () => {
    const { t, threadId, claim } = await setup();
    await claim();
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", threadId, {
        body: "A complete changed source after provider failure.",
      }),
    );
    await claim("edited");
    await t.mutation(memoryIndexFunctions.release, {
      threadId,
      token: "first",
    });
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      jobs.find((job) => job.name === "forumAgentMemoryData:recoverLease")
        ?.state.kind,
    ).toBe("canceled");
    expect(
      jobs.filter(
        (job) =>
          job.name === "forumAgentMemory:indexForumThread" &&
          job.state.kind === "pending",
      ),
    ).toHaveLength(1);
  });

  test("a transient edit restored before release cannot reset identical-content retry bounds", async () => {
    const { t, threadId } = await setup();
    const first = await t.mutation(memoryIndexFunctions.claim, {
      threadId,
      model: OPENROUTER_EMBEDDING_MODEL,
      token: "last",
      attempt: 2,
    });
    if (!first.claimed) throw new Error("Expected lease");
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", threadId, { body: "Temporary edit." }),
    );
    await t.mutation(memoryIndexFunctions.claim, {
      threadId,
      model: OPENROUTER_EMBEDDING_MODEL,
      token: "edited",
      attempt: 0,
    });
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", threadId, { body: first.source.body }),
    );
    await t.mutation(memoryIndexFunctions.release, { threadId, token: "last" });
    expect(
      (
        await t.run((ctx) =>
          ctx.db.system.query("_scheduled_functions").collect(),
        )
      ).filter((job) => job.name === "forumAgentMemory:indexForumThread"),
    ).toEqual([]);
  });
  test("oversized chunk sets hold intact before any lease or provider reservation", async () => {
    const { t, threadId, claim } = await setup();
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", threadId, {
        body: Array(110).fill("a".repeat(1000)).join("\n\n"),
      }),
    );
    expect(await claim()).toEqual({ claimed: false, reason: "chunk-limit" });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumAgentMemoryIndexes").take(1)).toEqual([]);
    });
  });
});
