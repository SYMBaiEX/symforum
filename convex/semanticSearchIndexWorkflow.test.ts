import { afterEach, describe, expect, test, vi } from "vitest";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const workflowTest = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue("workflow-id"),
  options: [] as unknown[],
  handlers: [] as unknown[],
}));

vi.mock("@convex-dev/workflow", () => ({
  WorkflowManager: class {
    constructor(_component: unknown, options: unknown) {
      workflowTest.options.push(options);
    }

    define() {
      return {
        handler: (handler: unknown) => {
          workflowTest.handlers.push(handler);
          return handler;
        },
      };
    }

    start(...args: unknown[]) {
      return workflowTest.start(...args);
    }
  },
}));

import {
  enqueueNonPublicEvidenceDocumentCleanup,
  enqueueNonPublicEvidenceSourceCleanup,
  enqueuePublicEvidenceIndex,
  enqueuePublicEvidenceSourceIndex,
} from "./semanticSearchIndexWorkflow";

afterEach(() => {
  vi.unstubAllEnvs();
  workflowTest.start.mockClear();
});

describe("enqueuePublicEvidenceIndex", () => {
  test("does not start background work while semantic search is disabled", async () => {
    vi.stubEnv("SEMANTIC_SEARCH_ENABLED", "false");
    const runMutation = vi.fn();
    const ctx = { runMutation } as unknown as MutationCtx;

    await expect(
      enqueuePublicEvidenceIndex(
        ctx,
        "evidenceDocuments:test" as Id<"evidenceDocuments">,
      ),
    ).resolves.toBe(false);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("rejects invalid budgets and missing provider credentials before queueing", async () => {
    const runMutation = vi.fn();
    const ctx = { runMutation } as unknown as MutationCtx;
    vi.stubEnv("SEMANTIC_SEARCH_ENABLED", "true");
    vi.stubEnv("SEMANTIC_SEARCH_DAILY_BUDGET_USD", "0");
    vi.stubEnv("OPENROUTER_API_KEY", "configured-test-key");

    await expect(
      enqueuePublicEvidenceIndex(
        ctx,
        "evidenceDocuments:test" as Id<"evidenceDocuments">,
      ),
    ).resolves.toBe(false);
    expect(runMutation).not.toHaveBeenCalled();

    vi.stubEnv("SEMANTIC_SEARCH_DAILY_BUDGET_USD", "0.05");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(
      enqueuePublicEvidenceIndex(
        ctx,
        "evidenceDocuments:test" as Id<"evidenceDocuments">,
      ),
    ).resolves.toBe(false);
    expect(runMutation).not.toHaveBeenCalled();
  });

  test("queues enabled work in a single-concurrency workflow", async () => {
    vi.stubEnv("SEMANTIC_SEARCH_ENABLED", "true");
    vi.stubEnv("SEMANTIC_SEARCH_AUTO_INDEX_ENABLED", "true");
    vi.stubEnv("SEMANTIC_SEARCH_DAILY_BUDGET_USD", "0.05");
    vi.stubEnv("OPENROUTER_API_KEY", "configured-test-key");
    const ctx = {} as MutationCtx;
    const documentId = "evidenceDocuments:test" as Id<"evidenceDocuments">;

    await expect(enqueuePublicEvidenceIndex(ctx, documentId)).resolves.toBe(
      true,
    );
    expect(workflowTest.start).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      { documentId },
      { startAsync: true },
    );
    expect(workflowTest.options[0]).toEqual({
      workpoolOptions: { maxParallelism: 1, retryActionsByDefault: false },
    });
  });

  test("queues a source-scoped catch-up only when automatic indexing is enabled", async () => {
    vi.stubEnv("SEMANTIC_SEARCH_ENABLED", "true");
    vi.stubEnv("SEMANTIC_SEARCH_AUTO_INDEX_ENABLED", "true");
    vi.stubEnv("SEMANTIC_SEARCH_DAILY_BUDGET_USD", "0.05");
    vi.stubEnv("OPENROUTER_API_KEY", "configured-test-key");
    const ctx = {} as MutationCtx;
    const sourceId = "evidenceSources:test" as Id<"evidenceSources">;

    await expect(enqueuePublicEvidenceSourceIndex(ctx, sourceId)).resolves.toBe(
      true,
    );
    expect(workflowTest.start).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      { sourceId },
      { startAsync: true },
    );
  });

  test("queues document and source cleanup without semantic-search credentials", async () => {
    const ctx = {} as MutationCtx;
    const documentId = "evidenceDocuments:private" as Id<"evidenceDocuments">;
    const sourceId = "evidenceSources:paused" as Id<"evidenceSources">;

    await enqueueNonPublicEvidenceDocumentCleanup(ctx, documentId);
    await enqueueNonPublicEvidenceSourceCleanup(ctx, sourceId);

    expect(workflowTest.start).toHaveBeenCalledTimes(2);
    expect(workflowTest.start.mock.calls[0]?.[2]).toEqual({ documentId });
    expect(workflowTest.start.mock.calls[1]?.[2]).toEqual({ sourceId });
    expect(workflowTest.start.mock.calls[0]?.[3]).toEqual({
      startAsync: true,
    });
    expect(workflowTest.start.mock.calls[1]?.[3]).toEqual({
      startAsync: true,
    });
  });

  test("stale-vector reconciliation skips an absent namespace and paginates cleanup", async () => {
    const documentA = "evidenceDocuments:stale-a" as Id<"evidenceDocuments">;
    const documentB = "evidenceDocuments:stale-b" as Id<"evidenceDocuments">;
    const runAction = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ attempted: 1, skipped: 0 })
      .mockResolvedValueOnce({ attempted: 1, skipped: 0 });
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        documentIds: [documentA],
        continueCursor: "next-page",
        done: false,
      })
      .mockResolvedValueOnce({ documentIds: [documentB], done: true });
    const handler = workflowTest.handlers[4] as (
      step: { runAction: typeof runAction; runQuery: typeof runQuery },
      args: { cleanupVersion: 1 },
    ) => Promise<null>;

    await expect(
      handler({ runAction, runQuery }, { cleanupVersion: 1 }),
    ).resolves.toBeNull();

    expect(runAction).toHaveBeenCalledTimes(3);
    expect(runQuery).toHaveBeenNthCalledWith(1, expect.anything(), {});
    expect(runQuery).toHaveBeenNthCalledWith(2, expect.anything(), {
      cursor: "next-page",
    });
    expect(runAction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { documentIds: [documentA] },
      { retry: { maxAttempts: 4, initialBackoffMs: 1_000, base: 2 } },
    );
  });

  test("source cleanup pages bounded deletes", async () => {
    const sourceId = "evidenceSources:paused" as Id<"evidenceSources">;
    const runAction = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ attempted: 5, skipped: 0 })
      .mockResolvedValueOnce({ attempted: 1, skipped: 0 });
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        documentIds: Array.from(
          { length: 5 },
          (_, index) => `evidenceDocuments:${index}` as Id<"evidenceDocuments">,
        ),
        continueCursor: "next-page",
        done: false,
      })
      .mockResolvedValueOnce({
        documentIds: ["evidenceDocuments:last" as Id<"evidenceDocuments">],
        done: true,
      });
    const handler = workflowTest.handlers[3] as (
      step: { runAction: typeof runAction; runQuery: typeof runQuery },
      args: { sourceId: Id<"evidenceSources"> },
    ) => Promise<null>;

    await expect(handler({ runAction, runQuery }, { sourceId })).resolves.toBe(
      null,
    );
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runQuery).toHaveBeenNthCalledWith(1, expect.anything(), {
      sourceId,
    });
    expect(runAction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {
        documentIds: Array.from(
          { length: 5 },
          (_, index) => `evidenceDocuments:${index}`,
        ),
      },
      { retry: { maxAttempts: 4, initialBackoffMs: 1_000, base: 2 } },
    );
  });

  test("source cleanup avoids scanning documents when no namespace exists", async () => {
    const runAction = vi.fn().mockResolvedValue(false);
    const runQuery = vi.fn();
    const handler = workflowTest.handlers[3] as (
      step: { runAction: typeof runAction; runQuery: typeof runQuery },
      args: { sourceId: Id<"evidenceSources"> },
    ) => Promise<null>;

    await expect(
      handler(
        { runAction, runQuery },
        { sourceId: "evidenceSources:empty" as Id<"evidenceSources"> },
      ),
    ).resolves.toBeNull();
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runQuery).not.toHaveBeenCalled();
  });

  test("retries a budget-rejected document once in the next daily window", async () => {
    const indexArgs = {
      documentId: "evidenceDocuments:budgeted" as Id<"evidenceDocuments">,
    };
    const runAction = vi
      .fn()
      .mockResolvedValueOnce({ status: "skipped", reason: "budget" })
      .mockResolvedValueOnce({ status: "updated" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const handler = workflowTest.handlers[0] as (
      step: { runAction: typeof runAction; sleep: typeof sleep },
      args: typeof indexArgs,
    ) => Promise<null>;

    await expect(handler({ runAction, sleep }, indexArgs)).resolves.toBeNull();
    expect(sleep).toHaveBeenCalledWith(24 * 60 * 60 * 1_000);
    expect(runAction).toHaveBeenCalledTimes(2);
    expect(runAction).toHaveBeenNthCalledWith(2, expect.anything(), indexArgs, {
      retry: false,
    });
  });

  test("preserves source revision options when a circuit retry succeeds", async () => {
    const documentId = "evidenceDocuments:revisable" as Id<"evidenceDocuments">;
    const args = { documentId, allowPriorSourceRevision: true };
    const runQuery = vi.fn().mockResolvedValueOnce({
      documentIds: [documentId],
      done: true,
    });
    const runAction = vi
      .fn()
      .mockResolvedValueOnce({ status: "skipped", reason: "circuit_paused" })
      .mockResolvedValueOnce({ status: "updated" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const handler = workflowTest.handlers[1] as (
      step: {
        runQuery: typeof runQuery;
        runAction: typeof runAction;
        sleep: typeof sleep;
      },
      args: { sourceId: Id<"evidenceSources"> },
    ) => Promise<null>;

    await expect(
      handler(
        { runQuery, runAction, sleep },
        { sourceId: "evidenceSources:test" as Id<"evidenceSources"> },
      ),
    ).resolves.toBeNull();
    expect(sleep).toHaveBeenCalledWith(15 * 60 * 1_000);
    expect(runAction).toHaveBeenNthCalledWith(2, expect.anything(), args, {
      retry: false,
    });
  });

  test("source catch-up paginates and waits for a fresh daily budget window", async () => {
    const documentA = "evidenceDocuments:a" as Id<"evidenceDocuments">;
    const documentB = "evidenceDocuments:b" as Id<"evidenceDocuments">;
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        documentIds: [documentA],
        continueCursor: "next-page",
        done: false,
      })
      .mockResolvedValueOnce({
        documentIds: [documentB],
        done: true,
      });
    const runAction = vi
      .fn()
      .mockResolvedValueOnce({ status: "updated" })
      .mockResolvedValueOnce({ status: "skipped", reason: "budget" })
      .mockResolvedValueOnce({ status: "updated" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const handler = workflowTest.handlers[1] as (
      step: {
        runQuery: typeof runQuery;
        runAction: typeof runAction;
        sleep: typeof sleep;
      },
      args: { sourceId: Id<"evidenceSources"> },
    ) => Promise<null>;

    await expect(
      handler(
        { runQuery, runAction, sleep },
        { sourceId: "evidenceSources:test" as Id<"evidenceSources"> },
      ),
    ).resolves.toBeNull();
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(24 * 60 * 60 * 1_000);
    expect(runAction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { documentId: documentA, allowPriorSourceRevision: true },
      { retry: false },
    );
    expect(runAction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { documentId: documentB, allowPriorSourceRevision: true },
      { retry: false },
    );
    expect(runAction).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      { documentId: documentB, allowPriorSourceRevision: true },
      { retry: false },
    );
  });

  test("source catch-up skips a document that became private and continues", async () => {
    const privateDocument =
      "evidenceDocuments:private" as Id<"evidenceDocuments">;
    const publicDocument =
      "evidenceDocuments:public" as Id<"evidenceDocuments">;
    const runQuery = vi.fn().mockResolvedValueOnce({
      documentIds: [privateDocument, publicDocument],
      done: true,
    });
    const runAction = vi
      .fn()
      .mockResolvedValueOnce({ status: "skipped", reason: "not_public" })
      .mockResolvedValueOnce({ status: "updated" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const handler = workflowTest.handlers[1] as (
      step: {
        runQuery: typeof runQuery;
        runAction: typeof runAction;
        sleep: typeof sleep;
      },
      args: { sourceId: Id<"evidenceSources"> },
    ) => Promise<null>;

    await expect(
      handler(
        { runQuery, runAction, sleep },
        { sourceId: "evidenceSources:test" as Id<"evidenceSources"> },
      ),
    ).resolves.toBeNull();
    expect(runAction).toHaveBeenCalledTimes(2);
    expect(runAction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { documentId: publicDocument, allowPriorSourceRevision: true },
      { retry: false },
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  test("source catch-up skips an over-budget document and continues", async () => {
    const oversizedDocument =
      "evidenceDocuments:oversized" as Id<"evidenceDocuments">;
    const nextDocument = "evidenceDocuments:next" as Id<"evidenceDocuments">;
    const runQuery = vi.fn().mockResolvedValueOnce({
      documentIds: [oversizedDocument, nextDocument],
      done: true,
    });
    const runAction = vi
      .fn()
      .mockResolvedValueOnce({
        status: "skipped",
        reason: "request_exceeds_budget",
      })
      .mockResolvedValueOnce({ status: "updated" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const handler = workflowTest.handlers[1] as (
      step: {
        runQuery: typeof runQuery;
        runAction: typeof runAction;
        sleep: typeof sleep;
      },
      args: { sourceId: Id<"evidenceSources"> },
    ) => Promise<null>;

    await expect(
      handler(
        { runQuery, runAction, sleep },
        { sourceId: "evidenceSources:test" as Id<"evidenceSources"> },
      ),
    ).resolves.toBeNull();
    expect(runAction).toHaveBeenCalledTimes(2);
    expect(runAction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { documentId: nextDocument, allowPriorSourceRevision: true },
      { retry: false },
    );
    expect(sleep).not.toHaveBeenCalled();
  });
});
