/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import { UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY } from "./universalSearchProjection";
import { readEvidencePublicationEpoch } from "./evidencePublicationEpoch";
import schema from "./schema";

const workflowTest = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue("workflow-id"),
}));

vi.mock("@convex-dev/workflow", () => ({
  WorkflowManager: class {
    constructor(_component: unknown, _options?: unknown) {}

    define() {
      return { handler: (handler: unknown) => handler };
    }

    start(...args: unknown[]) {
      return workflowTest.start(...args);
    }
  },
}));

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const dashboard = makeFunctionReference<"query", Record<string, never>, any>(
  "evidenceAdmin:dashboard",
);
const setSourceStatus = makeFunctionReference<
  "mutation",
  { sourceId: Id<"evidenceSources">; status: "active" | "paused" },
  {
    sourceId: Id<"evidenceSources">;
    status: "active" | "paused";
    updatedAt: number;
  }
>("evidenceAdmin:setSourceStatus");

describe("evidence admin dashboard", () => {
  test("denies non-admin viewers", async () => {
    const t = convexTest(schema, modules);
    const readerId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          name: "Reader",
          email: "reader@example.com",
          role: "reader",
        }),
    );
    await expect(
      t.withIdentity({ subject: readerId }).query(dashboard, {}),
    ).rejects.toThrow(/administrator access/i);
  });

  test("returns bounded source status without raw evidence payloads", async () => {
    const t = convexTest(schema, modules);
    const adminId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        name: "Admin",
        email: "admin@example.com",
        role: "admin",
      });
      for (let index = 0; index < 55; index++)
        await ctx.db.insert("evidenceSources", {
          sourceKey: `source-${index}`,
          name: `Source ${index}`,
          sourceType: "api",
          ingestionEnabled: true,
          baseUrl: "https://example.com",
          homepageUrl: "https://example.com",
          status: "active",
          licenseClass: "open",
          provenanceClass: "official",
          visibility: "public",
          termsUrl: "https://example.com/terms",
          etag: "",
          lastModified: "",
          cursor: "",
          lastFetchedAt: 0,
          lastSucceededAt: index,
          lastErrorAt: 0,
          lastErrorMessage: "secret error payload",
          createdAt: index,
          updatedAt: index,
        });
      return id;
    });
    const result = await t
      .withIdentity({ subject: adminId })
      .query(dashboard, {});
    expect(result.sources).toHaveLength(50);
    expect(result.bounds.sources).toBe(50);
    expect(result.sources[0]).not.toHaveProperty("etag");
    expect(result.sources[0]).not.toHaveProperty("cursor");
  });
});

describe("evidence source status lifecycle", () => {
  test("pausing a public source advances publication epoch and rebuilds search", async () => {
    const t = convexTest(schema, modules);
    const { adminId, sourceId } = await t.run(async (ctx) => {
      const adminId = await ctx.db.insert("users", {
        name: "Admin",
        email: "admin@example.com",
        role: "admin",
      });
      const sourceId = await ctx.db.insert("evidenceSources", {
        sourceKey: "public-source",
        name: "Public source",
        sourceType: "api",
        ingestionEnabled: true,
        baseUrl: "https://example.com",
        homepageUrl: "https://example.com",
        status: "active",
        licenseClass: "open",
        provenanceClass: "official",
        visibility: "public",
        termsUrl: "https://example.com/terms",
        etag: "",
        lastModified: "",
        cursor: "",
        lastFetchedAt: 0,
        lastSucceededAt: 0,
        lastErrorAt: 0,
        lastErrorMessage: "",
        createdAt: 1,
        updatedAt: 1,
      });
      return { adminId, sourceId };
    });

    const result = await t
      .withIdentity({ subject: adminId })
      .mutation(setSourceStatus, { sourceId, status: "paused" });

    expect(result.status).toBe("paused");
    await t.run(async (ctx) => {
      expect(await readEvidencePublicationEpoch(ctx)).toBe(1);
      expect(await ctx.db.get("evidenceSources", sourceId)).toMatchObject({
        status: "paused",
        ingestionEnabled: false,
      });
      const projectionState = await ctx.db
        .query("optimizationMigrations")
        .withIndex("by_key", (q) =>
          q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
        )
        .unique();
      expect(projectionState?.status).toBe("running");
    });
  });

  test("repeating a source status is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { adminId, sourceId } = await t.run(async (ctx) => {
      const adminId = await ctx.db.insert("users", {
        name: "Admin",
        email: "admin@example.com",
        role: "admin",
      });
      const sourceId = await ctx.db.insert("evidenceSources", {
        sourceKey: "public-source",
        name: "Public source",
        sourceType: "api",
        ingestionEnabled: true,
        baseUrl: "https://example.com",
        homepageUrl: "https://example.com",
        status: "active",
        licenseClass: "open",
        provenanceClass: "official",
        visibility: "public",
        termsUrl: "https://example.com/terms",
        etag: "",
        lastModified: "",
        cursor: "",
        lastFetchedAt: 0,
        lastSucceededAt: 0,
        lastErrorAt: 0,
        lastErrorMessage: "",
        createdAt: 1,
        updatedAt: 123,
      });
      return { adminId, sourceId };
    });

    const result = await t
      .withIdentity({ subject: adminId })
      .mutation(setSourceStatus, { sourceId, status: "active" });

    expect(result.updatedAt).toBe(123);
    await t.run(async (ctx) => {
      expect((await ctx.db.get("evidenceSources", sourceId))?.updatedAt).toBe(
        123,
      );
      expect(await readEvidencePublicationEpoch(ctx)).toBe(0);
      expect(
        await ctx.db
          .query("optimizationMigrations")
          .withIndex("by_key", (q) =>
            q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
          )
          .unique(),
      ).toBeNull();
    });
  });

  test("repairs ingestion state without invalidating public publication", async () => {
    const t = convexTest(schema, modules);
    const { adminId, sourceId } = await t.run(async (ctx) => {
      const adminId = await ctx.db.insert("users", {
        name: "Admin",
        email: "admin@example.com",
        role: "admin",
      });
      const sourceId = await ctx.db.insert("evidenceSources", {
        sourceKey: "public-source",
        name: "Public source",
        sourceType: "api",
        ingestionEnabled: false,
        baseUrl: "https://example.com",
        homepageUrl: "https://example.com",
        status: "active",
        licenseClass: "open",
        provenanceClass: "official",
        visibility: "public",
        termsUrl: "https://example.com/terms",
        etag: "",
        lastModified: "",
        cursor: "",
        lastFetchedAt: 0,
        lastSucceededAt: 0,
        lastErrorAt: 0,
        lastErrorMessage: "",
        createdAt: 1,
        updatedAt: 1,
      });
      return { adminId, sourceId };
    });

    await t
      .withIdentity({ subject: adminId })
      .mutation(setSourceStatus, { sourceId, status: "active" });

    await t.run(async (ctx) => {
      expect(await ctx.db.get("evidenceSources", sourceId)).toMatchObject({
        status: "active",
        ingestionEnabled: true,
      });
      expect(await readEvidencePublicationEpoch(ctx)).toBe(0);
      expect(
        await ctx.db
          .query("optimizationMigrations")
          .withIndex("by_key", (q) =>
            q.eq("key", UNIVERSAL_SEARCH_PROJECTION_MIGRATION_KEY),
          )
          .unique(),
      ).toBeNull();
    });
  });
});
