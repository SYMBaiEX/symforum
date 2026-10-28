/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const request = {
  jobId: "eliza-test-1",
  inputHash: "a".repeat(64),
  agentSlug: "suki",
  stage: "suki:forum-reply",
  model: "openrouter/free",
  operationKey: "reply:one-source-run",
};
const setup = () => convexTest(schema, modules);

describe("durable Eliza operation admission", () => {
  test("safe worker diagnostics preserve a definite pre-inference failure", async () => {
    const t = setup();
    await t.mutation(internal.elizaRuntimeData.reserveCall, request);
    await t.mutation(internal.elizaRuntimeData.recordReceipt, {
      ...request,
      status: "failed",
      outcomeUnknown: false,
      workerErrorCode: "worker_busy",
      workerHttpStatus: 503,
    });
    const [saved] = await t.query(internal.elizaRuntimeData.inspect, {
      agentSlug: "suki",
      jobId: request.jobId,
    });
    expect(saved).toMatchObject({
      status: "failed",
      outcomeUnknown: false,
      workerErrorCode: "worker_busy",
      workerHttpStatus: 503,
    });
    await t.query(internal.elizaRuntimeData.assertOperationReady, {
      operationKey: request.operationKey,
    });
    await expect(
      t.mutation(internal.elizaRuntimeData.recordReceipt, {
        ...request,
        status: "failed",
        workerErrorCode: "raw exception: private",
      }),
    ).rejects.toThrow("invalid_eliza_runtime_receipt");
  });

  test("exact job inspection reaches older receipts and enforces agent binding", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 45; i++)
        await ctx.db.insert("elizaRuntimeCalls", {
          ...request,
          jobId: `eliza-history-${i}`,
          operationKey: `history:${i}`,
          status: "failed",
          outcomeUnknown: true,
          createdAt: i,
          updatedAt: i,
          expiresAt: Date.now() + 86400000,
        });
    });
    expect(
      await t.query(internal.elizaRuntimeData.inspect, {
        agentSlug: "suki",
        jobId: "eliza-history-0",
      }),
    ).toHaveLength(1);
    expect(
      await t.query(internal.elizaRuntimeData.inspect, {
        agentSlug: "nyx",
        jobId: "eliza-history-0",
      }),
    ).toEqual([]);
  });

  test("one concurrent provider intent per logical operation", async () => {
    const t = setup();
    const attempts = await Promise.allSettled(
      [1, 2, 3].map((n) =>
        t.mutation(internal.elizaRuntimeData.reserveCall, {
          ...request,
          jobId: `eliza-test-${n}`,
        }),
      ),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await t.query(internal.elizaRuntimeData.inspect, { agentSlug: "suki" }),
    ).toHaveLength(1);
    await expect(
      t.query(internal.elizaRuntimeData.assertOperationReady, {
        operationKey: request.operationKey,
      }),
    ).rejects.toThrow("eliza_runtime_operation_unresolved");
  });

  test("missing receipt remains a hold across a later scheduled invocation", async () => {
    const t = setup();
    await t.mutation(internal.elizaRuntimeData.reserveCall, request);
    await expect(
      t.mutation(internal.elizaRuntimeData.reserveCall, {
        ...request,
        jobId: "eliza-later-invocation",
      }),
    ).rejects.toThrow("eliza_runtime_operation_unresolved");
    // Idempotent transport redelivery can reuse its original durable identity.
    await t.mutation(internal.elizaRuntimeData.reserveCall, request);
    expect(
      await t.run((ctx) => ctx.db.query("elizaRuntimeCalls").take(10)),
    ).toHaveLength(1);
  });

  test("uncertain result quarantines all stages/models of the logical run", async () => {
    const t = setup();
    await t.mutation(internal.elizaRuntimeData.reserveCall, request);
    await t.mutation(internal.elizaRuntimeData.recordReceipt, {
      ...request,
      status: "failed",
      outcomeUnknown: true,
    });
    await expect(
      t.mutation(internal.elizaRuntimeData.reserveCall, {
        ...request,
        jobId: "eliza-rescheduled",
        stage: "suki:forum-evidence-review",
        model: "~deepseek/deepseek-v4-flash-latest",
      }),
    ).rejects.toThrow("eliza_runtime_operation_unresolved");
    // A different publication run is not globally disabled by this one hold.
    await t.mutation(internal.elizaRuntimeData.reserveCall, {
      ...request,
      jobId: "eliza-other-run",
      operationKey: "reply:other-source-run",
    });
    await t.mutation(internal.elizaRuntimeData.recordReceipt, {
      ...request,
      status: "failed",
      outcomeUnknown: false,
    });
    await expect(
      t.query(internal.elizaRuntimeData.assertOperationReady, {
        operationKey: request.operationKey,
      }),
    ).rejects.toThrow("eliza_runtime_operation_unresolved");
  });

  test("known provider rejection releases intent for the separately budgeted fallback", async () => {
    const t = setup();
    await t.mutation(internal.elizaRuntimeData.reserveCall, request);
    await t.mutation(internal.elizaRuntimeData.recordReceipt, {
      ...request,
      status: "failed",
      providerStatus: 404,
      outcomeUnknown: false,
    });
    await t.query(internal.elizaRuntimeData.assertOperationReady, {
      operationKey: request.operationKey,
    });
    const fallback = {
      ...request,
      jobId: "eliza-paid-fallback",
      model: "~deepseek/deepseek-v4-flash-latest",
    };
    await t.mutation(internal.elizaRuntimeData.reserveCall, fallback);
    await t.mutation(internal.elizaRuntimeData.recordReceipt, {
      ...fallback,
      status: "completed",
      runtimeVersion: "1.7.2",
      inputTokens: 20,
      outputTokens: 10,
    });
    await t.query(internal.elizaRuntimeData.assertOperationReady, {
      operationKey: request.operationKey,
    });
  });

  test("completion is idempotent, immutable against failure and identity conflicts", async () => {
    const t = setup();
    await expect(
      t.mutation(internal.elizaRuntimeData.recordReceipt, {
        ...request,
        status: "completed",
      }),
    ).rejects.toThrow("eliza_runtime_request_not_reserved");
    await t.mutation(internal.elizaRuntimeData.reserveCall, request);
    const receipt = {
      ...request,
      status: "completed" as const,
      runtimeVersion: "1.7.2",
      inputTokens: 5,
      outputTokens: 3,
    };
    await t.mutation(internal.elizaRuntimeData.recordReceipt, receipt);
    await t.mutation(internal.elizaRuntimeData.recordReceipt, receipt);
    await t.mutation(internal.elizaRuntimeData.recordReceipt, {
      ...request,
      status: "failed",
      outcomeUnknown: true,
    });
    const [saved] = await t.query(internal.elizaRuntimeData.inspect, {
      agentSlug: "suki",
    });
    expect(saved.status).toBe("completed");
    await expect(
      t.mutation(internal.elizaRuntimeData.recordReceipt, {
        ...receipt,
        inputHash: "b".repeat(64),
      }),
    ).rejects.toThrow("eliza_runtime_receipt_conflict");
    await t.query(internal.elizaRuntimeData.assertOperationReady, {
      operationKey: request.operationKey,
    });
  });

  test("retention never clears unresolved-operation tombstones", async () => {
    const t = setup();
    await t.mutation(internal.elizaRuntimeData.reserveCall, request);
    await t.mutation(internal.elizaRuntimeData.recordReceipt, {
      ...request,
      status: "failed",
      outcomeUnknown: true,
    });
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("elizaRuntimeCalls").take(1);
      await ctx.db.patch("elizaRuntimeCalls", row._id, { expiresAt: 0 });
    });
    expect(await t.mutation(internal.elizaRuntimeData.cleanup, {})).toBe(1);
    await expect(
      t.mutation(internal.elizaRuntimeData.reserveCall, {
        ...request,
        jobId: "eliza-after-retention",
      }),
    ).rejects.toThrow("eliza_runtime_operation_unresolved");
    expect(await t.run((ctx) => ctx.db.query("forumPosts").take(1))).toEqual(
      [],
    );
    expect(
      await t.run((ctx) => ctx.db.query("newsletterIssues").take(1)),
    ).toEqual([]);
  });
});
