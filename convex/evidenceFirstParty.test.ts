/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const sync = makeFunctionReference<
  "action",
  Record<string, never>,
  {
    documents: number;
    newVersions: number;
    claims: number;
  }
>("evidenceFirstParty:sync");

describe("first-party research evidence", () => {
  test("indexes the curated registry with replay-safe provenance", async () => {
    const t = convexTest(schema, modules);
    await expect(t.action(sync, {})).resolves.toEqual({
      documents: 3,
      newVersions: 3,
      claims: 3,
    });
    await expect(t.action(sync, {})).resolves.toEqual({
      documents: 3,
      newVersions: 0,
      claims: 0,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("evidenceDocuments").collect()).toHaveLength(3);
      expect(
        await ctx.db.query("evidenceDocumentVersions").collect(),
      ).toHaveLength(3);
      expect(await ctx.db.query("evidenceClaims").collect()).toHaveLength(3);
      expect(
        await ctx.db.query("evidenceClaimCitations").collect(),
      ).toHaveLength(3);
      const versions = await ctx.db.query("evidenceDocumentVersions").collect();
      expect(
        versions.every((version) =>
          version.metadataJson.includes("Austin Hamilton"),
        ),
      ).toBe(true);
    });
  });
});
