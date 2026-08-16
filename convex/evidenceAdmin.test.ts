/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const dashboard = makeFunctionReference<"query", Record<string, never>, any>(
  "evidenceAdmin:dashboard",
);

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
