/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { convexModelRoutingConfig } from "./modelRouting";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

test("rollback to legacy transport does not bypass an unresolved live operation", async () => {
  const t = convexTest(schema, modules);
  const request = {
    operationKey: "suki:forum-draft:rollback-held",
    jobId: "eliza-rollback-held",
    inputHash: "a".repeat(64),
    agentSlug: "suki",
    stage: "suki:forum-draft",
    model: "openrouter/free",
  };
  await t.mutation(internal.elizaRuntimeData.reserveCall, request);

  // The test bridge runs real Convex queries against the persisted ledger.
  const ctx = { runQuery: t.query.bind(t) } as unknown as ActionCtx;
  await expect(
    convexModelRoutingConfig(ctx, {
      correlationId: request.operationKey,
      runtimeScope: "forum-newsletter",
      elizaRuntime: "off",
    }),
  ).rejects.toThrow("operation_unavailable");

  await t.mutation(internal.elizaRuntimeData.recordReceipt, {
    ...request,
    status: "completed",
    runtimeVersion: "1.7.2",
    servedModel: "openrouter/free",
    inputTokens: 10,
    outputTokens: 2,
    outcomeUnknown: false,
  });
  const config = await convexModelRoutingConfig(ctx, {
    correlationId: request.operationKey,
    runtimeScope: "forum-newsletter",
    elizaRuntime: "off",
  });
  expect(config.elizaRuntime).toBeUndefined();
  expect(config.disabledModelIds).toEqual([]);
});
