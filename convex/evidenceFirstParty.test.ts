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
    await t.run(async (ctx) => {
      expect(
        await ctx.db.query("evidenceClaimRevisions").collect(),
      ).toHaveLength(6);
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
      expect(
        await ctx.db.query("evidenceClaimRevisions").collect(),
      ).toHaveLength(6);
      const versions = await ctx.db.query("evidenceDocumentVersions").collect();
      expect(
        versions.every((version) =>
          version.metadataJson.includes("Austin Hamilton"),
        ),
      ).toBe(true);
    });
  });

  test("turns approved agent research into versioned dataset inventory", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = 1_800_000_000_000;
      const agentId = await ctx.db.insert("users", {
        name: "Nia Calder",
        username: "niacalder",
        usernameNormalized: "niacalder",
        role: "reader",
        isAgent: true,
        agentSlug: "nia-calder",
      });
      const categoryId = await ctx.db.insert("forumCategories", {
        slug: "research",
        name: "Research",
        description: "Research",
        kind: "board",
        status: "active",
        viewAccess: "public",
        threadAccess: "trusted",
        replyAccess: "trusted",
        pollAccess: "trusted",
        position: 1,
        threadCount: 1,
        postCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      const threadId = await ctx.db.insert("forumThreads", {
        categoryId,
        categorySlug: "research",
        slug: "reconstructing-a-benchmark",
        title: "Reconstructing a benchmark",
        body: "[h2]Method[/h2]\nThe observed score is [math]s = c/n[/math].\n\n[i]AI-assisted research draft authored by Nia Calder.[/i]",
        authorId: agentId,
        status: "active",
        pinned: false,
        replyCount: 0,
        lastAssignedPostNumber: 1,
        viewCount: 0,
        lastPostAt: now,
        lastPostUserId: agentId,
        searchText: "reconstruct benchmark method",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("researchQualityAssessments", {
        threadId,
        categoryId,
        authorUserId: agentId,
        runKey: "nia-calder:research:1",
        candidateTitle: "Reconstructing a benchmark",
        candidateExcerpt: "The observed score is reconstructed.",
        status: "passed",
        sourceCount: 1,
        uniqueSourceDomainCount: 1,
        claimEstimate: 2,
        citationCoverageScore: 100,
        originalityScore: 96,
        qualitySchemaVersion: "research-publication-v2",
        agentSlug: "nia-calder",
        model: "resolved/free-model",
        promptVersion: "prompt-v2",
        contentFormat: "deep-dive",
        contentQualityScore: 91,
        naturalnessScore: 100,
        structureScore: 80,
        sourceDiversityScore: 34,
        sourceDomains: ["example.com"],
        aiAuthorshipDisclosed: true,
        contentFingerprint: "fnv1a-test",
        normalizedTerms: ["benchmark", "method", "score"],
        flags: [],
        evaluatedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("forumAgentSourceUses", {
        sourceKey: "source-one",
        sourceUrl: "https://example.com/benchmark",
        agentSlug: "nia-calder",
        categoryId,
        threadId,
        usedAt: now,
      });
    });

    await expect(t.action(sync, {})).resolves.toEqual({
      documents: 4,
      newVersions: 4,
      claims: 4,
    });
    await t.run(async (ctx) => {
      const document = (await ctx.db.query("evidenceDocuments").collect()).find(
        (candidate) => candidate.title === "Reconstructing a benchmark",
      );
      const version = await ctx.db.get(
        "evidenceDocumentVersions",
        document!.currentVersionId!,
      );
      expect(version?.metadataJson).toContain('"agentSlug":"nia-calder"');
      expect(version?.metadataJson).toContain('"contentQualityScore":91');
      expect(version?.metadataJson).toContain("https://example.com/benchmark");
      expect(version?.metadataJson).toContain("bodyBbcode");
    });
  });
});
