/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const check = makeFunctionReference<
  "mutation",
  { now?: number },
  {
    status: "healthy" | "degraded";
    sourceCount: number;
    staleSourceKeys: string[];
    failedSourceKeys: string[];
    stuckResearchJobs: number;
    stuckExportJobs: number;
    truncated: boolean;
    summary: string;
    lastCheckedAt: number;
    lastChangedAt: number;
  }
>("evidenceHealth:check");

function setup() {
  return convexTest(schema, modules);
}

describe("evidence operational health", () => {
  test("records degraded and recovered transitions without leaking job data", async () => {
    const t = setup();
    const now = 1_800_000_000_000;
    const ids = await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", {
        name: "Health owner",
        username: "health-owner",
        usernameNormalized: "health-owner",
        role: "reader",
      });
      const sourceId = await ctx.db.insert("evidenceSources", {
        sourceKey: "cisa-kev",
        name: "CISA KEV",
        sourceType: "dataset",
        ingestionEnabled: true,
        baseUrl: "https://www.cisa.gov/",
        homepageUrl:
          "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
        status: "active",
        licenseClass: "public-domain",
        provenanceClass: "official",
        visibility: "public",
        termsUrl: "https://www.cisa.gov/",
        etag: "",
        lastModified: "",
        cursor: "",
        lastFetchedAt: now - 1_000,
        lastSucceededAt: now - 1_000,
        lastErrorAt: 0,
        lastErrorMessage: "",
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
      });
      return { ownerUserId, sourceId };
    });

    await expect(t.mutation(check, { now })).resolves.toMatchObject({
      status: "healthy",
      sourceCount: 1,
      stuckResearchJobs: 0,
      stuckExportJobs: 0,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("systemLogs").collect()).toHaveLength(0);
    });

    const jobId = await t.run(async (ctx) => {
      await ctx.db.patch("evidenceSources", ids.sourceId, {
        lastSucceededAt: now - 4 * 60 * 60 * 1_000,
        updatedAt: now,
      });
      return await ctx.db.insert("evidenceResearchJobs", {
        ownerUserId: ids.ownerUserId,
        agentId: "health-agent",
        requestKey: "health-request",
        requestFingerprint: "health-fingerprint",
        idempotencyKey: "health-idempotency",
        quotaUnits: 1,
        status: "queued",
        query: "health",
        resultJson: "{}",
        errorMessage: "",
        expiresAt: now + 60 * 60 * 1_000,
        createdAt: now - 60 * 60 * 1_000,
        updatedAt: now - 60 * 60 * 1_000,
      });
    });
    await expect(t.mutation(check, { now })).resolves.toMatchObject({
      status: "degraded",
      staleSourceKeys: ["cisa-kev"],
      stuckResearchJobs: 1,
    });
    await t.run(async (ctx) => {
      const logs = await ctx.db.query("systemLogs").collect();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        level: "warn",
        eventType: "evidence_health_degraded",
        status: "open",
      });
      expect(logs[0]?.message).not.toContain("health-request");
    });

    await t.run(async (ctx) => {
      await ctx.db.patch("evidenceSources", ids.sourceId, {
        lastSucceededAt: now + 1,
        updatedAt: now + 1,
      });
      await ctx.db.patch("evidenceResearchJobs", jobId, {
        status: "completed",
        updatedAt: now + 1,
      });
    });
    await expect(t.mutation(check, { now: now + 1 })).resolves.toMatchObject({
      status: "healthy",
      staleSourceKeys: [],
      stuckResearchJobs: 0,
    });
    await t.run(async (ctx) => {
      const logs = await ctx.db.query("systemLogs").collect();
      expect(logs).toHaveLength(2);
      expect(logs.find((log) => log.level === "warn")?.status).toBe("resolved");
      expect(logs.find((log) => log.level === "info")).toMatchObject({
        eventType: "evidence_health_recovered",
        status: "open",
      });
      const health = await ctx.db
        .query("evidenceOperationalHealth")
        .withIndex("by_healthKey", (q) =>
          q.eq("healthKey", "evidence-production"),
        )
        .unique();
      expect(health).toMatchObject({ status: "healthy", sourceCount: 1 });
    });
  });
});
