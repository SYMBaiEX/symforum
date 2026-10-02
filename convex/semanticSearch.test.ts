import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { estimatedModelCostMicroUsd } from "../lib/ai-model-costs";
import { OPENROUTER_EMBEDDING_MODEL } from "../lib/ai-models";
import {
  isKnownOpenRouterSpendBucket,
  recordSpendBucket,
} from "./aiRoutingControlData";
import schema from "./schema";
import { internal } from "./_generated/api";
import {
  dayKey,
  isCircuitAvailable,
  isCurrentFingerprint,
  semanticSearchConfig,
  settlementDelta,
  settlementLocation,
} from "./semanticSearch";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const setup = () => convexTest(schema, modules);
const cleanupOperationsRef = makeFunctionReference<
  "mutation",
  { now?: number },
  { failed: number; deleted: number; hasMore: boolean }
>("semanticSearch:cleanupExpiredOperations");
const reserveUsageRef = makeFunctionReference<
  "mutation",
  {
    operationKey: string;
    kind: "index" | "query";
    fingerprint: string;
    holder: string;
    estimatedMicroUsd: number;
    inputTokens: number;
    model: string;
    dailyBudgetMicroUsd: number;
    globalDailyBudgetMicroUsd: number;
  },
  { accepted: boolean; replay: boolean }
>("semanticSearch:reserveUsage");
const recordUsageRef = makeFunctionReference<
  "mutation",
  {
    operationKey: string;
    inputTokens: number;
    settledMicroUsd: number;
    model: string;
    outcome: "completed" | "failed";
    detail: string;
    indexMarker?: { key: string; detail: string };
  },
  null
>("semanticSearch:recordUsage");
const migrateLegacyIndexMarkerRef = makeFunctionReference<
  "mutation",
  {
    markerId: Id<"aiOperationalStates">;
    documentId: Id<"evidenceDocuments">;
    documentUpdatedAt: number;
    model: string;
  },
  null
>("semanticSearch:migrateLegacyIndexMarker");

function reservationArgs(
  operationKey: string,
  overrides: Partial<{
    kind: "index" | "query";
    estimatedMicroUsd: number;
    inputTokens: number;
    dailyBudgetMicroUsd: number;
    globalDailyBudgetMicroUsd: number;
  }> = {},
) {
  return {
    operationKey,
    kind: "query" as const,
    fingerprint: operationKey,
    holder: `${operationKey}:holder`,
    estimatedMicroUsd: 10,
    inputTokens: 10,
    model: OPENROUTER_EMBEDDING_MODEL,
    dailyBudgetMicroUsd: 1_000,
    globalDailyBudgetMicroUsd: 1_000,
    ...overrides,
  };
}

describe("semantic search safety controls", () => {
  test("is disabled unless the explicit feature switch is true", () => {
    expect(semanticSearchConfig({}).enabled).toBe(false);
    expect(semanticSearchConfig({ enabled: "false" }).reason).toMatch(
      /not true/i,
    );
  });

  test("uses the bounded approved OpenRouter embedding profile", () => {
    const value = semanticSearchConfig({ enabled: "true" });
    expect(value).toMatchObject({
      enabled: true,
      model: OPENROUTER_EMBEDDING_MODEL,
      dailyBudgetMicroUsd: 50_000,
    });
  });

  test("fails closed for an unpriced model or invalid budget", () => {
    expect(
      semanticSearchConfig({
        enabled: "true",
        embeddingModel: "vendor/unpriced",
      }).enabled,
    ).toBe(false);
    expect(
      semanticSearchConfig({ enabled: "true", dailyBudgetUsd: "99" }).enabled,
    ).toBe(false);
  });

  test("reconciles a conservative reservation to actual provider usage", () => {
    expect(settlementDelta(100, 60)).toBe(-40);
    expect(settlementDelta(100, 100)).toBe(0);
    expect(settlementDelta(100, 140)).toBe(40);
  });

  test("settlement can release a known unused reservation", () => {
    // When actual provider usage is known to be zero, the reservation can be
    // released; ambiguous provider failures retain their estimate separately.
    expect(settlementDelta(125, 0)).toBe(-125);
  });

  test("binds a vector to its document revision while tolerating source metadata changes", () => {
    expect(isCurrentFingerprint("10:20", 10)).toBe(true);
    expect(isCurrentFingerprint("10:21", 10)).toBe(true);
    expect(isCurrentFingerprint("10", 10)).toBe(true);
    expect(isCurrentFingerprint("10:20", 11)).toBe(false);
  });

  test("shares the routed-model Central spend-day boundary", () => {
    expect(dayKey(Date.UTC(2026, 9, 2, 0, 0))).toBe("2026-10-01");
    expect(dayKey(Date.UTC(2026, 9, 2, 6, 0))).toBe("2026-10-02");
    expect(
      settlementLocation({
        reservationDayKey: "2026-10-01",
        reservationBucket: 15,
      }),
    ).toEqual({ dayKey: "2026-10-01", bucket: 15 });
  });

  test("does not call the provider while the semantic circuit is paused", () => {
    expect(isCircuitAvailable(1_001, 1_000)).toBe(false);
    expect(isCircuitAvailable(1_000, 1_000)).toBe(true);
  });

  test("combines index circuit and public-document preflight in one query", async () => {
    const t = setup();
    const { documentId, sourceId } = await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("evidenceSources", {
        sourceKey: "preflight-test",
        name: "Preflight test",
        sourceType: "manual",
        ingestionEnabled: true,
        baseUrl: "https://example.com/",
        homepageUrl: "https://example.com/",
        status: "active",
        licenseClass: "open",
        provenanceClass: "primary",
        visibility: "public",
        termsUrl: "https://example.com/terms",
        etag: "",
        lastModified: "",
        cursor: "",
        lastFetchedAt: 1,
        lastSucceededAt: 1,
        lastErrorAt: 0,
        lastErrorMessage: "",
        createdAt: 1,
        updatedAt: 1,
      });
      const documentId = await ctx.db.insert("evidenceDocuments", {
        sourceId,
        externalKey: "preflight-test:document",
        canonicalUrl: "https://example.com/research",
        canonicalUrlHash: "preflight-test-hash",
        kind: "document",
        visibility: "public",
        title: "Preflight research",
        excerpt: "A public research excerpt.",
        searchText: "A public research document.",
        tags: [],
        authors: [],
        licenseClass: "open",
        currentVersionId: null,
        publishedAt: null,
        firstSeenAt: 1,
        updatedAt: 1,
      });
      return { documentId, sourceId };
    });

    const available = await t.query(
      internal.semanticSearch.readIndexPreflight,
      {
        documentId,
        embeddingModel: OPENROUTER_EMBEDDING_MODEL,
        now: 100,
      },
    );
    expect(available).toMatchObject({
      available: true,
      document: { documentId },
    });

    const oldMarkerId = await t.run(async (ctx) => {
      const markerId = await ctx.db.insert("aiOperationalStates", {
        key: `semantic-index:${documentId}:1:1:${OPENROUTER_EMBEDDING_MODEL}`,
        healthy: true,
        provider: "openrouter",
        model: OPENROUTER_EMBEDDING_MODEL,
        detail: "Indexed before source metadata changed.",
        checkedAt: 1,
        pauseUntil: 0,
        updatedAt: 1,
      });
      await ctx.db.patch("evidenceSources", sourceId, { updatedAt: 2 });
      return markerId;
    });
    const normalIndexPath = await t.query(
      internal.semanticSearch.readIndexPreflight,
      {
        documentId,
        embeddingModel: OPENROUTER_EMBEDDING_MODEL,
        now: 100,
      },
    );
    expect(normalIndexPath.document).toMatchObject({ alreadyIndexed: false });
    const reusedLegacyMarker = await t.query(
      internal.semanticSearch.readIndexPreflight,
      {
        documentId,
        embeddingModel: OPENROUTER_EMBEDDING_MODEL,
        now: 100,
        allowPriorSourceRevision: true,
      },
    );
    expect(reusedLegacyMarker.document).toMatchObject({
      alreadyIndexed: true,
      legacyMarkerId: oldMarkerId,
    });
    await t.mutation(migrateLegacyIndexMarkerRef, {
      markerId: oldMarkerId,
      documentId,
      documentUpdatedAt: 1,
      model: OPENROUTER_EMBEDDING_MODEL,
    });
    await t.run((ctx) =>
      ctx.db.patch("evidenceSources", sourceId, { updatedAt: 3 }),
    );
    const stableMarker = await t.query(
      internal.semanticSearch.readIndexPreflight,
      {
        documentId,
        embeddingModel: OPENROUTER_EMBEDDING_MODEL,
        now: 100,
        allowPriorSourceRevision: true,
      },
    );
    expect(stableMarker.document).toMatchObject({ alreadyIndexed: true });
    expect(stableMarker.document).not.toHaveProperty("legacyMarkerId");
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("aiOperationalStates")
          .withIndex("by_key", (q) =>
            q.eq(
              "key",
              `semantic-index-content:${documentId}:1:${OPENROUTER_EMBEDDING_MODEL}`,
            ),
          )
          .unique(),
      ).toMatchObject({ healthy: true, model: OPENROUTER_EMBEDDING_MODEL });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("aiOperationalStates", {
        key: `semantic-search-public-evidence:${OPENROUTER_EMBEDDING_MODEL}`,
        healthy: false,
        provider: "openrouter",
        model: OPENROUTER_EMBEDDING_MODEL,
        detail: "paused for test",
        checkedAt: 100,
        pauseUntil: 200,
        updatedAt: 100,
      });
    });
    const paused = await t.query(internal.semanticSearch.readIndexPreflight, {
      documentId,
      embeddingModel: OPENROUTER_EMBEDDING_MODEL,
      now: 100,
    });
    expect(paused).toMatchObject({
      available: false,
      reason: "Semantic OpenRouter circuit is paused.",
      document: null,
    });
  });

  test("source catch-up pages only active public documents in bounded batches", async () => {
    const t = setup();
    const sourceId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("evidenceSources", {
        sourceKey: "source-backfill-test",
        name: "Source backfill test",
        sourceType: "manual",
        ingestionEnabled: true,
        baseUrl: "https://example.com/",
        homepageUrl: "https://example.com/",
        status: "active",
        licenseClass: "open",
        provenanceClass: "primary",
        visibility: "public",
        termsUrl: "https://example.com/terms",
        etag: "",
        lastModified: "",
        cursor: "",
        lastFetchedAt: 1,
        lastSucceededAt: 1,
        lastErrorAt: 0,
        lastErrorMessage: "",
        createdAt: 1,
        updatedAt: 1,
      });
      for (let index = 0; index < 6; index += 1) {
        await ctx.db.insert("evidenceDocuments", {
          sourceId: id,
          externalKey: `source-backfill-test:${index}`,
          canonicalUrl: `https://example.com/${index}`,
          canonicalUrlHash: `source-backfill-hash-${index}`,
          kind: "document",
          visibility: "public",
          title: `Source document ${index}`,
          excerpt: "A public research excerpt.",
          searchText: "A public research document.",
          tags: [],
          authors: [],
          licenseClass: "open",
          currentVersionId: null,
          publishedAt: null,
          firstSeenAt: index,
          updatedAt: index,
        });
      }
      return id;
    });

    const firstPage = await t.query(
      internal.semanticSearch.readPublicSourceBackfillPage,
      { sourceId },
    );
    expect(firstPage.documentIds).toHaveLength(5);
    expect(firstPage.done).toBe(false);
    const secondPage = await t.query(
      internal.semanticSearch.readPublicSourceBackfillPage,
      { sourceId, cursor: firstPage.continueCursor },
    );
    expect(secondPage.documentIds).toHaveLength(1);
    expect(secondPage.done).toBe(true);

    await t.run((ctx) =>
      ctx.db.patch("evidenceSources", sourceId, {
        status: "paused",
      }),
    );
    const paused = await t.query(
      internal.semanticSearch.readPublicSourceBackfillPage,
      { sourceId },
    );
    expect(paused).toMatchObject({ documentIds: [], done: true });
  });

  test("uses only the registered OpenRouter spend buckets", () => {
    expect(isKnownOpenRouterSpendBucket(0)).toBe(true);
    expect(isKnownOpenRouterSpendBucket(7)).toBe(true);
    expect(isKnownOpenRouterSpendBucket(15)).toBe(true);
    expect(isKnownOpenRouterSpendBucket(8)).toBe(false);
    expect(isKnownOpenRouterSpendBucket(99)).toBe(false);
  });

  test("rejects future OpenRouter writes to an unregistered bucket", async () => {
    const t = setup();
    await expect(
      t.run((ctx) =>
        recordSpendBucket(ctx, {
          dayKey: dayKey(),
          provider: "openrouter",
          bucket: 99,
          spentMicroUsd: 1,
          inputTokens: 1,
          outputTokens: 0,
        }),
      ),
    ).rejects.toMatchObject({
      data: { code: "INVALID_OPENROUTER_SPEND_BUCKET" },
    });
  });

  test("fails closed on a legacy unknown OpenRouter bucket below the cap", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey: dayKey(),
        provider: "openrouter",
        bucket: 99,
        spentMicroUsd: 1,
        requests: 1,
        inputTokens: 1,
        outputTokens: 0,
        updatedAt: 1,
      });
    });

    await expect(
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:unknown-under-cap"),
      ),
    ).resolves.toEqual({ accepted: false, replay: false });
  });

  test("fails closed on a legacy unknown OpenRouter bucket above the cap", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey: dayKey(),
        provider: "openrouter",
        bucket: 99,
        spentMicroUsd: 1_000,
        requests: 1,
        inputTokens: 1,
        outputTokens: 0,
        updatedAt: 1,
      });
    });

    await expect(
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:unknown-over-cap"),
      ),
    ).resolves.toEqual({ accepted: false, replay: false });
  });

  test("rejects a semantic reservation when total OpenRouter spend leaves less than its cost", async () => {
    const t = setup();
    const today = dayKey();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey: today,
        provider: "openrouter",
        bucket: 3,
        spentMicroUsd: 999,
        requests: 1,
        inputTokens: 1,
        outputTokens: 0,
        updatedAt: 1,
      });
    });

    await expect(
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:global-cap-rejected", {
          estimatedMicroUsd: 2,
          globalDailyBudgetMicroUsd: 1_000,
        }),
      ),
    ).resolves.toEqual({ accepted: false, replay: false });
  });

  test("accepts a semantic reservation that exactly reaches the global remaining budget", async () => {
    const t = setup();
    const today = dayKey();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey: today,
        provider: "openrouter",
        bucket: 4,
        spentMicroUsd: 990,
        requests: 1,
        inputTokens: 1,
        outputTokens: 0,
        updatedAt: 1,
      });
    });

    await expect(
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:global-cap-exact"),
      ),
    ).resolves.toEqual({ accepted: true, replay: false });
    await t.run(async (ctx) => {
      const semanticSpend = await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q.eq("dayKey", today).eq("provider", "openrouter").eq("bucket", 15),
        )
        .unique();
      expect(semanticSpend?.spentMicroUsd).toBe(10);
    });
  });

  test("accepts a very short paid query with a conservatively rounded reservation", async () => {
    const t = setup();
    const query = "x";
    const estimatedTokens = Math.max(1, query.length * 2);
    const estimatedMicroUsd = estimatedModelCostMicroUsd(
      OPENROUTER_EMBEDDING_MODEL,
      estimatedTokens,
      0,
    );

    expect(estimatedMicroUsd).toBe(1);
    await expect(
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:short-paid-query", {
          estimatedMicroUsd,
          inputTokens: estimatedTokens,
        }),
      ),
    ).resolves.toEqual({ accepted: true, replay: false });
  });

  test("honors the lower semantic cap even when global OpenRouter budget has room", async () => {
    const t = setup();
    const today = dayKey();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey: today,
        provider: "openrouter",
        bucket: 15,
        spentMicroUsd: 45,
        requests: 1,
        inputTokens: 45,
        outputTokens: 0,
        updatedAt: 1,
      });
    });

    await expect(
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:semantic-cap-rejected", {
          estimatedMicroUsd: 6,
          dailyBudgetMicroUsd: 50,
          globalDailyBudgetMicroUsd: 1_000,
        }),
      ),
    ).resolves.toEqual({ accepted: false, replay: false });
  });

  test("concurrent semantic reservations cannot exceed the effective global cap", async () => {
    const t = setup();
    const reservations = await Promise.all([
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:concurrent-a", {
          estimatedMicroUsd: 60,
          globalDailyBudgetMicroUsd: 100,
        }),
      ),
      t.mutation(
        reserveUsageRef,
        reservationArgs("semantic:query:concurrent-b", {
          estimatedMicroUsd: 60,
          globalDailyBudgetMicroUsd: 100,
        }),
      ),
    ]);
    expect(
      reservations.filter((reservation) => reservation.accepted),
    ).toHaveLength(1);
  });

  test("index settlement writes the completion marker atomically without marking failures", async () => {
    const t = setup();
    const completedOperation = "semantic:index:settlement";
    const failedOperation = "semantic:index:failed";
    const completedMarkerKey = `semantic-index:test-document:1:1:${OPENROUTER_EMBEDDING_MODEL}`;
    const failedMarkerKey = `semantic-index:failed-document:1:1:${OPENROUTER_EMBEDDING_MODEL}`;
    await t.mutation(
      reserveUsageRef,
      reservationArgs(completedOperation, { kind: "index" }),
    );
    await t.mutation(
      reserveUsageRef,
      reservationArgs(failedOperation, { kind: "index" }),
    );

    await t.mutation(recordUsageRef, {
      operationKey: completedOperation,
      inputTokens: 4,
      settledMicroUsd: 4,
      model: OPENROUTER_EMBEDDING_MODEL,
      outcome: "completed",
      detail: "completed",
      indexMarker: {
        key: completedMarkerKey,
        detail: "Current public evidence document embedded.",
      },
    });
    await t.mutation(recordUsageRef, {
      operationKey: failedOperation,
      inputTokens: 10,
      settledMicroUsd: 10,
      model: OPENROUTER_EMBEDDING_MODEL,
      outcome: "failed",
      detail: "failed",
      indexMarker: {
        key: failedMarkerKey,
        detail: "failed index marker must not be recorded",
      },
    });
    await t.mutation(recordUsageRef, {
      operationKey: failedOperation,
      inputTokens: 10,
      settledMicroUsd: 10,
      model: OPENROUTER_EMBEDDING_MODEL,
      outcome: "failed",
      detail: "replayed",
    });

    await t.run(async (ctx) => {
      const spend = await ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q
            .eq("dayKey", dayKey())
            .eq("provider", "openrouter")
            .eq("bucket", 15),
        )
        .unique();
      expect(spend).toMatchObject({
        spentMicroUsd: 14,
        inputTokens: 14,
        requests: 2,
      });
      expect(
        await ctx.db
          .query("aiOperationalStates")
          .withIndex("by_key", (q) => q.eq("key", completedMarkerKey))
          .unique(),
      ).toMatchObject({
        healthy: true,
        detail: "Current public evidence document embedded.",
      });
      expect(
        await ctx.db
          .query("aiOperationalStates")
          .withIndex("by_key", (q) => q.eq("key", failedMarkerKey))
          .unique(),
      ).toBeNull();
      expect(
        (
          await ctx.db
            .query("semanticSearchOperations")
            .withIndex("by_operationKey", (q) =>
              q.eq("operationKey", failedOperation),
            )
            .unique()
        )?.status,
      ).toBe("failed");
    });
  });

  test("lease wakeups retain the conservative estimate for an expired request", async () => {
    const t = setup();
    await t.mutation(reserveUsageRef, reservationArgs("semantic:query:wakeup"));
    const row = await t.run((ctx) =>
      ctx.db.query("semanticSearchOperations").unique(),
    );
    const args = { operationId: row!._id };
    await t.mutation(internal.semanticSearch.recoverOperationLease, args);
    expect(
      (await t.run((ctx) => ctx.db.get("semanticSearchOperations", row!._id)))
        ?.status,
    ).toBe("leased");
    await t.run((ctx) =>
      ctx.db.patch("semanticSearchOperations", row!._id, { leaseExpiresAt: 1 }),
    );
    await t.mutation(internal.semanticSearch.recoverOperationLease, args);
    await t.mutation(internal.semanticSearch.recoverOperationLease, args);
    expect(
      (await t.run((ctx) => ctx.db.query("aiSpendBuckets").unique()))
        ?.spentMicroUsd,
    ).toBe(10);
    await t.run((ctx) =>
      ctx.db.patch("semanticSearchOperations", row!._id, {
        status: "completed",
      }),
    );
    await t.mutation(internal.semanticSearch.recoverOperationLease, args);
    expect(
      (await t.run((ctx) => ctx.db.get("semanticSearchOperations", row!._id)))
        ?.status,
    ).toBe("completed");
  });

  test("late index success records its completion marker after lease recovery", async () => {
    const t = setup();
    const operationKey = "semantic:index:late-success";
    await t.mutation(
      reserveUsageRef,
      reservationArgs(operationKey, { kind: "index" }),
    );
    const operation = await t.run((ctx) =>
      ctx.db
        .query("semanticSearchOperations")
        .withIndex("by_operationKey", (q) => q.eq("operationKey", operationKey))
        .unique(),
    );
    expect(operation).not.toBeNull();
    await t.run((ctx) =>
      ctx.db.patch("semanticSearchOperations", operation!._id, {
        leaseExpiresAt: 1,
      }),
    );
    await t.mutation(internal.semanticSearch.recoverOperationLease, {
      operationId: operation!._id,
    });

    const markerKey = `semantic-index:late-document:1:1:${OPENROUTER_EMBEDDING_MODEL}`;
    await t.mutation(recordUsageRef, {
      operationKey,
      inputTokens: 10,
      settledMicroUsd: 10,
      model: OPENROUTER_EMBEDDING_MODEL,
      outcome: "completed",
      detail: "late success",
      indexMarker: {
        key: markerKey,
        detail: "Current public evidence document embedded.",
      },
    });

    await expect(
      t.run((ctx) =>
        ctx.db
          .query("aiOperationalStates")
          .withIndex("by_key", (q) => q.eq("key", markerKey))
          .unique(),
      ),
    ).resolves.toMatchObject({ healthy: true });
    await expect(
      t.run((ctx) => ctx.db.get("semanticSearchOperations", operation!._id)),
    ).resolves.toMatchObject({ status: "failed", settledMicroUsd: 10 });
  });

  test("marks a crashed reservation failed without refunding an ambiguous provider call", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey: "2026-08-18",
        provider: "openrouter",
        bucket: 15,
        spentMicroUsd: 100,
        requests: 1,
        inputTokens: 50,
        outputTokens: 0,
        updatedAt: 1,
      });
      await ctx.db.insert("semanticSearchOperations", {
        operationKey: "semantic:query:test",
        kind: "query",
        fingerprint: "test",
        model: OPENROUTER_EMBEDDING_MODEL,
        status: "leased",
        holder: "worker",
        leaseExpiresAt: 10,
        reservationDayKey: "2026-08-18",
        reservationBucket: 15,
        reservedMicroUsd: 100,
        reservedInputTokens: 50,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect((await t.mutation(cleanupOperationsRef, { now: 11 })).failed).toBe(
      1,
    );
    expect((await t.mutation(cleanupOperationsRef, { now: 12 })).failed).toBe(
      0,
    );
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("aiSpendBuckets").unique())?.spentMicroUsd,
      ).toBe(100);
      expect(
        (await ctx.db.query("semanticSearchOperations").unique())?.status,
      ).toBe("failed");
    });
  });

  test("reports continuation for a full expired lease batch", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 100; index += 1) {
        await ctx.db.insert("semanticSearchOperations", {
          operationKey: `semantic:query:${index}`,
          kind: "query",
          fingerprint: "x",
          model: OPENROUTER_EMBEDDING_MODEL,
          status: "leased",
          holder: `worker-${index}`,
          leaseExpiresAt: 10,
          reservationDayKey: "2026-08-18",
          reservationBucket: 15,
          reservedMicroUsd: 1,
          reservedInputTokens: 1,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    expect(await t.mutation(cleanupOperationsRef, { now: 11 })).toMatchObject({
      failed: 100,
      hasMore: true,
    });
  });

  test("completed index records cannot starve an expired lease", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1)
        await ctx.db.insert("semanticSearchOperations", {
          operationKey: `semantic:index:${index}`,
          kind: "index",
          fingerprint: "done",
          model: OPENROUTER_EMBEDDING_MODEL,
          status: "completed",
          holder: "worker",
          reservationDayKey: "2026-08-18",
          reservationBucket: 15,
          reservedMicroUsd: 1,
          reservedInputTokens: 1,
          settledMicroUsd: 1,
          settledInputTokens: 1,
          createdAt: 1,
          updatedAt: 1,
          completedAt: 1,
        });
      await ctx.db.insert("semanticSearchOperations", {
        operationKey: "semantic:query:leased",
        kind: "query",
        fingerprint: "x",
        model: OPENROUTER_EMBEDDING_MODEL,
        status: "leased",
        holder: "worker",
        leaseExpiresAt: 10,
        reservationDayKey: "2026-08-18",
        reservationBucket: 15,
        reservedMicroUsd: 1,
        reservedInputTokens: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect(await t.mutation(cleanupOperationsRef, { now: 11 })).toMatchObject({
      failed: 1,
      hasMore: false,
    });
  });

  test("terminal query pruning bypasses durable index history", async () => {
    const t = setup();
    const now = 1_000_000;
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1)
        await ctx.db.insert("semanticSearchOperations", {
          operationKey: `semantic:index:terminal:${index}`,
          kind: "index",
          fingerprint: "done",
          model: OPENROUTER_EMBEDDING_MODEL,
          status: "completed",
          holder: "worker",
          reservationDayKey: "2026-08-18",
          reservationBucket: 15,
          reservedMicroUsd: 1,
          reservedInputTokens: 1,
          settledMicroUsd: 1,
          settledInputTokens: 1,
          createdAt: 1,
          updatedAt: 1,
          completedAt: 1,
        });
      for (let index = 0; index < 2; index += 1)
        await ctx.db.insert("semanticSearchOperations", {
          operationKey: `semantic:query:terminal:${index}`,
          kind: "query",
          fingerprint: "done",
          model: OPENROUTER_EMBEDDING_MODEL,
          status: "completed",
          holder: "worker",
          reservationDayKey: "2026-08-18",
          reservationBucket: 15,
          reservedMicroUsd: 1,
          reservedInputTokens: 1,
          settledMicroUsd: 1,
          settledInputTokens: 1,
          createdAt: 1,
          updatedAt: 1,
          completedAt: 1,
        });
    });
    expect(await t.mutation(cleanupOperationsRef, { now })).toMatchObject({
      deleted: 2,
      hasMore: false,
    });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("semanticSearchOperations").collect();
      expect(rows.filter((row) => row.kind === "query")).toHaveLength(0);
      expect(rows.filter((row) => row.kind === "index")).toHaveLength(101);
    });
  });
});
