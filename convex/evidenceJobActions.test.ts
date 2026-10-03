/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const routingMocks = vi.hoisted(() => ({
  convexModelRoutingConfig: vi.fn(),
  runWithModelFallback: vi.fn(),
}));

vi.mock("./modelRouting", () => ({
  convexModelRoutingConfig: routingMocks.convexModelRoutingConfig,
}));
vi.mock("../lib/ai-model-routing", () => ({
  runWithModelFallback: routingMocks.runWithModelFallback,
}));

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

test("evidence research skips model routing when search returns no sources", async () => {
  routingMocks.convexModelRoutingConfig.mockReset();
  routingMocks.convexModelRoutingConfig.mockResolvedValue({});
  routingMocks.runWithModelFallback.mockReset();
  routingMocks.runWithModelFallback.mockResolvedValue(null);
  const t = convexTest(schema, modules);
  const ownerUserId = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", {
      name: "Owner",
      username: "owner",
      usernameNormalized: "owner",
      role: "owner",
    });
    const agentUserId = await ctx.db.insert("users", {
      name: "Research Agent",
      username: "research-agent",
      usernameNormalized: "research-agent",
      role: "reader",
      isAgent: true,
      agentSlug: "research-agent",
    });
    await ctx.db.insert("agentIdentities", {
      agentId: "research-agent",
      userId: agentUserId,
      ownerUserId,
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      scopes: ["evidence"],
      status: "active",
      keyVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return ownerUserId;
  });
  const job = await t.mutation(internal.evidenceJobs.createResearchJob, {
    ownerUserId,
    agentId: "research-agent",
    query: "a query with no indexed evidence",
    idempotencyKey: "empty-evidence-search",
    requestFingerprint: "empty-evidence-search",
    quotaUnits: 1,
  });
  const claim = await t.mutation(internal.evidenceJobs.claimResearchExecution, {
    jobId: job.jobId,
  });
  expect(claim).not.toBeNull();

  const result = await t.action(internal.evidenceJobActions.runResearch, {
    jobId: job.jobId,
    executionToken: claim!.executionToken,
  });

  expect(result.started).toBe(true);
  if (!result.started) throw new Error("Expected the research job to start");
  const payload = JSON.parse(result.resultJson) as { markdown: string };
  expect(payload).toMatchObject({
    generated: false,
    route: null,
    fallback: "deterministic-extractive",
    sources: [],
  });
  expect(payload.markdown).toContain("no model analysis was attempted");
  expect(routingMocks.convexModelRoutingConfig).not.toHaveBeenCalled();
  expect(routingMocks.runWithModelFallback).not.toHaveBeenCalled();
});
