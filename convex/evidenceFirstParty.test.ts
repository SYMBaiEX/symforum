/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isPublicEvidenceClaim } from "./evidenceVisibility";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  readEvidencePublicationEpoch,
  isEvidencePublicationEpochCurrent,
} from "./evidencePublicationEpoch";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const sync = makeFunctionReference<
  "action",
  Record<string, never>,
  {
    documents: number;
    newVersions: number;
    claims: number;
  }
>("evidenceFirstParty:sync");

function setup() {
  return convexTest(schema, modules);
}

async function seedApprovedResearch(
  t: ReturnType<typeof setup>,
  options: {
    slug: string;
    parentAccess?: "public" | "members";
    categoryAccess?: "public" | "members";
  },
) {
  return await t.run(async (ctx) => {
    const now = 1_800_000_000_000;
    const agentId = await ctx.db.insert("users", {
      name: `Agent ${options.slug}`,
      username: `agent-${options.slug}`,
      usernameNormalized: `agent-${options.slug}`,
      role: "reader",
      isAgent: true,
      agentSlug: `agent-${options.slug}`,
    });
    const parentCategoryId = await ctx.db.insert("forumCategories", {
      slug: `section-${options.slug}`,
      name: `Section ${options.slug}`,
      description: "Section",
      kind: "section",
      status: "active",
      viewAccess: options.parentAccess ?? "public",
      threadAccess: "closed",
      replyAccess: "closed",
      pollAccess: "closed",
      position: 1,
      threadCount: 0,
      postCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    const categoryId = await ctx.db.insert("forumCategories", {
      slug: `research-${options.slug}`,
      name: `Research ${options.slug}`,
      description: "Research",
      kind: "board",
      parentCategoryId,
      status: "active",
      viewAccess: options.categoryAccess ?? "public",
      threadAccess: "trusted",
      replyAccess: "trusted",
      pollAccess: "trusted",
      position: 2,
      threadCount: 1,
      postCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const threadId = await ctx.db.insert("forumThreads", {
      categoryId,
      categorySlug: `research-${options.slug}`,
      slug: options.slug,
      title: `Research ${options.slug}`,
      body: `[h2]Method[/h2]\nEvidence for ${options.slug}.\n\n[i]AI-assisted research.[/i]`,
      authorId: agentId,
      status: "active",
      pinned: false,
      replyCount: 0,
      viewCount: 0,
      lastPostAt: now,
      lastPostUserId: agentId,
      searchText: `research ${options.slug}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("researchQualityAssessments", {
      threadId,
      categoryId,
      authorUserId: agentId,
      runKey: `run:${options.slug}`,
      candidateTitle: `Research ${options.slug}`,
      candidateExcerpt: `Evidence for ${options.slug}`,
      status: "passed",
      sourceCount: 1,
      uniqueSourceDomainCount: 1,
      claimEstimate: 1,
      citationCoverageScore: 100,
      originalityScore: 99,
      aiAuthorshipDisclosed: true,
      contentFingerprint: `fingerprint-${options.slug}`,
      normalizedTerms: ["research", options.slug],
      flags: [],
      evaluatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { agentId, parentCategoryId, categoryId, threadId, now };
  });
}

describe("first-party research evidence", () => {
  test.each([
    "delete",
    "status",
    "move",
    "merge",
    "edit",
    "edit_without_assessment",
    "quality",
    "quality_rejection",
    "category_access",
    "ancestor_access",
    "ancestor_status",
  ] as const)(
    "fences artifacts transactionally for %s before reconciliation",
    async (change) => {
      const t = setup();
      const seeded = await seedApprovedResearch(t, {
        slug: `epoch-${change.replaceAll("_", "-")}`,
      });
      const destination = await seedApprovedResearch(t, {
        slug: "epoch-destination",
      });
      const ownerId = await t.run((ctx) =>
        ctx.db.insert("users", { name: "Owner", role: "owner" }),
      );
      const owner = t.withIdentity({ subject: ownerId, name: "Owner" });
      await t.action(sync, {});
      if (change === "quality_rejection")
        await owner.mutation(api.researchQuality.evaluateThread, {
          threadId: seeded.threadId,
        });
      const before = await t.run(readEvidencePublicationEpoch);

      if (change === "delete")
        await owner.mutation(api.forum.deleteThread, {
          threadId: seeded.threadId,
        });
      else if (change === "status")
        await owner.mutation(api.forum.updateForumThreadModeration, {
          threadId: seeded.threadId,
          status: "deleted",
        });
      else if (change === "move")
        await owner.mutation(api.forum.moveForumThread, {
          threadId: seeded.threadId,
          targetCategoryId: destination.categoryId,
        });
      else if (change === "merge")
        await owner.mutation(api.forum.mergeForumThread, {
          sourceThreadId: seeded.threadId,
          targetThreadId: destination.threadId,
        });
      else if (change === "edit" || change === "edit_without_assessment") {
        if (change === "edit_without_assessment")
          await t.run(async (ctx) => {
            const assessment = await ctx.db
              .query("researchQualityAssessments")
              .withIndex("by_threadId", (q) =>
                q.eq("threadId", seeded.threadId),
              )
              .unique();
            await ctx.db.delete("researchQualityAssessments", assessment!._id);
          });
        await owner.mutation(api.forum.updateThreadContent, {
          threadId: seeded.threadId,
          title: "Corrected research title",
          body: "Corrected research content with a materially different conclusion.",
        });
      } else if (change === "quality")
        await owner.mutation(api.researchQuality.evaluateThread, {
          threadId: seeded.threadId,
        });
      else if (change === "quality_rejection") {
        const assessment = await t.run((ctx) =>
          ctx.db
            .query("researchQualityAssessments")
            .withIndex("by_threadId", (q) => q.eq("threadId", seeded.threadId))
            .unique(),
        );
        await owner.mutation(api.researchQuality.review, {
          assessmentId: assessment!._id,
          decision: "rejected",
          reason: "The evidence does not support this research conclusion.",
        });
      } else {
        const categoryId =
          change === "category_access"
            ? seeded.categoryId
            : seeded.parentCategoryId;
        const category = await t.run((ctx) =>
          ctx.db.get("forumCategories", categoryId),
        );
        await owner.mutation(api.forum.upsertForumCategory, {
          categoryId,
          name: category!.name,
          slug: category!.slug,
          kind: category!.kind,
          parentCategoryId: category!.parentCategoryId,
          status: change === "ancestor_status" ? "archived" : "active",
          viewAccess: change === "ancestor_status" ? "public" : "members",
        });
      }
      // No timers have advanced: the document is still physically public, but
      // every artifact stamped before the write is already rejected.
      await t.run(async (ctx) => {
        expect(await readEvidencePublicationEpoch(ctx)).toBeGreaterThan(before);
        expect(await isEvidencePublicationEpochCurrent(ctx, before)).toBe(
          false,
        );
        const documents = await ctx.db.query("evidenceDocuments").collect();
        expect(
          documents.find(
            (doc) => doc.externalKey === `forum-research:${seeded.threadId}`,
          )?.visibility,
        ).toBe("public");
      });
    },
  );

  test("engagement and safety scans do not invalidate published artifacts", async () => {
    const t = setup();
    const seeded = await seedApprovedResearch(t, { slug: "epoch-engagement" });
    const ownerId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Owner", role: "owner" }),
    );
    const owner = t.withIdentity({ subject: ownerId, name: "Owner" });
    await t.action(sync, {});
    const before = await t.run(readEvidencePublicationEpoch);
    await owner.mutation(api.forum.recordThreadView, {
      threadId: seeded.threadId,
    });
    await owner.mutation(api.forum.updateForumThreadModeration, {
      threadId: seeded.threadId,
      pinned: true,
    });
    await t.mutation(internal.evidenceFirstParty.enqueueForumResearchThread, {
      threadId: seeded.threadId,
      reason: "reconciliation",
    });
    expect(await t.run(readEvidencePublicationEpoch)).toBe(before);
  });

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
      const source = (await ctx.db.query("evidenceSources").collect())[0]!;
      await ctx.db.patch("evidenceSources", source._id, { updatedAt: 123 });
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
      const source = (await ctx.db.query("evidenceSources").collect())[0]!;
      expect(source.updatedAt).toBe(123);
      expect(source.lastSucceededAt).toBeGreaterThan(0);
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

    const checkpointBefore = await t.run((ctx) =>
      ctx.db.query("evidenceFirstPartyCheckpoints").collect(),
    );
    await t.run(async (ctx) => {
      const thread = (await ctx.db.query("forumThreads").collect())[0]!;
      await ctx.db.patch("forumThreads", thread._id, {
        viewCount: 400,
        updatedAt: thread.updatedAt + 1_000,
      });
    });
    await expect(t.action(sync, {})).resolves.toMatchObject({
      newVersions: 0,
      claims: 0,
    });
    expect(
      await t.run((ctx) =>
        ctx.db.query("evidenceFirstPartyCheckpoints").collect(),
      ),
    ).toEqual(checkpointBefore);

    await t.run(async (ctx) => {
      const assessment = (
        await ctx.db.query("researchQualityAssessments").collect()
      )[0]!;
      await ctx.db.patch("researchQualityAssessments", assessment._id, {
        contentQualityScore: 95,
      });
    });
    const changedThreadId = await t.run(
      async (ctx) => (await ctx.db.query("forumThreads").first())!._id,
    );
    await t.mutation(internal.evidenceFirstParty.enqueueForumResearchThread, {
      threadId: changedThreadId,
      reason: "quality_changed",
    });
    await expect(t.action(sync, {})).resolves.toMatchObject({ newVersions: 1 });

    const registry = await t.mutation(
      internal.evidenceFirstParty.syncRegistry,
      {},
    );
    const research = (
      await t.query(
        internal.researchQuality.listPublishedResearchForEvidenceSync,
        {},
      )
    )[0]!;
    const before = await t.run((ctx) =>
      ctx.db.query("evidenceDocumentVersions").collect(),
    );
    // Failure after the version upsert rolls back the document and checkpoint.
    const author = await t.run(async (ctx) => {
      const thread = (await ctx.db.get("forumThreads", research.threadId))!;
      const author = (await ctx.db.get("users", thread.authorId))!;
      await ctx.db.patch("forumThreads", thread._id, {
        title: "Updated research",
      });
      await ctx.db.patch("users", author._id, { username: "x".repeat(10_000) });
      return author;
    });
    await expect(
      t.mutation(internal.evidenceFirstParty.syncResearch, {
        sourceId: registry.sourceId,
        projectId: registry.projectId,
        research: {
          ...research,
          title: "Updated research",
          authorName: "x".repeat(10_000),
        },
      }),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("evidenceDocumentVersions").collect()),
    ).toEqual(before);
    await t.run(async (ctx) => {
      await ctx.db.patch("users", author._id, { username: author.username });
    });
    await expect(
      t.mutation(internal.evidenceFirstParty.syncResearch, {
        sourceId: registry.sourceId,
        projectId: registry.projectId,
        research: { ...research, title: "Updated research" },
      }),
    ).resolves.toMatchObject({ newVersions: 1 });
  });

  test("rejects stale publication generations and rechecks visibility before committing", async () => {
    const t = setup();
    const seeded = await seedApprovedResearch(t, { slug: "stale-publication" });
    await t.action(sync, {});
    const registry = await t.mutation(
      internal.evidenceFirstParty.syncRegistry,
      {},
    );
    const decision = await t.query(
      internal.researchQuality.readResearchForEvidenceSync,
      { threadId: seeded.threadId },
    );
    if (decision.state !== "publish")
      throw new Error("Expected public research");
    const first = await t.mutation(
      internal.evidenceFirstParty.enqueueForumResearchThread,
      { threadId: seeded.threadId, reason: "content_changed" },
    );
    const second = await t.mutation(
      internal.evidenceFirstParty.enqueueForumResearchThread,
      { threadId: seeded.threadId, reason: "visibility_changed" },
    );
    const document = await t.run(
      async (ctx) =>
        (await ctx.db
          .query("evidenceDocuments")
          .withIndex("by_sourceId_and_externalKey", (q) =>
            q
              .eq("sourceId", registry.sourceId)
              .eq("externalKey", `forum-research:${seeded.threadId}`),
          )
          .unique())!,
    );
    // A dirty marker hides the old public projection before the worker runs.
    expect(
      await t.query(internal.evidence.getPublicDocument, {
        documentId: document._id,
      }),
    ).toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", seeded.parentCategoryId, {
        viewAccess: "members",
      });
    });
    await expect(
      t.mutation(internal.evidenceFirstParty.syncResearch, {
        research: decision.research,
        sourceId: registry.sourceId,
        projectId: registry.projectId,
        generation: first.generation,
        queueId: first.queueId,
      }),
    ).resolves.toEqual({ newVersions: 0, claims: 0 });
    await t.mutation(internal.evidenceFirstParty.syncResearch, {
      research: decision.research,
      sourceId: registry.sourceId,
      projectId: registry.projectId,
      generation: second.generation,
      queueId: second.queueId,
    });
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.get("evidenceDocuments", document._id))?.visibility,
      ),
    ).toBe("private");
    expect(
      await t.query(internal.evidence.searchPublic, {
        search: "stale-publication",
      }),
    ).toEqual([]);
    expect(
      await t.query(internal.evidence.listPublicClaimTimeline, {
        claimKey: `symbaiex-forum-research:${seeded.threadId}`,
      }),
    ).toEqual([]);
  });

  test("a delayed retract cannot hide a newer republication or acknowledge its work", async () => {
    const t = setup();
    const seeded = await seedApprovedResearch(t, { slug: "stale-retraction" });
    await t.action(sync, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const registry = await t.mutation(
      internal.evidenceFirstParty.syncRegistry,
      {},
    );
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", seeded.threadId, { status: "hidden" }),
    );
    const first = await t.mutation(
      internal.evidenceFirstParty.enqueueForumResearchThread,
      {
        threadId: seeded.threadId,
        reason: "visibility_changed",
      },
    );
    expect(
      (
        await t.query(internal.researchQuality.readResearchForEvidenceSync, {
          threadId: seeded.threadId,
        })
      ).state,
    ).toBe("retract");
    // Complete one retract, leaving a duplicate generation-one worker delayed.
    await t.mutation(internal.evidenceFirstParty.retractResearch, {
      threadId: seeded.threadId,
      sourceId: registry.sourceId,
      ...first,
    });
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", seeded.threadId, { status: "active" }),
    );
    const second = await t.mutation(
      internal.evidenceFirstParty.enqueueForumResearchThread,
      {
        threadId: seeded.threadId,
        reason: "published",
      },
    );
    expect(second.generation).toBe(first.generation + 1);
    const decision = await t.query(
      internal.researchQuality.readResearchForEvidenceSync,
      {
        threadId: seeded.threadId,
      },
    );
    if (decision.state !== "publish")
      throw new Error("Expected eligible research");
    await t.mutation(internal.evidenceFirstParty.syncResearch, {
      research: decision.research,
      sourceId: registry.sourceId,
      projectId: registry.projectId,
      ...second,
    });
    const readPublication = () =>
      t.run(async (ctx) => ({
        document: await ctx.db
          .query("evidenceDocuments")
          .withIndex("by_sourceId_and_externalKey", (q) =>
            q
              .eq("sourceId", registry.sourceId)
              .eq("externalKey", `forum-research:${seeded.threadId}`),
          )
          .unique(),
        checkpoint: await ctx.db
          .query("evidenceFirstPartyCheckpoints")
          .withIndex("by_externalKey", (q) =>
            q.eq("externalKey", `forum-research:${seeded.threadId}`),
          )
          .unique(),
        claims: await ctx.db.query("evidenceClaims").collect(),
        epoch: await ctx.db.query("evidencePublicationState").collect(),
      }));
    const published = await readPublication();
    expect(published.document?.visibility).toBe("public");
    expect(published.checkpoint?.exposure).toBe("public");
    // Both the outdated generation and a current-generation stale decision
    // must leave all publication state unchanged.
    for (const entry of [first, second]) {
      await expect(
        t.mutation(internal.evidenceFirstParty.retractResearch, {
          threadId: seeded.threadId,
          sourceId: registry.sourceId,
          ...entry,
        }),
      ).resolves.toEqual({ changed: false, claimsChanged: 0, skipped: true });
      expect(await readPublication()).toEqual(published);
    }
    await expect(
      t.mutation(internal.evidenceFirstParty.acknowledgeForumResearchSync, {
        threadId: seeded.threadId,
        ...first,
      }),
    ).resolves.toEqual({ acknowledged: false });
    expect(
      await t.run((ctx) =>
        ctx.db.get("evidenceFirstPartySyncQueue", second.queueId),
      ),
    ).not.toBeNull();
    await t.mutation(internal.evidenceFirstParty.acknowledgeForumResearchSync, {
      threadId: seeded.threadId,
      ...second,
    });
    expect(
      await t.query(internal.evidence.getPublicDocument, {
        documentId: published.document!._id,
      }),
    ).not.toBeNull();
  });

  test("queue row identity fences generation reuse after acknowledgement", async () => {
    const t = setup();
    const seeded = await seedApprovedResearch(t, {
      slug: "queue-generation-aba",
    });
    const registry = await t.mutation(
      internal.evidenceFirstParty.syncRegistry,
      {},
    );
    const oldEntry = await t.mutation(
      internal.evidenceFirstParty.enqueueForumResearchThread,
      {
        threadId: seeded.threadId,
        reason: "published",
      },
    );
    await t.mutation(internal.evidenceFirstParty.acknowledgeForumResearchSync, {
      threadId: seeded.threadId,
      ...oldEntry,
    });
    const newEntry = await t.mutation(
      internal.evidenceFirstParty.enqueueForumResearchThread,
      {
        threadId: seeded.threadId,
        reason: "content_changed",
      },
    );
    expect(oldEntry.generation).toBe(newEntry.generation);
    expect(oldEntry.queueId).not.toBe(newEntry.queueId);
    await expect(
      t.mutation(internal.evidenceFirstParty.acknowledgeForumResearchSync, {
        threadId: seeded.threadId,
        ...oldEntry,
      }),
    ).resolves.toEqual({ acknowledged: false });
    const decision = await t.query(
      internal.researchQuality.readResearchForEvidenceSync,
      { threadId: seeded.threadId },
    );
    if (decision.state !== "publish")
      throw new Error("Expected eligible research");
    await expect(
      t.mutation(internal.evidenceFirstParty.syncResearch, {
        research: decision.research,
        sourceId: registry.sourceId,
        projectId: registry.projectId,
        ...oldEntry,
      }),
    ).resolves.toEqual({ newVersions: 0, claims: 0 });
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", seeded.threadId, { status: "hidden" }),
    );
    await expect(
      t.mutation(internal.evidenceFirstParty.retractResearch, {
        threadId: seeded.threadId,
        sourceId: registry.sourceId,
        ...oldEntry,
      }),
    ).resolves.toEqual({ changed: false, claimsChanged: 0, skipped: true });
    expect(
      await t.run((ctx) =>
        ctx.db.get("evidenceFirstPartySyncQueue", newEntry.queueId),
      ),
    ).not.toBeNull();
  });

  test("publishes current content rather than an obsolete action snapshot", async () => {
    const t = setup();
    const seeded = await seedApprovedResearch(t, { slug: "stale-content" });
    const registry = await t.mutation(
      internal.evidenceFirstParty.syncRegistry,
      {},
    );
    const decision = await t.query(
      internal.researchQuality.readResearchForEvidenceSync,
      { threadId: seeded.threadId },
    );
    if (decision.state !== "publish")
      throw new Error("Expected public research");
    await t.run(async (ctx) => {
      await ctx.db.patch("forumThreads", seeded.threadId, {
        title: "Current authoritative title",
      });
    });
    await t.mutation(internal.evidenceFirstParty.syncResearch, {
      research: decision.research,
      sourceId: registry.sourceId,
      projectId: registry.projectId,
    });
    const document = await t.run(async (ctx) =>
      ctx.db
        .query("evidenceDocuments")
        .withIndex("by_sourceId_and_externalKey", (q) =>
          q
            .eq("sourceId", registry.sourceId)
            .eq("externalKey", `forum-research:${seeded.threadId}`),
        )
        .unique(),
    );
    expect(document?.title).toBe("Current authoritative title");
  });

  test("hides documents immediately and retracts more than 64 historical claims in bounded batches", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const seeded = await seedApprovedResearch(t, {
        slug: "many-historical-claims",
      });
      await t.action(sync, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const registry = await t.mutation(
        internal.evidenceFirstParty.syncRegistry,
        {},
      );
      const claimIds = await t.run(async (ctx) => {
        const ids = [];
        for (let index = 0; index < 150; index += 1)
          ids.push(
            await ctx.db.insert("evidenceClaims", {
              claimKey:
                `symbaiex-forum-claim:${seeded.threadId}:${String(index).padStart(3, "0")}`.toLowerCase(),
              statement: `Historical private assertion ${index}`,
              subjectEntityId: registry.projectId,
              predicate: "forum-research-assertion",
              objectText: "Historic",
              status: "supported",
              confidence: 1,
              visibility: "public",
              observedAt: seeded.now,
              createdAt: seeded.now,
              updatedAt: seeded.now,
            }),
          );
        await ctx.db.patch("forumCategories", seeded.parentCategoryId, {
          viewAccess: "members",
        });
        return ids;
      });
      const result = await t.mutation(
        internal.evidenceFirstParty.retractResearch,
        { threadId: seeded.threadId, sourceId: registry.sourceId },
      );
      expect(result.claimsChanged).toBe(65); // the publication claim plus one 64-row batch
      await t.run(async (ctx) => {
        const tail = await ctx.db.get("evidenceClaims", claimIds[149]!);
        expect(tail?.visibility).toBe("public"); // physical cleanup is intentionally bounded
        expect(await isPublicEvidenceClaim(ctx, tail)).toBe(false);
        const doc = await ctx.db
          .query("evidenceDocuments")
          .withIndex("by_sourceId_and_externalKey", (q) =>
            q
              .eq("sourceId", registry.sourceId)
              .eq("externalKey", `forum-research:${seeded.threadId}`),
          )
          .unique();
        expect(doc?.visibility).toBe("private");
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      await t.run(async (ctx) => {
        for (const id of claimIds)
          expect((await ctx.db.get("evidenceClaims", id))?.visibility).toBe(
            "private",
          );
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("fails closed for a public board beneath a private ancestor", async () => {
    const t = setup();
    const seeded = await seedApprovedResearch(t, {
      slug: "private-ancestor",
      parentAccess: "members",
    });
    await expect(
      t.query(internal.researchQuality.readResearchForEvidenceSync, {
        threadId: seeded.threadId,
      }),
    ).resolves.toEqual({
      state: "retract",
      threadId: seeded.threadId,
      reason: "category_not_public",
    });
    await t.action(sync, {});
    await t.run(async (ctx) => {
      const documents = await ctx.db.query("evidenceDocuments").collect();
      expect(
        documents.some(
          (document) =>
            document.externalKey === `forum-research:${seeded.threadId}`,
        ),
      ).toBe(false);
    });
  });

  test("legacy public categories remain public and paused sources fail closed", async () => {
    const t = setup();
    const seeded = await seedApprovedResearch(t, { slug: "legacy-public" });
    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", seeded.categoryId, {
        viewAccess: undefined,
      });
      await ctx.db.patch("forumCategories", seeded.parentCategoryId, {
        viewAccess: undefined,
      });
    });
    await t.action(sync, {});
    const document = await t.run(async (ctx) =>
      (await ctx.db.query("evidenceDocuments").collect()).find(
        (row) => row.externalKey === `forum-research:${seeded.threadId}`,
      )!,
    );
    expect(
      await t.query(internal.evidence.getPublicDocument, {
        documentId: document._id,
      }),
    ).not.toBeNull();
    expect(
      await t.query(internal.evidence.listPublicClaimTimeline, {
        claimKey: `symbaiex-forum-research:${seeded.threadId}`,
      }),
    ).not.toEqual([]);
    await t.run(async (ctx) => {
      await ctx.db.patch("evidenceSources", document.sourceId, {
        status: "paused",
      });
    });
    expect(
      await t.query(internal.evidence.getPublicDocument, {
        documentId: document._id,
      }),
    ).toBeNull();
    expect(
      await t.query(internal.evidence.listPublicClaimTimeline, {
        claimKey: `symbaiex-forum-research:${seeded.threadId}`,
      }),
    ).toEqual([]);
  });

  test("dirty forum processing leaves the static registry untouched", async () => {
    const t = setup();
    const seeded = await seedApprovedResearch(t, { slug: "forum-only-sync" });
    await t.action(sync, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const before = await t.run(async (ctx) => ({
      source: (await ctx.db.query("evidenceSources").collect())[0]!,
      checkpoints: (
        await ctx.db.query("evidenceFirstPartyCheckpoints").collect()
      ).filter((row) => !row.externalKey.startsWith("forum-research:")),
    }));
    vi.advanceTimersByTime(60_000);
    await t.run(async (ctx) => {
      await ctx.db.patch("forumThreads", seeded.threadId, {
        title: "Changed forum title",
      });
    });
    await t.mutation(internal.evidenceFirstParty.enqueueForumResearchThread, {
      threadId: seeded.threadId,
      reason: "content_changed",
    });
    const result = await t.action(
      internal.evidenceFirstParty.syncForumResearch,
      {},
    );
    expect(result.newVersions).toBe(1);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const after = await t.run(async (ctx) => ({
      source: (await ctx.db.query("evidenceSources").collect())[0]!,
      checkpoints: (
        await ctx.db.query("evidenceFirstPartyCheckpoints").collect()
      ).filter((row) => !row.externalKey.startsWith("forum-research:")),
    }));
    expect(after).toEqual(before);
  });

  test("retracts public evidence after ancestor or board visibility changes and can republish safely", async () => {
    const t = setup();
    const seeded = await seedApprovedResearch(t, { slug: "visibility-cycle" });
    await t.action(sync, {});
    const before = await t.run(async (ctx) => {
      const document = (await ctx.db.query("evidenceDocuments").collect()).find(
        (candidate) =>
          candidate.externalKey === `forum-research:${seeded.threadId}`,
      );
      return {
        document,
        versionCount: (await ctx.db.query("evidenceDocumentVersions").collect())
          .length,
      };
    });
    expect(before.document?.visibility).toBe("public");

    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", seeded.parentCategoryId, {
        viewAccess: "members",
      });
    });
    await t.mutation(
      internal.evidenceFirstParty.requestHistoricalReconciliation,
      {},
    );
    await t.action(sync, {});
    await t.run(async (ctx) => {
      const document = await ctx.db.get(
        "evidenceDocuments",
        before.document!._id,
      );
      expect(document?.visibility).toBe("private");
      expect(
        (await ctx.db.query("evidenceClaims").collect())
          .filter((claim) => claim.claimKey.includes(String(seeded.threadId)))
          .every((claim) => claim.visibility === "private"),
      ).toBe(true);
      expect(
        await ctx.db.query("evidenceDocumentVersions").collect(),
      ).toHaveLength(before.versionCount);
    });
    const publicChanges = await t.query(internal.evidence.listPublicChanges, {
      limit: 50,
    });
    expect(
      publicChanges.some((event) => event.summary.includes("visibility-cycle")),
    ).toBe(false);

    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", seeded.parentCategoryId, {
        viewAccess: "public",
      });
    });
    await t.mutation(internal.evidenceFirstParty.enqueueForumResearchThread, {
      threadId: seeded.threadId,
      reason: "visibility_changed",
    });
    await t.action(sync, {});
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.get("evidenceDocuments", before.document!._id))
          ?.visibility,
      ).toBe("public");
      expect(
        (await ctx.db.query("evidenceClaims").collect())
          .filter((claim) => claim.claimKey.includes(String(seeded.threadId)))
          .every((claim) => claim.visibility === "public"),
      ).toBe(true);
    });

    await t.run(async (ctx) => {
      const privateCategoryId = await ctx.db.insert("forumCategories", {
        slug: "private-destination",
        name: "Private destination",
        description: "Private",
        kind: "board",
        status: "active",
        viewAccess: "members",
        threadAccess: "members",
        replyAccess: "members",
        pollAccess: "members",
        position: 9,
        threadCount: 1,
        postCount: 1,
        createdAt: seeded.now,
        updatedAt: seeded.now,
      });
      await ctx.db.patch("forumThreads", seeded.threadId, {
        categoryId: privateCategoryId,
        categorySlug: "private-destination",
      });
    });
    await t.mutation(internal.evidenceFirstParty.enqueueForumResearchThread, {
      threadId: seeded.threadId,
      reason: "category_changed",
    });
    expect(
      await t.query(internal.researchQuality.readResearchForEvidenceSync, {
        threadId: seeded.threadId,
      }),
    ).toMatchObject({ state: "retract" });
    await t.action(sync, {});
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.get("evidenceDocuments", before.document!._id))
            ?.visibility,
      ),
    ).toBe("private");
  });

  test("continues historical reconciliation beyond one bounded page", async () => {
    const t = setup();
    const seed = await seedApprovedResearch(t, { slug: "history-00" });
    await t.run(async (ctx) => {
      for (let index = 1; index < 25; index += 1) {
        const slug = `history-${String(index).padStart(2, "0")}`;
        const threadId = await ctx.db.insert("forumThreads", {
          categoryId: seed.categoryId,
          categorySlug: "research-history-00",
          slug,
          title: `Research ${slug}`,
          body: `[h2]Method[/h2] Evidence ${slug}. [i]AI-assisted research.[/i]`,
          authorId: seed.agentId,
          status: "active",
          pinned: false,
          replyCount: 0,
          viewCount: 0,
          lastPostAt: seed.now + index,
          lastPostUserId: seed.agentId,
          searchText: slug,
          createdAt: seed.now + index,
          updatedAt: seed.now + index,
        });
        await ctx.db.insert("researchQualityAssessments", {
          threadId,
          categoryId: seed.categoryId,
          authorUserId: seed.agentId,
          runKey: `run:${slug}`,
          candidateTitle: `Research ${slug}`,
          candidateExcerpt: `Evidence ${slug}`,
          status: "passed",
          sourceCount: 1,
          uniqueSourceDomainCount: 1,
          claimEstimate: 1,
          citationCoverageScore: 100,
          originalityScore: 99,
          aiAuthorshipDisclosed: true,
          contentFingerprint: `fingerprint-${slug}`,
          normalizedTerms: ["research", slug],
          flags: [],
          evaluatedAt: seed.now + index,
          createdAt: seed.now + index,
          updatedAt: seed.now + index,
        });
      }
    });
    await t.action(sync, {});
    const registry = await t.mutation(
      internal.evidenceFirstParty.syncRegistry,
      {},
    );
    const continuation = makeFunctionReference<
      "action",
      {
        sourceId: typeof registry.sourceId;
        projectId: typeof registry.projectId;
      },
      { processed: number; newVersions: number; claims: number; more: boolean }
    >("evidenceFirstParty:continueForumResearchSync");
    for (let index = 0; index < 8; index += 1) {
      const result = await t.action(continuation, {
        sourceId: registry.sourceId,
        projectId: registry.projectId,
      });
      if (!result.more) break;
    }
    await t.run(async (ctx) => {
      const forumDocuments = (
        await ctx.db.query("evidenceDocuments").collect()
      ).filter((document) =>
        document.externalKey.startsWith("forum-research:"),
      );
      expect(forumDocuments).toHaveLength(25);
      expect(
        await ctx.db.query("evidenceFirstPartySyncQueue").collect(),
      ).toHaveLength(0);
      expect(
        (
          await ctx.db
            .query("evidenceFirstPartyReconciliationState")
            .withIndex("by_key", (q) =>
              q.eq("key", "first-party-forum-research-v1"),
            )
            .unique()
        )?.phase,
      ).toBe("complete");
    });
  });
});
