/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { OPENROUTER_TOKEN_SCOUT_MODEL } from "../lib/ai-models";
import type { Doc } from "./_generated/dataModel";
import { STRUCTURED_CANARY_KEY } from "./aiRoutingControlData";
import schema from "./schema";
import {
  validateBagsGrammarVerification,
  validateBagsRetry,
  validateBagsValidationVerification,
} from "./tokenAlphaRecoveryData";

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

const DATA_SOURCE_KEY = "bags:2026-10-21T21";
const DATA_RECOVERY_KEY = `${DATA_SOURCE_KEY}:operator-data-recovery-1`;
const DATA_FAILURE = "token-pilot-mint-verification-failed:http-429";
const OLD_CONSUMED_RETRY = {
  sourceRunKey: SOURCE_RUN_KEY,
  sourceJobId: SOURCE_JOB_ID,
  runKey: RETRY_RUN_KEY,
  authorizedAt: NOW - 3_600_000,
  claimedAt: NOW - 3_500_000,
};
const SNAPSHOT = {
  platform: "bags" as const,
  mint: "5Qg8WaTcehq12jt9KmM3No84K2DYvfEQUJUzDLAKBAGS",
  name: "Fixture",
  symbol: "FIX",
  observedAt: NOW,
  metricsAsOf: NOW,
  priceUsd: 1,
  marketCapUsd: 1,
  holders: 1,
  volume1hUsd: 1,
  liquidityUsd: 1,
  priceChange1hPercent: null,
  imageUrl: null,
  website: null,
  twitter: null,
  telegram: null,
  description: null,
  sourceUrl: "https://bags.fm/fixture",
  sourceRank: 1,
};

async function dataReadyFixture(t: ReturnType<typeof setup>) {
  const ids = await readyFixture(t);
  await t.run(async (ctx) => {
    await ctx.db.delete("elizaRuntimeCalls", ids.callId);
    await ctx.db.delete("elizaRuntimeOperations", ids.operationId);
    await ctx.db.patch("tokenAlphaRuns", ids.sourceId, {
      runKey: DATA_SOURCE_KEY,
      operatorFirstPost: undefined,
      reason: DATA_FAILURE,
      createdAt: NOW - 60_000,
      updatedAt: NOW - 50_000,
    });
    await ctx.db.patch("forumAgentRuns", ids.forumRunId, {
      runKey: DATA_SOURCE_KEY,
      slot: 21,
      model: OPENROUTER_TOKEN_SCOUT_MODEL,
      errorMessage: DATA_FAILURE,
    });
    await ctx.db.patch("tokenAlphaControl", ids.controlId, {
      operatorBagsRetry: OLD_CONSUMED_RETRY,
    });
  });
  return ids;
}

async function queueDataRecovery(t: ReturnType<typeof setup>) {
  return await t.mutation(
    internal.tokenAlphaRecoveryData.queueBagsDataRecovery,
    {
      failedRunKey: DATA_SOURCE_KEY,
    },
  );
}

async function claimDataRecovery(t: ReturnType<typeof setup>) {
  return await t.mutation(internal.tokenAlphaData.claimRun, {
    platform: "bags",
    claimToken: "data-recovery-claim",
    operatorRetryOf: DATA_SOURCE_KEY,
  });
}

const invalidDataSources: Array<[string, SourcePatch]> = [
  ...invalidSources,
  ["operator first-post run", { operatorFirstPost: true }],
  ["flagged operator first-post run", { operatorFirstPost: false }],
  [
    "different RPC status",
    { reason: "token-pilot-mint-verification-failed:http-403" },
  ],
  ["different data stage", { reason: "token-pilot-rankings-failed:http-429" }],
  ["model failure", { reason: "token-pilot-model-draft-failed:http-429" }],
  [
    "generic old failure",
    { reason: "token-pilot-generation-data-or-publication-failed" },
  ],
  ["missing failure reason", { reason: undefined }],
  ["already selected snapshot", { snapshot: SNAPSHOT }],
  ["prior snapshot", { previous: SNAPSHOT }],
  ["previous hourly key", { runKey: SOURCE_RUN_KEY }],
  ["retry-shaped key", { runKey: DATA_RECOVERY_KEY }],
];

describe("one approved pre-model Bags data recovery", () => {
  test.each(invalidDataSources)(
    "rejects %s without granting authority",
    async (_name, patch) => {
      const t = setup();
      const ids = await dataReadyFixture(t);
      await t.run(
        async (ctx) =>
          await ctx.db.patch("tokenAlphaRuns", ids.sourceId, patch),
      );
      expect(await queueDataRecovery(t)).toEqual({ queued: false });
      const control = await t.run(
        async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
      );
      expect(control?.operatorBagsDataRecovery).toBeUndefined();
      expect(control?.operatorBagsRetry).toEqual(OLD_CONSUMED_RETRY);
    },
  );

  test.each([
    ["missing source", ""],
    ["old ordinary slot", SOURCE_RUN_KEY],
    ["wrong platform", "pumpfun:2026-10-21T21"],
  ])("rejects %s", async (_name, failedRunKey) => {
    const t = setup();
    await dataReadyFixture(t);
    expect(
      await t.mutation(internal.tokenAlphaRecoveryData.queueBagsDataRecovery, {
        failedRunKey,
      }),
    ).toEqual({ queued: false });
  });

  const invalidForumPatches: Array<
    [string, Partial<Omit<Doc<"forumAgentRuns">, "_id" | "_creationTime">>]
  > = [
    ["foreign agent", { agentSlug: "pumpfun-scout" }],
    ["nonfailed forum run", { status: "running" }],
    ["different failure", { errorMessage: "different" }],
    ["free-model source", { model: "openrouter/free" }],
    ["proposed title", { title: "" }],
    ["selected sources", { sourceUrls: ["https://bags.fm/fixture"] }],
    ["proposed format", { contentFormat: "bbcode" }],
    ["input token usage", { inputTokens: 0 }],
    ["output token usage", { outputTokens: 0 }],
  ];
  test.each(invalidForumPatches)(
    "rejects a source forum run with %s",
    async (_name, patch) => {
      const t = setup();
      const ids = await dataReadyFixture(t);
      await t.run(
        async (ctx) =>
          await ctx.db.patch("forumAgentRuns", ids.forumRunId, patch),
      );
      expect(await queueDataRecovery(t)).toEqual({ queued: false });
    },
  );

  test.each(["ready", "pending", "unknown"] as const)(
    "rejects even a %s source operation",
    async (status) => {
      const t = setup();
      await dataReadyFixture(t);
      await t.run(
        async (ctx) =>
          await ctx.db.insert("elizaRuntimeOperations", {
            operationKey: DATA_SOURCE_KEY,
            status,
            jobId: "unexpected-model-operation",
            inputHash: HASH,
            updatedAt: NOW,
          }),
      );
      expect(await queueDataRecovery(t)).toEqual({ queued: false });
    },
  );

  test.each(["bags-scout", "foreign-agent"])(
    "rejects a model receipt even without its operation (%s)",
    async (agentSlug) => {
      const t = setup();
      await dataReadyFixture(t);
      await t.run(
        async (ctx) =>
          await ctx.db.insert("elizaRuntimeCalls", {
            operationKey: DATA_SOURCE_KEY,
            jobId: "unexpected-call",
            inputHash: HASH,
            agentSlug,
            stage: "forum-draft",
            model: OPENROUTER_TOKEN_SCOUT_MODEL,
            status: "failed",
            providerStatus: 400,
            outcomeUnknown: false,
            createdAt: NOW - 60_000,
            updatedAt: NOW,
            expiresAt: NOW - 1,
          }),
      );
      expect(await queueDataRecovery(t)).toEqual({ queued: false });
    },
  );

  test("fails closed when the bounded complete receipt scan reaches capacity", async () => {
    const t = setup();
    await dataReadyFixture(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 257; index += 1)
        await ctx.db.insert("elizaRuntimeCalls", {
          operationKey: `other:${index}`,
          jobId: `job-${index}`,
          inputHash: HASH,
          agentSlug: "other",
          stage: "other",
          model: "openrouter/free",
          status: "completed",
          createdAt: NOW,
          updatedAt: NOW,
          expiresAt: NOW + 1,
        });
    });
    expect(await queueDataRecovery(t)).toEqual({ queued: false });
  });

  test.each(["packet", "orphan revision"])(
    "rejects a private %s",
    async (kind) => {
      const t = setup();
      await dataReadyFixture(t);
      await t.run(async (ctx) => {
        const packetId = await ctx.db.insert("forumAgentResearchPackets", {
          runKey: kind === "packet" ? DATA_SOURCE_KEY : "other-packet",
          agentSlug: "bags-scout",
          state: "held",
          currentStage: "publication_decision",
          sourceCount: 0,
          createdAt: NOW,
          updatedAt: NOW,
        });
        if (kind !== "packet")
          await ctx.db.insert("forumAgentDraftRevisions", {
            packetId,
            runKey: DATA_SOURCE_KEY,
            agentSlug: "bags-scout",
            revision: 0,
            state: "held",
            title: "",
            body: "",
            contentHash: HASH,
            claimHash: HASH,
            claimCount: 0,
            createdAt: NOW,
            updatedAt: NOW,
          });
      });
      expect(await queueDataRecovery(t)).toEqual({ queued: false });
    },
  );

  test("rejects an all-time Bags publication", async () => {
    const t = setup();
    await dataReadyFixture(t);
    await t.run(
      async (ctx) =>
        await ctx.db.insert("forumAgentRuns", {
          runKey: "bags:old-publication",
          agentSlug: "bags-scout",
          runDate: "2026-10-01",
          slot: 1,
          attempt: 0,
          status: "published",
          model: "openrouter/free",
          sourceUrls: [],
          startedAt: NOW - 20 * 86_400_000,
          updatedAt: NOW,
        }),
    );
    expect(await queueDataRecovery(t)).toEqual({ queued: false });
  });

  test("authorizes and claims exactly once, preserves source and old marker, and never reopens the hourly slot", async () => {
    const t = setup();
    const ids = await dataReadyFixture(t);
    const readSource = async () =>
      await t.run(async (ctx) => ({
        source: await ctx.db.get("tokenAlphaRuns", ids.sourceId),
        forum: await ctx.db.get("forumAgentRuns", ids.forumRunId),
      }));
    const before = await readSource();
    const queued = await Promise.all(
      Array.from({ length: 12 }, () => queueDataRecovery(t)),
    );
    expect(queued.filter((result) => result.queued)).toEqual([
      { queued: true, runKey: DATA_RECOVERY_KEY },
    ]);
    const scheduled = await t.run(
      async (ctx) => await ctx.db.system.query("_scheduled_functions").take(3),
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toEqual([
      { platform: "bags", operatorRetryOf: DATA_SOURCE_KEY },
    ]);
    const claims = await Promise.all(
      Array.from({ length: 12 }, () => claimDataRecovery(t)),
    );
    expect(claims.filter((claim) => claim !== null)).toMatchObject([
      {
        runKey: DATA_RECOVERY_KEY,
        operatorRetryOf: DATA_SOURCE_KEY,
        status: "running",
      },
    ]);
    expect(await readSource()).toEqual(before);
    await t.mutation(internal.tokenAlphaData.finishRun, {
      runKey: DATA_RECOVERY_KEY,
      claimToken: "data-recovery-claim",
      status: "failed",
      reason: "Recovery failed; authority remains spent",
    });
    expect(await claimDataRecovery(t)).toBeNull();
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
    expect(await queueDataRecovery(t)).toEqual({ queued: false });
    expect(await claimDataRecovery(t)).toBeNull();
    const control = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
    );
    expect(control?.operatorBagsDataRecovery).toEqual({
      sourceRunKey: DATA_SOURCE_KEY,
      runKey: DATA_RECOVERY_KEY,
      authorizedAt: NOW,
      claimedAt: NOW,
    });
    expect(control?.operatorBagsRetry).toEqual(OLD_CONSUMED_RETRY);
    expect(await readSource()).toEqual(before);
  });

  test.each(
    preservedClaimGates.filter(
      ({ name }) =>
        ![
          "changed uncertain source receipt",
          "pending source operation",
          "unknown source operation",
        ].includes(name),
    ),
  )(
    "preserves the $name gate without consuming data authority",
    async ({ block }) => {
      const t = setup();
      const ids = await dataReadyFixture(t);
      expect((await queueDataRecovery(t)).queued).toBe(true);
      await block(t, ids);
      expect(await claimDataRecovery(t)).toBeNull();
      const control = await t.run(
        async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
      );
      expect(control?.operatorBagsDataRecovery?.claimedAt).toBeUndefined();
      expect(control?.operatorBagsRetry).toEqual(OLD_CONSUMED_RETRY);
    },
  );

  test("revalidates pre-model eligibility at claim time", async () => {
    const t = setup();
    const ids = await dataReadyFixture(t);
    expect((await queueDataRecovery(t)).queued).toBe(true);
    await t.run(
      async (ctx) =>
        await ctx.db.patch("tokenAlphaRuns", ids.sourceId, {
          snapshot: SNAPSHOT,
        }),
    );
    expect(await claimDataRecovery(t)).toBeNull();
    const control = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
    );
    expect(control?.operatorBagsDataRecovery?.claimedAt).toBeUndefined();
  });

  test.each(["runtime disabled", "hour changed"])(
    "revalidates %s at claim time without spending authority",
    async (gate) => {
      const t = setup();
      const ids = await dataReadyFixture(t);
      expect((await queueDataRecovery(t)).queued).toBe(true);
      if (gate === "runtime disabled") vi.stubEnv("ELIZA_RUNTIME_MODE", "off");
      else vi.setSystemTime(NOW + 3_600_000);
      expect(await claimDataRecovery(t)).toBeNull();
      const control = await t.run(
        async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
      );
      expect(control?.operatorBagsDataRecovery?.claimedAt).toBeUndefined();
    },
  );

  test("rejects forged, ambiguous, consumed, wrong-lane and mixed authority", async () => {
    const t = setup();
    const ids = await dataReadyFixture(t);
    expect(await claimDataRecovery(t)).toBeNull();
    expect((await queueDataRecovery(t)).queued).toBe(true);
    const original = {
      sourceRunKey: DATA_SOURCE_KEY,
      runKey: DATA_RECOVERY_KEY,
      authorizedAt: NOW,
    };
    for (const patch of [
      { sourceRunKey: SOURCE_RUN_KEY },
      { runKey: RETRY_RUN_KEY },
      { claimedAt: NOW },
    ]) {
      await t.run(
        async (ctx) =>
          await ctx.db.patch("tokenAlphaControl", ids.controlId, {
            operatorBagsDataRecovery: { ...original, ...patch },
          }),
      );
      expect(await claimDataRecovery(t)).toBeNull();
    }
    await t.run(
      async (ctx) =>
        await ctx.db.patch("tokenAlphaControl", ids.controlId, {
          operatorBagsDataRecovery: original,
        }),
    );
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "pumpfun",
        claimToken: "wrong-lane",
        operatorRetryOf: DATA_SOURCE_KEY,
      }),
    ).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "mixed",
        operatorRetryOf: DATA_SOURCE_KEY,
        operatorFirstPost: true,
      }),
    ).toBeNull();
    await t.run(
      async (ctx) =>
        await ctx.db.patch("tokenAlphaControl", ids.controlId, {
          operatorBagsRetry: {
            ...OLD_CONSUMED_RETRY,
            sourceRunKey: DATA_SOURCE_KEY,
          },
        }),
    );
    expect(await claimDataRecovery(t)).toBeNull();
  });

  test("requires enabled live pilot at queue and claim, and rejects an existing recovery key", async () => {
    const t = setup();
    const ids = await dataReadyFixture(t);
    vi.stubEnv("ELIZA_RUNTIME_MODE", "off");
    expect(await queueDataRecovery(t)).toEqual({ queued: false });
    vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
    await t.run(
      async (ctx) =>
        await ctx.db.patch("tokenAlphaControl", ids.controlId, {
          enabled: false,
        }),
    );
    expect(await queueDataRecovery(t)).toEqual({ queued: false });
    await t.run(async (ctx) => {
      await ctx.db.patch("tokenAlphaControl", ids.controlId, { enabled: true });
      await ctx.db.insert("tokenAlphaRuns", {
        runKey: DATA_RECOVERY_KEY,
        platform: "bags",
        claimToken: "existing",
        status: "held",
        createdAt: NOW,
        updatedAt: NOW,
        expiresAt: NOW,
      });
    });
    expect(await queueDataRecovery(t)).toEqual({ queued: false });
  });
});

const VALIDATION_NOW = NOW + 3_600_000;
const VALIDATION_SOURCE_KEY = "bags:2026-10-21T22";
const VALIDATION_JOB_ID = "eliza-fc50590f-ab9d-4f68-abe1-371d4d2de1c2";
const VALIDATION_RUN_KEY = `${VALIDATION_SOURCE_KEY}:operator-validation-verification-1`;
const VALIDATION_FAILURE = "token-pilot-model-draft-failed";
const OLD_CONSUMED_DATA_RECOVERY = {
  sourceRunKey: DATA_SOURCE_KEY,
  runKey: DATA_RECOVERY_KEY,
  authorizedAt: NOW,
  claimedAt: NOW,
};

async function validationFixture(t: ReturnType<typeof setup>) {
  const ids = await dataReadyFixture(t);
  vi.setSystemTime(VALIDATION_NOW);
  const receiptIds = await t.run(async (ctx) => {
    await ctx.db.patch("tokenAlphaRuns", ids.sourceId, {
      runKey: VALIDATION_SOURCE_KEY,
      reason: VALIDATION_FAILURE,
      snapshot: {
        ...SNAPSHOT,
        observedAt: VALIDATION_NOW,
        metricsAsOf: VALIDATION_NOW,
      },
    });
    await ctx.db.patch("forumAgentRuns", ids.forumRunId, {
      runKey: VALIDATION_SOURCE_KEY,
      slot: 22,
      errorMessage: VALIDATION_FAILURE,
      inputTokens: 100,
      outputTokens: 100,
    });
    await ctx.db.patch("tokenAlphaControl", ids.controlId, {
      operatorBagsDataRecovery: OLD_CONSUMED_DATA_RECOVERY,
    });
    const callId = await ctx.db.insert("elizaRuntimeCalls", {
      jobId: VALIDATION_JOB_ID,
      operationKey: VALIDATION_SOURCE_KEY,
      inputHash: HASH,
      agentSlug: "bags-scout",
      stage: "bags-scout:forum-draft",
      model: OPENROUTER_TOKEN_SCOUT_MODEL,
      status: "completed",
      providerStatus: 200,
      outcomeUnknown: false,
      createdAt: VALIDATION_NOW - 60_000,
      updatedAt: VALIDATION_NOW - 50_000,
      expiresAt: VALIDATION_NOW + 86_400_000,
    });
    const operationId = await ctx.db.insert("elizaRuntimeOperations", {
      operationKey: VALIDATION_SOURCE_KEY,
      status: "ready",
      jobId: VALIDATION_JOB_ID,
      inputHash: HASH,
      updatedAt: VALIDATION_NOW,
    });
    return { callId, operationId };
  });
  return { ...ids, ...receiptIds };
}

async function queueValidation(t: ReturnType<typeof setup>) {
  return await t.mutation(
    internal.tokenAlphaRecoveryData.queueBagsValidationVerification,
    {
      failedRunKey: VALIDATION_SOURCE_KEY,
      jobId: VALIDATION_JOB_ID,
    },
  );
}

async function claimValidation(t: ReturnType<typeof setup>) {
  return await t.mutation(internal.tokenAlphaData.claimRun, {
    platform: "bags",
    claimToken: "validation-verification-claim",
    operatorRetryOf: VALIDATION_SOURCE_KEY,
  });
}

describe("one approved completed-draft Bags validation verification", () => {
  const invalidValidationSources: Array<[string, SourcePatch]> = [
    ...invalidSources,
    ["old hourly source", { runKey: DATA_SOURCE_KEY }],
    ["missing snapshot", { snapshot: undefined }],
    ["operator first post", { operatorFirstPost: true }],
    ["false operator flag", { operatorFirstPost: false }],
    ["RPC data failure", { reason: DATA_FAILURE }],
    ["missing failure reason", { reason: undefined }],
  ];
  test.each(invalidValidationSources)("rejects %s", async (_name, patch) => {
    const t = setup();
    const ids = await validationFixture(t);
    await t.run(
      async (ctx) => await ctx.db.patch("tokenAlphaRuns", ids.sourceId, patch),
    );
    expect(await queueValidation(t)).toEqual({ queued: false });
    const control = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
    );
    expect(control?.operatorBagsValidationVerification).toBeUndefined();
  });

  const invalidValidationReceipts: Array<[string, CallPatch]> = [
    ["pending call", { status: "pending" }],
    ["failed call", { status: "failed" }],
    ["unknown completion", { outcomeUnknown: true }],
    ["wrong model", { model: "openrouter/free" }],
    ["wrong agent", { agentSlug: "pumpfun-scout" }],
    ["review stage", { stage: "bags-scout:forum-evidence-review" }],
    ["wrong operation", { operationKey: "bags:other" }],
    ["wrong job", { jobId: "different-job" }],
    ["invalid hash", { inputHash: "invalid" }],
    ["mismatched hash", { inputHash: "b".repeat(64) }],
  ];
  test.each(invalidValidationReceipts)(
    "rejects a %s receipt",
    async (_name, patch) => {
      const t = setup();
      const ids = await validationFixture(t);
      await t.run(
        async (ctx) =>
          await ctx.db.patch("elizaRuntimeCalls", ids.callId, patch),
      );
      expect(await queueValidation(t)).toEqual({ queued: false });
    },
  );

  test.each([
    ["missing receipt", "receipt"],
    ["missing operation", "operation"],
    ["unknown operation", "unknown"],
    ["pending operation", "pending"],
    ["wrong operation job", "job"],
    ["wrong operation hash", "hash"],
  ])("rejects %s", async (_name, variant) => {
    const t = setup();
    const ids = await validationFixture(t);
    await t.run(async (ctx) => {
      if (variant === "receipt")
        await ctx.db.delete("elizaRuntimeCalls", ids.callId);
      else if (variant === "operation")
        await ctx.db.delete("elizaRuntimeOperations", ids.operationId);
      else
        await ctx.db.patch(
          "elizaRuntimeOperations",
          ids.operationId,
          variant === "job"
            ? { jobId: "different-job" }
            : variant === "hash"
              ? { inputHash: "b".repeat(64) }
              : { status: variant as "unknown" | "pending" },
        );
    });
    expect(await queueValidation(t)).toEqual({ queued: false });
  });

  test.each(["bags-scout:forum-draft", "bags-scout:forum-evidence-review"])(
    "rejects any second source call (%s)",
    async (stage) => {
      const t = setup();
      await validationFixture(t);
      await t.run(
        async (ctx) =>
          await ctx.db.insert("elizaRuntimeCalls", {
            jobId: "second-source-call",
            operationKey: VALIDATION_SOURCE_KEY,
            inputHash: HASH,
            agentSlug: "bags-scout",
            stage,
            model: OPENROUTER_TOKEN_SCOUT_MODEL,
            status: "completed",
            outcomeUnknown: false,
            createdAt: VALIDATION_NOW,
            updatedAt: VALIDATION_NOW,
            expiresAt: VALIDATION_NOW - 1,
          }),
      );
      expect(await queueValidation(t)).toEqual({ queued: false });
    },
  );

  test("fails closed at the complete receipt-scan cap", async () => {
    const t = setup();
    await validationFixture(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 256; index += 1)
        await ctx.db.insert("elizaRuntimeCalls", {
          jobId: `unrelated-${index}`,
          operationKey: `other:${index}`,
          inputHash: HASH,
          agentSlug: "other",
          stage: "other",
          model: "openrouter/free",
          status: "completed",
          createdAt: VALIDATION_NOW,
          updatedAt: VALIDATION_NOW,
          expiresAt: VALIDATION_NOW,
        });
    });
    expect(await queueValidation(t)).toEqual({ queued: false });
  });

  test.each(["packet", "revision"])(
    "rejects existing private %s",
    async (kind) => {
      const t = setup();
      await validationFixture(t);
      await t.run(async (ctx) => {
        const packetId = await ctx.db.insert("forumAgentResearchPackets", {
          runKey:
            kind === "packet" ? VALIDATION_SOURCE_KEY : "unrelated-packet",
          agentSlug: "bags-scout",
          state: "held",
          currentStage: "publication_decision",
          sourceCount: 0,
          createdAt: VALIDATION_NOW,
          updatedAt: VALIDATION_NOW,
        });
        if (kind === "revision")
          await ctx.db.insert("forumAgentDraftRevisions", {
            packetId,
            runKey: VALIDATION_SOURCE_KEY,
            agentSlug: "bags-scout",
            revision: 0,
            state: "held",
            title: "",
            body: "",
            contentHash: HASH,
            claimHash: HASH,
            claimCount: 0,
            createdAt: VALIDATION_NOW,
            updatedAt: VALIDATION_NOW,
          });
      });
      expect(await queueValidation(t)).toEqual({ queued: false });
    },
  );

  test.each([
    ["wrong forum model", { model: "openrouter/free" }],
    ["wrong forum agent", { agentSlug: "pumpfun-scout" }],
    ["wrong forum failure", { errorMessage: DATA_FAILURE }],
    ["proposed title", { title: "" }],
    ["proposed sources", { sourceUrls: ["https://bags.fm/fixture"] }],
  ])("rejects %s", async (_name, patch) => {
    const t = setup();
    const ids = await validationFixture(t);
    await t.run(
      async (ctx) =>
        await ctx.db.patch("forumAgentRuns", ids.forumRunId, patch),
    );
    expect(await queueValidation(t)).toEqual({ queued: false });
  });

  test("accepts completed receipts without an uncertainty flag and never reuses source output", async () => {
    const t = setup();
    const ids = await validationFixture(t);
    await t.run(
      async (ctx) =>
        await ctx.db.patch("elizaRuntimeCalls", ids.callId, {
          outcomeUnknown: undefined,
        }),
    );
    expect(await queueValidation(t)).toEqual({
      queued: true,
      runKey: VALIDATION_RUN_KEY,
    });
    expect(await claimValidation(t)).toMatchObject({
      runKey: VALIDATION_RUN_KEY,
      status: "running",
    });
    const freshRun = await t.query(internal.tokenAlphaData.getRun, {
      runKey: VALIDATION_RUN_KEY,
    });
    expect(freshRun?.snapshot).toBeUndefined();
    expect(freshRun?.analysis).toBeUndefined();
    expect(freshRun?.body).toBeUndefined();
  });

  test("queues and claims once concurrently, preserves source and both old markers, and permanently consumes verification", async () => {
    const t = setup();
    const ids = await validationFixture(t);
    const readSource = async () =>
      await t.run(async (ctx) => ({
        run: await ctx.db.get("tokenAlphaRuns", ids.sourceId),
        forum: await ctx.db.get("forumAgentRuns", ids.forumRunId),
        call: await ctx.db.get("elizaRuntimeCalls", ids.callId),
        operation: await ctx.db.get("elizaRuntimeOperations", ids.operationId),
      }));
    const before = await readSource();
    const queued = await Promise.all(
      Array.from({ length: 12 }, () => queueValidation(t)),
    );
    expect(queued.filter((result) => result.queued)).toEqual([
      { queued: true, runKey: VALIDATION_RUN_KEY },
    ]);
    const scheduled = await t.run(
      async (ctx) => await ctx.db.system.query("_scheduled_functions").take(3),
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toEqual([
      { platform: "bags", operatorRetryOf: VALIDATION_SOURCE_KEY },
    ]);
    const claims = await Promise.all(
      Array.from({ length: 12 }, () => claimValidation(t)),
    );
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    expect(await readSource()).toEqual(before);
    await t.mutation(internal.tokenAlphaData.finishRun, {
      runKey: VALIDATION_RUN_KEY,
      claimToken: "validation-verification-claim",
      status: "failed",
      reason: "No automatic replay",
    });
    expect(await claimValidation(t)).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "ordinary-same-hour",
      }),
    ).toBeNull();
    await t.mutation(internal.tokenAlphaData.ensureInfrastructure, {});
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: false });
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true });
    vi.setSystemTime(VALIDATION_NOW + 3_600_000);
    expect(await queueValidation(t)).toEqual({ queued: false });
    expect(await claimValidation(t)).toBeNull();
    const control = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
    );
    expect(control?.operatorBagsValidationVerification).toEqual({
      sourceRunKey: VALIDATION_SOURCE_KEY,
      sourceJobId: VALIDATION_JOB_ID,
      runKey: VALIDATION_RUN_KEY,
      authorizedAt: VALIDATION_NOW,
      claimedAt: VALIDATION_NOW,
    });
    expect(control?.operatorBagsRetry).toEqual(OLD_CONSUMED_RETRY);
    expect(control?.operatorBagsDataRecovery).toEqual(
      OLD_CONSUMED_DATA_RECOVERY,
    );
    expect(await readSource()).toEqual(before);
  });

  test.each(preservedClaimGates)(
    "preserves $name at claim time",
    async ({ block }) => {
      const t = setup();
      const ids = await validationFixture(t);
      expect((await queueValidation(t)).queued).toBe(true);
      await block(t, ids);
      expect(await claimValidation(t)).toBeNull();
      const control = await t.run(
        async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
      );
      expect(
        control?.operatorBagsValidationVerification?.claimedAt,
      ).toBeUndefined();
    },
  );

  test.each(["operatorBagsRetry", "operatorBagsDataRecovery"] as const)(
    "rejects ambiguity with %s even when consumed",
    async (field) => {
      const t = setup();
      const ids = await validationFixture(t);
      expect((await queueValidation(t)).queued).toBe(true);
      await t.run(
        async (ctx) =>
          await ctx.db.patch("tokenAlphaControl", ids.controlId, {
            [field]:
              field === "operatorBagsRetry"
                ? { ...OLD_CONSUMED_RETRY, sourceRunKey: VALIDATION_SOURCE_KEY }
                : {
                    ...OLD_CONSUMED_DATA_RECOVERY,
                    sourceRunKey: VALIDATION_SOURCE_KEY,
                  },
          }),
      );
      expect(await claimValidation(t)).toBeNull();
    },
  );

  test("rejects missing, forged, wrong-lane and first-post authority", async () => {
    const t = setup();
    const ids = await validationFixture(t);
    expect(await claimValidation(t)).toBeNull();
    expect((await queueValidation(t)).queued).toBe(true);
    const marker = {
      sourceRunKey: VALIDATION_SOURCE_KEY,
      sourceJobId: VALIDATION_JOB_ID,
      runKey: VALIDATION_RUN_KEY,
      authorizedAt: VALIDATION_NOW,
    };
    for (const patch of [
      { runKey: DATA_RECOVERY_KEY },
      { sourceJobId: "wrong-job" },
      { sourceRunKey: DATA_SOURCE_KEY },
      { claimedAt: VALIDATION_NOW },
    ]) {
      await t.run(
        async (ctx) =>
          await ctx.db.patch("tokenAlphaControl", ids.controlId, {
            operatorBagsValidationVerification: { ...marker, ...patch },
          }),
      );
      expect(await claimValidation(t)).toBeNull();
    }
    await t.run(
      async (ctx) =>
        await ctx.db.patch("tokenAlphaControl", ids.controlId, {
          operatorBagsValidationVerification: marker,
        }),
    );
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "pumpfun",
        claimToken: "wrong-lane",
        operatorRetryOf: VALIDATION_SOURCE_KEY,
      }),
    ).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "first-post-combo",
        operatorRetryOf: VALIDATION_SOURCE_KEY,
        operatorFirstPost: true,
      }),
    ).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "false-first-post-combo",
        operatorRetryOf: VALIDATION_SOURCE_KEY,
        operatorFirstPost: false,
      }),
    ).toBeNull();
  });

  test("rejects any all-time Bags publication before authorizing verification", async () => {
    const t = setup();
    await validationFixture(t);
    await t.run(
      async (ctx) =>
        await ctx.db.insert("forumAgentRuns", {
          runKey: "bags:older-published",
          agentSlug: "bags-scout",
          runDate: "2026-10-01",
          slot: 1,
          attempt: 0,
          status: "published",
          model: "openrouter/free",
          sourceUrls: [],
          startedAt: VALIDATION_NOW - 20 * 86_400_000,
          updatedAt: VALIDATION_NOW,
        }),
    );
    expect(await queueValidation(t)).toEqual({ queued: false });
  });

  test.each(["off", "hour changed"])(
    "holds an authorized verification when runtime is %s",
    async (gate) => {
      const t = setup();
      const ids = await validationFixture(t);
      expect((await queueValidation(t)).queued).toBe(true);
      if (gate === "off") vi.stubEnv("ELIZA_RUNTIME_MODE", "off");
      else vi.setSystemTime(VALIDATION_NOW + 3_600_000);
      expect(await claimValidation(t)).toBeNull();
      const control = await t.run(
        async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
      );
      expect(
        control?.operatorBagsValidationVerification?.claimedAt,
      ).toBeUndefined();
    },
  );
});

const GRAMMAR_NOW = VALIDATION_NOW + 3_600_000;
const GRAMMAR_SOURCE_KEY = "bags:2026-10-21T23";
const GRAMMAR_JOB_ID = "eliza-04798be0-d6fd-466c-a778-cba2e3f35e2f";
const GRAMMAR_HASH =
  "a6ec4441fba550b9c1149c0af04a17d4272c416e3cc8d539b07f1db8ba3f7404";
const GRAMMAR_RUN_KEY = `${GRAMMAR_SOURCE_KEY}:operator-grammar-verification-1`;
const GRAMMAR_FAILURE = "token-pilot-model-draft-failed:analysis-policy-phrase";
const OLD_CONSUMED_VALIDATION = {
  sourceRunKey: VALIDATION_SOURCE_KEY,
  sourceJobId: VALIDATION_JOB_ID,
  runKey: VALIDATION_RUN_KEY,
  authorizedAt: VALIDATION_NOW,
  claimedAt: VALIDATION_NOW,
};

async function grammarFixture(t: ReturnType<typeof setup>) {
  const ids = await validationFixture(t);
  vi.setSystemTime(GRAMMAR_NOW);
  await t.run(async (ctx) => {
    await ctx.db.patch("tokenAlphaRuns", ids.sourceId, {
      runKey: GRAMMAR_SOURCE_KEY,
      reason: GRAMMAR_FAILURE,
      snapshot: {
        ...SNAPSHOT,
        observedAt: GRAMMAR_NOW,
        metricsAsOf: GRAMMAR_NOW,
      },
    });
    await ctx.db.patch("forumAgentRuns", ids.forumRunId, {
      runKey: GRAMMAR_SOURCE_KEY,
      slot: 23,
      errorMessage: GRAMMAR_FAILURE,
    });
    await ctx.db.patch("elizaRuntimeCalls", ids.callId, {
      jobId: GRAMMAR_JOB_ID,
      operationKey: GRAMMAR_SOURCE_KEY,
      inputHash: GRAMMAR_HASH,
    });
    await ctx.db.patch("elizaRuntimeOperations", ids.operationId, {
      operationKey: GRAMMAR_SOURCE_KEY,
      jobId: GRAMMAR_JOB_ID,
      inputHash: GRAMMAR_HASH,
    });
    await ctx.db.patch("aiOperationalStates", ids.canaryId, {
      checkedAt: GRAMMAR_NOW,
    });
    await ctx.db.patch("tokenAlphaControl", ids.controlId, {
      operatorBagsValidationVerification: OLD_CONSUMED_VALIDATION,
    });
  });
  return ids;
}

async function queueGrammar(t: ReturnType<typeof setup>) {
  return await t.mutation(
    internal.tokenAlphaRecoveryData.queueBagsGrammarVerification,
    {
      failedRunKey: GRAMMAR_SOURCE_KEY,
      jobId: GRAMMAR_JOB_ID,
    },
  );
}

async function claimGrammar(t: ReturnType<typeof setup>) {
  return await t.mutation(internal.tokenAlphaData.claimRun, {
    platform: "bags",
    claimToken: "grammar-verification-claim",
    operatorRetryOf: GRAMMAR_SOURCE_KEY,
  });
}

describe("one separately approved Bags grammar verification", () => {
  const invalidGrammarSources: Array<[string, SourcePatch]> = [
    ...invalidSources,
    ["missing snapshot", { snapshot: undefined }],
    ["true first-post flag", { operatorFirstPost: true }],
    ["false first-post flag", { operatorFirstPost: false }],
    ["previous hour", { runKey: VALIDATION_SOURCE_KEY }],
    ["old generic failure", { reason: VALIDATION_FAILURE }],
    [
      "another grammar reason",
      { reason: "token-pilot-model-draft-failed:analysis-policy-target" },
    ],
  ];
  test.each(invalidGrammarSources)("rejects %s", async (_name, patch) => {
    const t = setup();
    const ids = await grammarFixture(t);
    await t.run(
      async (ctx) => await ctx.db.patch("tokenAlphaRuns", ids.sourceId, patch),
    );
    expect(await queueGrammar(t)).toEqual({ queued: false });
  });

  test("keeps old and new completed-draft wrappers bound to different exact reasons", async () => {
    const t = setup();
    const ids = await grammarFixture(t);
    expect(
      await t.run(
        async (ctx) =>
          await validateBagsValidationVerification(
            ctx,
            GRAMMAR_SOURCE_KEY,
            GRAMMAR_JOB_ID,
            GRAMMAR_NOW,
          ),
      ),
    ).toBe(false);
    expect(
      await t.run(
        async (ctx) =>
          await validateBagsGrammarVerification(
            ctx,
            GRAMMAR_SOURCE_KEY,
            GRAMMAR_JOB_ID,
            GRAMMAR_NOW,
          ),
      ),
    ).toBe(true);
    await t.run(async (ctx) => {
      await ctx.db.patch("tokenAlphaRuns", ids.sourceId, {
        reason: VALIDATION_FAILURE,
      });
      await ctx.db.patch("forumAgentRuns", ids.forumRunId, {
        errorMessage: VALIDATION_FAILURE,
      });
    });
    expect(
      await t.run(
        async (ctx) =>
          await validateBagsValidationVerification(
            ctx,
            GRAMMAR_SOURCE_KEY,
            GRAMMAR_JOB_ID,
            GRAMMAR_NOW,
          ),
      ),
    ).toBe(true);
    expect(
      await t.run(
        async (ctx) =>
          await validateBagsGrammarVerification(
            ctx,
            GRAMMAR_SOURCE_KEY,
            GRAMMAR_JOB_ID,
            GRAMMAR_NOW,
          ),
      ),
    ).toBe(false);
  });

  test.each(preservedClaimGates)(
    "retains $name without spending grammar authority",
    async ({ block }) => {
      const t = setup();
      const ids = await grammarFixture(t);
      expect((await queueGrammar(t)).queued).toBe(true);
      await block(t, ids);
      expect(await claimGrammar(t)).toBeNull();
      const control = await t.run(
        async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
      );
      expect(
        control?.operatorBagsGrammarVerification?.claimedAt,
      ).toBeUndefined();
    },
  );

  test("requires a single completed draft receipt and no review receipt", async () => {
    const t = setup();
    const ids = await grammarFixture(t);
    for (const patch of [
      { status: "failed" as const },
      { stage: "bags-scout:forum-evidence-review" },
      { inputHash: HASH },
      { model: "openrouter/free" },
    ]) {
      const original = await t.run(
        async (ctx) => await ctx.db.get("elizaRuntimeCalls", ids.callId),
      );
      await t.run(
        async (ctx) =>
          await ctx.db.patch("elizaRuntimeCalls", ids.callId, patch),
      );
      expect(await queueGrammar(t)).toEqual({ queued: false });
      await t.run(
        async (ctx) =>
          await ctx.db.patch("elizaRuntimeCalls", ids.callId, {
            status: original!.status,
            stage: original!.stage,
            inputHash: original!.inputHash,
            model: original!.model,
          }),
      );
    }
    await t.run(
      async (ctx) =>
        await ctx.db.insert("elizaRuntimeCalls", {
          jobId: "unexpected-grammar-review",
          operationKey: GRAMMAR_SOURCE_KEY,
          inputHash: GRAMMAR_HASH,
          agentSlug: "bags-scout",
          stage: "bags-scout:forum-evidence-review",
          model: OPENROUTER_TOKEN_SCOUT_MODEL,
          status: "completed",
          createdAt: GRAMMAR_NOW,
          updatedAt: GRAMMAR_NOW,
          expiresAt: GRAMMAR_NOW,
        }),
    );
    expect(await queueGrammar(t)).toEqual({ queued: false });
  });

  test("queues and claims once concurrently, fetches fresh state, and preserves every old marker and source record", async () => {
    const t = setup();
    const ids = await grammarFixture(t);
    const readSource = async () =>
      await t.run(async (ctx) => ({
        source: await ctx.db.get("tokenAlphaRuns", ids.sourceId),
        forum: await ctx.db.get("forumAgentRuns", ids.forumRunId),
        call: await ctx.db.get("elizaRuntimeCalls", ids.callId),
        operation: await ctx.db.get("elizaRuntimeOperations", ids.operationId),
      }));
    const before = await readSource();
    const queued = await Promise.all(
      Array.from({ length: 12 }, () => queueGrammar(t)),
    );
    expect(queued.filter((result) => result.queued)).toEqual([
      { queued: true, runKey: GRAMMAR_RUN_KEY },
    ]);
    const scheduled = await t.run(
      async (ctx) => await ctx.db.system.query("_scheduled_functions").take(3),
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args).toEqual([
      { platform: "bags", operatorRetryOf: GRAMMAR_SOURCE_KEY },
    ]);
    const claims = await Promise.all(
      Array.from({ length: 12 }, () => claimGrammar(t)),
    );
    const accepted = claims.filter((claim) => claim !== null);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      runKey: GRAMMAR_RUN_KEY,
      status: "running",
    });
    expect(accepted[0]?.snapshot).toBeUndefined();
    expect(accepted[0]?.analysis).toBeUndefined();
    expect(accepted[0]?.body).toBeUndefined();
    await t.mutation(internal.tokenAlphaData.finishRun, {
      runKey: GRAMMAR_RUN_KEY,
      claimToken: "grammar-verification-claim",
      status: "held",
      reason: "Review held, never retry",
    });
    expect(await claimGrammar(t)).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "ordinary-same-hour",
      }),
    ).toBeNull();
    await t.mutation(internal.tokenAlphaData.ensureInfrastructure, {});
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: false });
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true });
    vi.setSystemTime(GRAMMAR_NOW + 3_600_000);
    expect(await queueGrammar(t)).toEqual({ queued: false });
    expect(await claimGrammar(t)).toBeNull();
    const control = await t.run(
      async (ctx) => await ctx.db.get("tokenAlphaControl", ids.controlId),
    );
    expect(control?.operatorBagsRetry).toEqual(OLD_CONSUMED_RETRY);
    expect(control?.operatorBagsDataRecovery).toEqual(
      OLD_CONSUMED_DATA_RECOVERY,
    );
    expect(control?.operatorBagsValidationVerification).toEqual(
      OLD_CONSUMED_VALIDATION,
    );
    expect(control?.operatorBagsGrammarVerification).toEqual({
      sourceRunKey: GRAMMAR_SOURCE_KEY,
      sourceJobId: GRAMMAR_JOB_ID,
      runKey: GRAMMAR_RUN_KEY,
      authorizedAt: GRAMMAR_NOW,
      claimedAt: GRAMMAR_NOW,
    });
    expect(await readSource()).toEqual(before);
  });

  test.each([
    "operatorBagsRetry",
    "operatorBagsDataRecovery",
    "operatorBagsValidationVerification",
  ] as const)("rejects ambiguous authority with consumed %s", async (field) => {
    const t = setup();
    const ids = await grammarFixture(t);
    expect((await queueGrammar(t)).queued).toBe(true);
    await t.run(async (ctx) => {
      const control = await ctx.db.get("tokenAlphaControl", ids.controlId);
      await ctx.db.patch("tokenAlphaControl", ids.controlId, {
        [field]: { ...control![field]!, sourceRunKey: GRAMMAR_SOURCE_KEY },
      });
    });
    expect(await claimGrammar(t)).toBeNull();
  });

  test("rejects forged marker, wrong lane and any first-post flag", async () => {
    const t = setup();
    const ids = await grammarFixture(t);
    expect(await claimGrammar(t)).toBeNull();
    expect((await queueGrammar(t)).queued).toBe(true);
    const marker = {
      sourceRunKey: GRAMMAR_SOURCE_KEY,
      sourceJobId: GRAMMAR_JOB_ID,
      runKey: GRAMMAR_RUN_KEY,
      authorizedAt: GRAMMAR_NOW,
    };
    for (const patch of [
      { runKey: VALIDATION_RUN_KEY },
      { sourceJobId: "wrong-job" },
      { claimedAt: GRAMMAR_NOW },
    ]) {
      await t.run(
        async (ctx) =>
          await ctx.db.patch("tokenAlphaControl", ids.controlId, {
            operatorBagsGrammarVerification: { ...marker, ...patch },
          }),
      );
      expect(await claimGrammar(t)).toBeNull();
    }
    await t.run(
      async (ctx) =>
        await ctx.db.patch("tokenAlphaControl", ids.controlId, {
          operatorBagsGrammarVerification: marker,
        }),
    );
    for (const operatorFirstPost of [true, false])
      expect(
        await t.mutation(internal.tokenAlphaData.claimRun, {
          platform: "bags",
          claimToken: "mixed-authority",
          operatorRetryOf: GRAMMAR_SOURCE_KEY,
          operatorFirstPost,
        }),
      ).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "pumpfun",
        claimToken: "wrong-lane",
        operatorRetryOf: GRAMMAR_SOURCE_KEY,
      }),
    ).toBeNull();
  });
});
