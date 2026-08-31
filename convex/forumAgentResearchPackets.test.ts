/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import {
  forumAgentDraftClaimHash,
  forumAgentDraftContentHash,
  forumAgentResearchPayloadHash,
} from "./forumAgentResearchPackets";
import { deterministicForumClaimHash } from "./forumAgentClaimProvenance";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

const runKey = "suki:2026-08-31:4";
const title = "A bounded private research reconstruction";
const body =
  "[b]Reconstruction[/b]\nThe source establishes a repeatable input, method, output, and verification boundary.";
const claimHashes = [
  deterministicForumClaimHash("The source establishes a repeatable input."),
  deterministicForumClaimHash("The result includes a verification boundary."),
];

async function seedPrivateDraft(
  t: ReturnType<typeof setup>,
  state: "publishable" | "held",
) {
  await t.mutation(internal.forumAgentResearchPackets.beginResearchPacket, {
    runKey,
    agentSlug: "suki",
    sources: [
      {
        sourceKey: "primary-source",
        sourceUrl: "https://example.com/primary",
        snapshotHash: forumAgentResearchPayloadHash([
          "primary-source",
          "snapshot-v1",
        ]),
        titleHash: deterministicForumClaimHash("Primary source"),
      },
    ],
  });
  await t.mutation(internal.forumAgentResearchPackets.recordDraftRevision, {
    runKey,
    agentSlug: "suki",
    revision: 0,
    title,
    body,
    claimHashes,
    qualityScore: state === "publishable" ? 91 : 52,
  });
  return await t.mutation(
    internal.forumAgentResearchPackets.recordPublicationDecision,
    {
      runKey,
      agentSlug: "suki",
      revision: 0,
      title,
      body,
      claimHashes,
      qualityScore: state === "publishable" ? 91 : 52,
      publishable: state === "publishable",
      reason:
        state === "publishable"
          ? "automated-quality-gates-passed"
          : "editorial-quality-gate",
    },
  );
}

describe("private forum research packets", () => {
  test("persists every bounded private stage and a hash-bound publishable draft", async () => {
    const t = setup();
    const proof = await seedPrivateDraft(t, "publishable");
    const stored = await t.run(async (ctx) => {
      const packet = await ctx.db
        .query("forumAgentResearchPackets")
        .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
        .unique();
      if (packet === null) throw new Error("Expected private packet");
      const [sources, stages, drafts, publicThreads, publicPosts] =
        await Promise.all([
          ctx.db
            .query("forumAgentResearchSources")
            .withIndex("by_runKey_and_sourceKey", (q) => q.eq("runKey", runKey))
            .collect(),
          ctx.db
            .query("forumAgentResearchStages")
            .withIndex("by_runKey_and_stage", (q) => q.eq("runKey", runKey))
            .collect(),
          ctx.db
            .query("forumAgentDraftRevisions")
            .withIndex("by_runKey_and_revision", (q) => q.eq("runKey", runKey))
            .collect(),
          ctx.db.query("forumThreads").take(1),
          ctx.db.query("forumPosts").take(1),
        ]);
      return { drafts, packet, publicPosts, publicThreads, sources, stages };
    });

    expect(stored.stages.map((stage) => stage.stage).sort()).toEqual(
      [
        "source_discovery",
        "entity_resolution",
        "claim_extraction",
        "contradiction_detection",
        "reconstruction",
        "quality_evaluation",
        "publication_decision",
      ].sort(),
    );
    expect(stored.packet).toMatchObject({
      state: "publishable",
      contentHash: forumAgentDraftContentHash(title, body),
      claimHash: forumAgentDraftClaimHash(claimHashes),
    });
    expect(stored.drafts).toEqual([
      expect.objectContaining({
        _id: proof.draftId,
        state: "publishable",
        contentHash: proof.contentHash,
        claimHash: proof.claimHash,
      }),
    ]);
    expect(stored.sources).toHaveLength(1);
    expect(stored.publicThreads).toEqual([]);
    expect(stored.publicPosts).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain("moderator note");
    expect(JSON.stringify(stored)).not.toContain("system prompt");
  });

  test("keeps held drafts private and rejects a mismatched decision hash", async () => {
    const t = setup();
    await seedPrivateDraft(t, "held");
    await expect(
      t.mutation(internal.forumAgentResearchPackets.recordPublicationDecision, {
        runKey,
        agentSlug: "suki",
        revision: 0,
        title,
        body: `${body}\nTampered after evaluation.`,
        claimHashes,
        qualityScore: 91,
        publishable: true,
        reason: "should-not-pass",
      }),
    ).rejects.toThrow(/does not match its draft/i);

    const stored = await t.run(async (ctx) => ({
      packet: await ctx.db
        .query("forumAgentResearchPackets")
        .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
        .unique(),
      drafts: await ctx.db
        .query("forumAgentDraftRevisions")
        .withIndex("by_runKey_and_revision", (q) => q.eq("runKey", runKey))
        .collect(),
      publicThreads: await ctx.db.query("forumThreads").take(1),
      publicPosts: await ctx.db.query("forumPosts").take(1),
    }));
    expect(stored.packet).toMatchObject({ state: "held" });
    expect(stored.drafts).toEqual([expect.objectContaining({ state: "held" })]);
    expect(stored.publicThreads).toEqual([]);
    expect(stored.publicPosts).toEqual([]);
  });
});
