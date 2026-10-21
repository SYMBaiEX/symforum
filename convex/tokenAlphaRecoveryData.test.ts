/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { STRUCTURED_CANARY_KEY } from "./aiRoutingControlData";
import schema from "./schema";
import { validateBagsRetry } from "./tokenAlphaRecoveryData";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const NOW = Date.parse("2026-10-21T21:00:00.000Z");
const SOURCE_RUN_KEY = "bags:2026-10-21T20";
const SOURCE_JOB_ID = "eliza-bags-definite-404";
const HASH = "a".repeat(64);
const RETRY_RUN_KEY = `${SOURCE_RUN_KEY}:operator-retry-1`;

function setup() {
  // Scheduled actions remain private pending records. These tests never run
  // model generation or make provider requests, even after runAfter(0).
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
  vi.stubEnv("FORUM_AGENT_DAILY_PUBLICATION_LIMIT", "18");
  return convexTest(schema, modules);
}

async function fixture(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const controlId = await ctx.db.insert("tokenAlphaControl", {
      key: "pilot",
      enabled: true,
      operatorFirstPostAttempts: ["bags", "pumpfun"],
      updatedAt: NOW,
    });
    const sourceId = await ctx.db.insert("tokenAlphaRuns", {
      runKey: SOURCE_RUN_KEY,
      platform: "bags",
      claimToken: "original-claim",
      operatorFirstPost: true,
      status: "failed",
      createdAt: NOW - 3_600_000,
      updatedAt: NOW - 3_500_000,
      expiresAt: NOW - 1_800_000,
      reason: "token-pilot-generation-data-or-publication-failed",
    });
    const forumRunId = await ctx.db.insert("forumAgentRuns", {
      runKey: SOURCE_RUN_KEY,
      agentSlug: "bags-scout",
      runDate: "2026-10-21",
      slot: 20,
      attempt: 0,
      status: "failed",
      model: "openrouter/free",
      sourceUrls: [],
      startedAt: NOW - 3_600_000,
      completedAt: NOW - 3_500_000,
      updatedAt: NOW - 3_500_000,
    });
    const callId = await ctx.db.insert("elizaRuntimeCalls", {
      jobId: SOURCE_JOB_ID,
      operationKey: SOURCE_RUN_KEY,
      inputHash: HASH,
      agentSlug: "bags-scout",
      stage: "bags-scout:forum-draft",
      model: "openrouter/free",
      status: "failed",
      providerStatus: 404,
      outcomeUnknown: false,
      createdAt: NOW - 3_600_000,
      updatedAt: NOW - 3_500_000,
      expiresAt: NOW + 30 * 86_400_000,
    });
    const operationId = await ctx.db.insert("elizaRuntimeOperations", {
      operationKey: SOURCE_RUN_KEY,
      status: "ready",
      jobId: SOURCE_JOB_ID,
      inputHash: HASH,
      updatedAt: NOW - 3_500_000,
    });
    return { controlId, sourceId, forumRunId, callId, operationId };
  });
}

async function queue(t: ReturnType<typeof setup>) {
  return await t.mutation(internal.tokenAlphaRecoveryData.queueBagsRetry, {
    failedRunKey: SOURCE_RUN_KEY,
    jobId: SOURCE_JOB_ID,
  });
}

async function readyFixture(t: ReturnType<typeof setup>) {
  const ids = await fixture(t);
  const infrastructure = await t.mutation(
    internal.tokenAlphaData.ensureInfrastructure,
    {},
  );
  await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true });
  const canaryId = await t.run(
    async (ctx) =>
      await ctx.db.insert("aiOperationalStates", {
        key: STRUCTURED_CANARY_KEY,
        healthy: true,
        checkedAt: NOW,
        pauseUntil: 0,
        updatedAt: NOW,
      }),
  );
  return { ...ids, infrastructure, canaryId };
}

async function claimRetry(t: ReturnType<typeof setup>) {
  return await t.mutation(internal.tokenAlphaData.claimRun, {
    platform: "bags",
    claimToken: "bounded-retry-claim",
    operatorRetryOf: SOURCE_RUN_KEY,
  });
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

type CallPatch = Partial<
  Omit<Doc<"elizaRuntimeCalls">, "_id" | "_creationTime">
>;
const invalidReceipts: Array<[string, CallPatch]> = [
  ["pending", { status: "pending" }],
  ["completed", { status: "completed" }],
  ["unknown outcome", { outcomeUnknown: true }],
  ["unspecified outcome", { outcomeUnknown: undefined }],
  ["provider timeout", { providerStatus: 504 }],
  ["rate-limited", { providerStatus: 429 }],
  ["missing status", { providerStatus: undefined }],
  ["paid model", { model: "openai/gpt-6-luna" }],
  ["wrong lane", { agentSlug: "pumpfun-scout" }],
  ["wrong generation stage", { stage: "bags-scout:forum-evidence-review" }],
  ["different source operation", { operationKey: "different-run" }],
  ["invalid input hash", { inputHash: "not-a-hash" }],
];

describe("bounded Bags retry receipt validation", () => {
  test.each(invalidReceipts)(
    "rejects a %s receipt without granting retry authority",
    async (_name, patch) => {
      const t = setup();
      const ids = await fixture(t);
      await t.run(
        async (ctx) =>
          await ctx.db.patch("elizaRuntimeCalls", ids.callId, patch),
      );
      expect(await queue(t)).toEqual({ queued: false });
      const control = await t.run(
        async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
      );
      expect(control?.operatorBagsRetry).toBeUndefined();
    },
  );

  test.each(["pending", "unknown"] as const)(
    "rejects an unresolved %s operation",
    async (status) => {
      const t = setup();
      const ids = await fixture(t);
      await t.run(
        async (ctx) =>
          await ctx.db.patch("elizaRuntimeOperations", ids.operationId, {
            status,
          }),
      );
      expect(await queue(t)).toEqual({ queued: false });
    },
  );

  test.each([
    ["different job", { jobId: "different-job" }],
    ["different input", { inputHash: "b".repeat(64) }],
    ["missing source operation", { operationKey: "unrelated-operation" }],
  ])("rejects a ready operation pointing to %s", async (_name, patch) => {
    const t = setup();
    const ids = await fixture(t);
    await t.run(
      async (ctx) =>
        await ctx.db.patch("elizaRuntimeOperations", ids.operationId, patch),
    );
    expect(await queue(t)).toEqual({ queued: false });
  });

  test("revalidates the source receipt at claim time instead of trusting the queue marker", async () => {
    const t = setup();
    const ids = await fixture(t);
    expect(await queue(t)).toEqual({ queued: true, runKey: RETRY_RUN_KEY });
    await t.run(
      async (ctx) =>
        await ctx.db.patch("elizaRuntimeOperations", ids.operationId, {
          status: "unknown",
        }),
    );
    expect(
      await t.run(
        async (ctx) =>
          await validateBagsRetry(ctx, SOURCE_RUN_KEY, SOURCE_JOB_ID),
      ),
    ).toBe(false);
    const operation = await t.run(
      async (ctx) =>
        await ctx.db.get("elizaRuntimeOperations", ids.operationId),
    );
    expect(operation?.status).toBe("unknown");
  });
});

type SourcePatch = Partial<
  Omit<Doc<"tokenAlphaRuns">, "_id" | "_creationTime">
>;
const invalidSources: Array<[string, SourcePatch]> = [
  ["other platform", { platform: "pumpfun" }],
  ["held outcome", { status: "held" }],
  ["published", { status: "published" }],
  ["still running", { status: "running" }],
  ["private analysis already generated", { analysis: "" }],
  ["title already generated", { title: "" }],
  ["body already generated", { body: "" }],
  ["a retry of a retry", { operatorRetryOf: "older-failed-run" }],
];

describe("bounded Bags retry source validation", () => {
  test.each(invalidSources)(
    "rejects a source with %s",
    async (_name, patch) => {
      const t = setup();
      const ids = await fixture(t);
      await t.run(
        async (ctx) =>
          await ctx.db.patch("tokenAlphaRuns", ids.sourceId, patch),
      );
      expect(await queue(t)).toEqual({ queued: false });
    },
  );

  test("requires the matching failed Bags forum run", async () => {
    const t = setup();
    const ids = await fixture(t);
    await t.run(
      async (ctx) =>
        await ctx.db.patch("forumAgentRuns", ids.forumRunId, {
          agentSlug: "pumpfun-scout",
        }),
    );
    expect(await queue(t)).toEqual({ queued: false });
    await t.run(
      async (ctx) =>
        await ctx.db.patch("forumAgentRuns", ids.forumRunId, {
          agentSlug: "bags-scout",
          status: "running",
        }),
    );
    expect(await queue(t)).toEqual({ queued: false });
  });

  test("requires no all-time Bags scout publication", async () => {
    const t = setup();
    await fixture(t);
    await t.run(
      async (ctx) =>
        await ctx.db.insert("forumAgentRuns", {
          runKey: "older-publication",
          agentSlug: "bags-scout",
          runDate: "2026-10-20",
          slot: 1,
          attempt: 0,
          status: "published",
          model: "openrouter/free",
          sourceUrls: [],
          startedAt: NOW - 86_400_000,
          updatedAt: NOW - 86_400_000,
        }),
    );
    expect(await queue(t)).toEqual({ queued: false });
  });

  test("rejects any existing source post or recorded follow-up", async () => {
    const t = setup();
    const ids = await fixture(t);
    const postId = await t.run(async (ctx) => {
      const authorId = await ctx.db.insert("users", { role: "reader" });
      const categoryId = await ctx.db.insert("forumCategories", {
        slug: "crypto-bags",
        name: "Bags.App",
        description: "Fixture",
        status: "active",
        position: 1,
        threadCount: 1,
        postCount: 1,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const threadId = await ctx.db.insert("forumThreads", {
        categoryId,
        categorySlug: "crypto-bags",
        slug: "fixture-thread",
        title: "Fixture",
        body: "Local test only",
        authorId,
        status: "active",
        pinned: false,
        replyCount: 1,
        viewCount: 0,
        lastPostAt: NOW,
        lastPostUserId: authorId,
        searchText: "Fixture",
        createdAt: NOW,
        updatedAt: NOW,
      });
      return await ctx.db.insert("forumPosts", {
        categoryId,
        threadId,
        authorId,
        body: "Fixture reply",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    await t.run(
      async (ctx) =>
        await ctx.db.patch("tokenAlphaRuns", ids.sourceId, { postId }),
    );
    expect(await queue(t)).toEqual({ queued: false });
    await t.run(async (ctx) => {
      await ctx.db.patch("tokenAlphaRuns", ids.sourceId, { postId: undefined });
      await ctx.db.patch("forumAgentRuns", ids.forumRunId, {
        followUpPostId: postId,
      });
    });
    expect(await queue(t)).toEqual({ queued: false });
  });

  test("fails closed for an absent source or job", async () => {
    const t = setup();
    await fixture(t);
    expect(
      await t.mutation(internal.tokenAlphaRecoveryData.queueBagsRetry, {
        failedRunKey: "absent-source",
        jobId: SOURCE_JOB_ID,
      }),
    ).toEqual({ queued: false });
    expect(
      await t.mutation(internal.tokenAlphaRecoveryData.queueBagsRetry, {
        failedRunKey: SOURCE_RUN_KEY,
        jobId: "absent-job",
      }),
    ).toEqual({ queued: false });
  });
});

type ReadyFixture = Awaited<ReturnType<typeof readyFixture>>;
type GateCase = {
  name: string;
  block: (t: ReturnType<typeof setup>, ids: ReadyFixture) => Promise<unknown>;
};

const preservedClaimGates: GateCase[] = [
  {
    name: "disabled pilot",
    block: async (t, ids) =>
      await t.run(
        async (ctx) =>
          await ctx.db.patch("tokenAlphaControl", ids.controlId, {
            enabled: false,
          }),
      ),
  },
  {
    name: "disabled Bags agent",
    block: async (t, ids) =>
      await t.run(
        async (ctx) =>
          await ctx.db.patch(
            "forumAgents",
            ids.infrastructure.agents[0].agentId,
            { enabled: false },
          ),
      ),
  },
  {
    name: "banned Bags identity",
    block: async (t, ids) =>
      await t.run(
        async (ctx) =>
          await ctx.db.patch("users", ids.infrastructure.agents[0].userId, {
            forumBannedAt: NOW,
          }),
      ),
  },
  {
    name: "revoked Bags identity",
    block: async (t, ids) =>
      await t.run(
        async (ctx) =>
          await ctx.db.patch("users", ids.infrastructure.agents[0].userId, {
            agentStatus: "revoked",
          }),
      ),
  },
  {
    name: "unhealthy canary",
    block: async (t, ids) =>
      await t.run(
        async (ctx) =>
          await ctx.db.patch("aiOperationalStates", ids.canaryId, {
            healthy: false,
          }),
      ),
  },
  {
    name: "stale canary",
    block: async (t, ids) =>
      await t.run(
        async (ctx) =>
          await ctx.db.patch("aiOperationalStates", ids.canaryId, {
            checkedAt: NOW - 2 * 3_600_000 - 1,
          }),
      ),
  },
  {
    name: "changed uncertain source receipt",
    block: async (t, ids) =>
      await t.run(
        async (ctx) =>
          await ctx.db.patch("elizaRuntimeCalls", ids.callId, {
            outcomeUnknown: true,
          }),
      ),
  },
  {
    name: "pending source operation",
    block: async (t, ids) =>
      await t.run(
        async (ctx) =>
          await ctx.db.patch("elizaRuntimeOperations", ids.operationId, {
            status: "pending",
          }),
      ),
  },
  {
    name: "unknown source operation",
    block: async (t, ids) =>
      await t.run(
        async (ctx) =>
          await ctx.db.patch("elizaRuntimeOperations", ids.operationId, {
            status: "unknown",
          }),
      ),
  },
  {
    name: "another pending Bags operation",
    block: async (t) =>
      await t.run(
        async (ctx) =>
          await ctx.db.insert("elizaRuntimeOperations", {
            operationKey: "bags:older-pending",
            status: "pending",
            jobId: "other-job",
            inputHash: HASH,
            updatedAt: NOW,
          }),
      ),
  },
  {
    name: "another unknown Bags operation",
    block: async (t) =>
      await t.run(
        async (ctx) =>
          await ctx.db.insert("elizaRuntimeOperations", {
            operationKey: "bags:older-unknown",
            status: "unknown",
            jobId: "other-job",
            inputHash: HASH,
            updatedAt: NOW,
          }),
      ),
  },
  {
    name: "daily publication cap",
    block: async (t) =>
      await t.run(async (ctx) => {
        for (let slot = 0; slot < 18; slot += 1)
          await ctx.db.insert("forumAgentRuns", {
            runKey: `published-cap:${slot}`,
            agentSlug: "suki",
            runDate: "2026-10-21",
            slot,
            attempt: 0,
            status: "published",
            model: "openrouter/free",
            sourceUrls: [],
            startedAt: NOW,
            updatedAt: NOW,
          });
      }),
  },
  {
    name: "twelve local scout failures",
    block: async (t) =>
      await t.run(async (ctx) => {
        for (let slot = 0; slot < 11; slot += 1)
          await ctx.db.insert("forumAgentRuns", {
            runKey: `local-failure:${slot}`,
            agentSlug: "bags-scout",
            runDate: "2026-10-21",
            slot,
            attempt: 0,
            status: "failed",
            model: "openrouter/free",
            sourceUrls: [],
            startedAt: NOW,
            updatedAt: NOW,
          });
      }),
  },
];

describe("Bags recovery claim end to end", () => {
  test("consumes the authorized stable retry exactly once and blocks the ordinary same-hour run afterwards", async () => {
    const t = setup();
    const ids = await readyFixture(t);
    expect(await queue(t)).toEqual({ queued: true, runKey: RETRY_RUN_KEY });
    const claims = await Promise.all(
      Array.from({ length: 12 }, () => claimRetry(t)),
    );
    const accepted = claims.filter((claim) => claim !== null);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      runKey: RETRY_RUN_KEY,
      operatorRetryOf: SOURCE_RUN_KEY,
      status: "running",
    });
    let control = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
    );
    expect(control?.operatorBagsRetry?.claimedAt).toBe(NOW);
    await t.mutation(internal.tokenAlphaData.finishRun, {
      runKey: RETRY_RUN_KEY,
      claimToken: "bounded-retry-claim",
      status: "failed",
      reason: "No repeat after failure",
    });
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "ordinary-same-hour",
      }),
    ).toBeNull();
    await t.mutation(internal.tokenAlphaData.ensureInfrastructure, {});
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: false });
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true });
    vi.setSystemTime(NOW + 3_600_000);
    expect(await claimRetry(t)).toBeNull();
    expect(await queue(t)).toEqual({ queued: false });
    control = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
    );
    expect(control?.operatorBagsRetry?.claimedAt).toBe(NOW);
    const source = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaRuns", ids.sourceId),
    );
    expect(source).toMatchObject({
      runKey: SOURCE_RUN_KEY,
      status: "failed",
      claimToken: "original-claim",
    });
  });

  test("rejects missing, forged, consumed or wrong-lane authority", async () => {
    const t = setup();
    const ids = await readyFixture(t);
    expect(await claimRetry(t)).toBeNull();
    expect((await queue(t)).queued).toBe(true);
    const original = await t.run(
      async (ctx) =>
        (await ctx.db.get("tokenAlphaControl", ids.controlId))!
          .operatorBagsRetry!,
    );
    for (const patch of [
      { sourceRunKey: "different-source" },
      { sourceJobId: "different-job" },
      { runKey: "different-retry-key" },
      { claimedAt: NOW },
    ]) {
      await t.run(
        async (ctx) =>
          await ctx.db.patch("tokenAlphaControl", ids.controlId, {
            operatorBagsRetry: { ...original, ...patch },
          }),
      );
      expect(await claimRetry(t)).toBeNull();
    }
    await t.run(
      async (ctx) =>
        await ctx.db.patch("tokenAlphaControl", ids.controlId, {
          operatorBagsRetry: original,
        }),
    );
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "pumpfun",
        claimToken: "wrong-lane",
        operatorRetryOf: SOURCE_RUN_KEY,
      }),
    ).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "mixed-authority",
        operatorRetryOf: SOURCE_RUN_KEY,
        operatorFirstPost: true,
      }),
    ).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "wrong-source",
        operatorRetryOf: "different-source",
      }),
    ).toBeNull();
    expect(
      (
        await t.run(
          async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
        )
      )?.operatorBagsRetry?.claimedAt,
    ).toBeUndefined();
  });

  test.each(preservedClaimGates)(
    "preserves the $name gate without consuming retry authority",
    async ({ block }) => {
      const t = setup();
      const ids = await readyFixture(t);
      expect((await queue(t)).queued).toBe(true);
      await block(t, ids);
      expect(await claimRetry(t)).toBeNull();
      const control = await t.run(
        async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
      );
      expect(control?.operatorBagsRetry?.claimedAt).toBeUndefined();
    },
  );

  test("preserves the live-runtime gate at claim time", async () => {
    const t = setup();
    const ids = await readyFixture(t);
    expect((await queue(t)).queued).toBe(true);
    vi.stubEnv("ELIZA_RUNTIME_MODE", "off");
    expect(await claimRetry(t)).toBeNull();
    const control = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
    );
    expect(control?.operatorBagsRetry?.claimedAt).toBeUndefined();
  });

  test("does not clear or route around an unrelated Pump lane hold", async () => {
    const t = setup();
    await readyFixture(t);
    const pumpOperationId = await t.run(
      async (ctx) =>
        await ctx.db.insert("elizaRuntimeOperations", {
          operationKey: "pumpfun:older-unknown",
          status: "unknown",
          jobId: "pump-unknown-job",
          inputHash: HASH,
          updatedAt: NOW,
        }),
    );
    expect((await queue(t)).queued).toBe(true);
    expect(await claimRetry(t)).not.toBeNull();
    expect(
      (
        await t.run(
          async (ctx) =>
            await ctx.db.get("elizaRuntimeOperations", pumpOperationId),
        )
      )?.status,
    ).toBe("unknown");
  });
});

describe("one-shot internal Bags retry queue", () => {
  test("concurrent authorization queues one stable retry and preserves all source records", async () => {
    const t = setup();
    const ids = await fixture(t);
    const readSource = async () =>
      await t.run(async (ctx) => ({
        source: await ctx.db.get("tokenAlphaRuns", ids.sourceId),
        forum: await ctx.db.get("forumAgentRuns", ids.forumRunId),
        call: await ctx.db.get("elizaRuntimeCalls", ids.callId),
        operation: await ctx.db.get("elizaRuntimeOperations", ids.operationId),
      }));
    const before = await readSource();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => queue(t)),
    );
    expect(results.filter((result) => result.queued)).toEqual([
      { queued: true, runKey: RETRY_RUN_KEY },
    ]);
    expect(await readSource()).toEqual(before);
    const stored = await t.run(async (ctx) => ({
      control: await ctx.db.get("tokenAlphaControl", ids.controlId),
      scheduled: await ctx.db.system.query("_scheduled_functions").take(3),
    }));
    expect(stored.control?.operatorBagsRetry).toEqual({
      sourceRunKey: SOURCE_RUN_KEY,
      sourceJobId: SOURCE_JOB_ID,
      runKey: RETRY_RUN_KEY,
      authorizedAt: NOW,
    });
    expect(stored.control?.operatorFirstPostAttempts).toEqual([
      "bags",
      "pumpfun",
    ]);
    expect(stored.scheduled).toHaveLength(1);
    expect(stored.scheduled[0].args).toEqual([
      { platform: "bags", operatorRetryOf: SOURCE_RUN_KEY },
    ]);
  });

  test("never resets retry authorization on ensure or disable/enable, even after an unknown retry", async () => {
    const t = setup();
    const ids = await fixture(t);
    expect((await queue(t)).queued).toBe(true);
    await t.mutation(internal.tokenAlphaData.ensureInfrastructure, {});
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: false });
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true });
    const marker = await t.run(async (ctx) => {
      const control = await ctx.db.get("tokenAlphaControl", ids.controlId);
      await ctx.db.patch("tokenAlphaControl", ids.controlId, {
        operatorBagsRetry: { ...control!.operatorBagsRetry!, claimedAt: NOW },
      });
      await ctx.db.insert("tokenAlphaRuns", {
        runKey: RETRY_RUN_KEY,
        platform: "bags",
        claimToken: "retry-claim",
        operatorRetryOf: SOURCE_RUN_KEY,
        status: "failed",
        createdAt: NOW,
        updatedAt: NOW,
        expiresAt: NOW + 1_800_000,
        reason: "Unknown provider outcome",
      });
      return control!.operatorBagsRetry;
    });
    expect(marker).toMatchObject({
      sourceRunKey: SOURCE_RUN_KEY,
      runKey: RETRY_RUN_KEY,
    });
    expect(await queue(t)).toEqual({ queued: false });
    const control = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
    );
    expect(control?.operatorBagsRetry?.claimedAt).toBe(NOW);
  });

  test("requires the live pilot and rejects an existing stable retry key", async () => {
    const t = setup();
    const ids = await fixture(t);
    vi.stubEnv("ELIZA_RUNTIME_MODE", "off");
    expect(await queue(t)).toEqual({ queued: false });
    vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
    await t.run(
      async (ctx) =>
        await ctx.db.patch("tokenAlphaControl", ids.controlId, {
          enabled: false,
        }),
    );
    expect(await queue(t)).toEqual({ queued: false });
    await t.run(async (ctx) => {
      await ctx.db.patch("tokenAlphaControl", ids.controlId, { enabled: true });
      await ctx.db.insert("tokenAlphaRuns", {
        runKey: RETRY_RUN_KEY,
        platform: "bags",
        claimToken: "already-exists",
        status: "held",
        createdAt: NOW,
        updatedAt: NOW,
        expiresAt: NOW + 1_800_000,
      });
    });
    expect(await queue(t)).toEqual({ queued: false });
    const control = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
    );
    expect(control?.operatorBagsRetry).toBeUndefined();
  });
});
