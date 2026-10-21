import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { MAX_FORUM_AGENT_CLAIMS } from "../lib/forum-agent-claim-limits";
import { FORUM_THREAD_BODY_MAX_LENGTH } from "./forumLimits";

const MAX_RESEARCH_SOURCES = 12;
const MAX_DECISION_REASON_LENGTH = 240;
const FORUM_THREAD_TITLE_MAX_LENGTH = 160;

const sourceValidator = v.object({
  sourceKey: v.string(),
  sourceUrl: v.string(),
  snapshotHash: v.string(),
  titleHash: v.string(),
});

export type PrivateDraftProof = {
  draftId: Id<"forumAgentDraftRevisions">;
  contentHash: string;
  claimHash: string;
};

function exactResearchHash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of value) {
    const code = character.charCodeAt(0);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `fnv1a64-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export function forumAgentDraftContentHash(title: string, body: string) {
  return exactResearchHash(`${title}\u0000${body}`);
}

export function forumAgentDraftClaimHash(claimHashes: readonly string[]) {
  return exactResearchHash(claimHashes.join("\u0000"));
}

export function forumAgentResearchPayloadHash(parts: readonly string[]) {
  return exactResearchHash(parts.join("\u0000"));
}

function boundedText(value: string, maximumLength: number, label: string) {
  const normalized = value.replace(/\u0000/g, "").trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new Error(`${label} exceeds its private research bound`);
  }
  return normalized;
}

function boundedHash(value: string, label: string) {
  if (!/^fnv1a64-[0-9a-f]{16}$/.test(value)) {
    throw new Error(`${label} is not a valid bounded research hash`);
  }
  return value;
}

function validateClaimHashes(
  claimHashes: string[],
  requirePublishable: boolean,
) {
  if (
    claimHashes.length > MAX_FORUM_AGENT_CLAIMS ||
    (requirePublishable && claimHashes.length < 1)
  ) {
    throw new Error("Private research claim ledger is outside its bound");
  }
  for (const hash of claimHashes) boundedHash(hash, "Claim hash");
}

async function stageUpsert(
  ctx: MutationCtx,
  args: {
    packetId: Id<"forumAgentResearchPackets">;
    runKey: string;
    stage:
      | "source_discovery"
      | "entity_resolution"
      | "claim_extraction"
      | "contradiction_detection"
      | "reconstruction"
      | "quality_evaluation"
      | "publication_decision";
    state: "started" | "completed" | "held" | "failed";
    payloadHash: string;
    itemCount?: number;
    score?: number;
    now: number;
  },
) {
  boundedHash(args.payloadHash, "Stage payload hash");
  const existing = await ctx.db
    .query("forumAgentResearchStages")
    .withIndex("by_packetId_and_stage", (q) =>
      q.eq("packetId", args.packetId).eq("stage", args.stage),
    )
    .unique();
  const values = {
    state: args.state,
    payloadHash: args.payloadHash,
    itemCount: args.itemCount,
    score: args.score,
    updatedAt: args.now,
  };
  if (existing === null) {
    await ctx.db.insert("forumAgentResearchStages", {
      packetId: args.packetId,
      runKey: args.runKey,
      stage: args.stage,
      ...values,
      createdAt: args.now,
    });
  } else {
    await ctx.db.patch("forumAgentResearchStages", existing._id, values);
  }
}

export const beginResearchPacket = internalMutation({
  args: {
    runKey: v.string(),
    agentSlug: v.string(),
    sources: v.array(sourceValidator),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ packetId: Id<"forumAgentResearchPackets"> }> => {
    const runKey = boundedText(args.runKey, 180, "Research run key");
    const agentSlug = boundedText(args.agentSlug, 80, "Research agent slug");
    if (args.sources.length < 1 || args.sources.length > MAX_RESEARCH_SOURCES) {
      throw new Error("Private research source packet is outside its bound");
    }
    const sourceKeys = new Set<string>();
    for (const source of args.sources) {
      boundedText(source.sourceKey, 240, "Research source key");
      boundedText(source.sourceUrl, 1_000, "Research source URL");
      boundedHash(source.snapshotHash, "Research snapshot hash");
      boundedHash(source.titleHash, "Research title hash");
      if (sourceKeys.has(source.sourceKey)) {
        throw new Error("Private research source keys must be unique");
      }
      sourceKeys.add(source.sourceKey);
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("forumAgentResearchPackets")
      .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
      .unique();
    if (existing !== null && existing.agentSlug !== agentSlug) {
      throw new Error("Private research packet agent does not match its run");
    }
    const packetId =
      existing?._id ??
      (await ctx.db.insert("forumAgentResearchPackets", {
        runKey,
        agentSlug,
        state: "researching",
        currentStage: "source_discovery",
        sourceCount: args.sources.length,
        createdAt: now,
        updatedAt: now,
      }));
    if (existing !== null) {
      await ctx.db.patch("forumAgentResearchPackets", packetId, {
        state: "researching",
        currentStage: "source_discovery",
        sourceCount: args.sources.length,
        updatedAt: now,
        completedAt: undefined,
      });
    }

    for (const source of args.sources) {
      const stored = await ctx.db
        .query("forumAgentResearchSources")
        .withIndex("by_packetId_and_sourceKey", (q) =>
          q.eq("packetId", packetId).eq("sourceKey", source.sourceKey),
        )
        .unique();
      const values = {
        sourceUrl: source.sourceUrl,
        snapshotHash: source.snapshotHash,
        titleHash: source.titleHash,
        state: "verified" as const,
        updatedAt: now,
      };
      if (stored === null) {
        await ctx.db.insert("forumAgentResearchSources", {
          packetId,
          runKey,
          sourceKey: source.sourceKey,
          ...values,
          createdAt: now,
        });
      } else {
        await ctx.db.patch("forumAgentResearchSources", stored._id, values);
      }
    }
    const sourcePayloadHash = forumAgentResearchPayloadHash(
      args.sources.flatMap((source) => [
        source.sourceKey,
        source.snapshotHash,
        source.titleHash,
      ]),
    );
    await stageUpsert(ctx, {
      packetId,
      runKey,
      stage: "source_discovery",
      state: "completed",
      payloadHash: sourcePayloadHash,
      itemCount: args.sources.length,
      now,
    });
    await stageUpsert(ctx, {
      packetId,
      runKey,
      stage: "entity_resolution",
      state: "completed",
      payloadHash: forumAgentResearchPayloadHash([
        sourcePayloadHash,
        ...args.sources.map((source) => source.sourceUrl),
      ]),
      itemCount: args.sources.length,
      now,
    });
    return { packetId };
  },
});

export const recordDraftRevision = internalMutation({
  args: {
    runKey: v.string(),
    agentSlug: v.string(),
    revision: v.number(),
    title: v.string(),
    body: v.string(),
    claimHashes: v.array(v.string()),
    qualityScore: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PrivateDraftProof> => {
    const title = boundedText(
      args.title,
      FORUM_THREAD_TITLE_MAX_LENGTH,
      "Private draft title",
    );
    const body = boundedText(
      args.body,
      FORUM_THREAD_BODY_MAX_LENGTH,
      "Private draft body",
    );
    if (
      !Number.isInteger(args.revision) ||
      args.revision < 0 ||
      args.revision > 8
    ) {
      throw new Error("Private draft revision is outside its bound");
    }
    validateClaimHashes(args.claimHashes, false);
    const packet = await ctx.db
      .query("forumAgentResearchPackets")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (packet === null || packet.agentSlug !== args.agentSlug) {
      throw new Error("Private research packet is unavailable for this draft");
    }
    const contentHash = forumAgentDraftContentHash(title, body);
    const claimHash = forumAgentDraftClaimHash(args.claimHashes);
    const now = Date.now();
    const existing = await ctx.db
      .query("forumAgentDraftRevisions")
      .withIndex("by_packetId_and_revision", (q) =>
        q.eq("packetId", packet._id).eq("revision", args.revision),
      )
      .unique();
    const values = {
      state: "drafting" as const,
      title,
      body,
      contentHash,
      claimHash,
      claimCount: args.claimHashes.length,
      qualityScore: args.qualityScore,
      decisionReason: undefined,
      updatedAt: now,
      completedAt: undefined,
    };
    const draftId =
      existing?._id ??
      (await ctx.db.insert("forumAgentDraftRevisions", {
        packetId: packet._id,
        runKey: packet.runKey,
        agentSlug: packet.agentSlug,
        revision: args.revision,
        ...values,
        createdAt: now,
      }));
    if (existing !== null) {
      await ctx.db.patch("forumAgentDraftRevisions", draftId, values);
    }
    await ctx.db.patch("forumAgentResearchPackets", packet._id, {
      state: "drafting",
      currentStage: "reconstruction",
      latestRevision: args.revision,
      contentHash,
      claimHash,
      updatedAt: now,
    });
    const claimPayloadHash = forumAgentResearchPayloadHash([
      claimHash,
      String(args.claimHashes.length),
    ]);
    await stageUpsert(ctx, {
      packetId: packet._id,
      runKey: packet.runKey,
      stage: "claim_extraction",
      state: "completed",
      payloadHash: claimPayloadHash,
      itemCount: args.claimHashes.length,
      now,
    });
    await stageUpsert(ctx, {
      packetId: packet._id,
      runKey: packet.runKey,
      stage: "contradiction_detection",
      state: "completed",
      payloadHash: forumAgentResearchPayloadHash([
        claimPayloadHash,
        String(args.revision),
      ]),
      itemCount: args.claimHashes.length,
      now,
    });
    await stageUpsert(ctx, {
      packetId: packet._id,
      runKey: packet.runKey,
      stage: "reconstruction",
      state: "completed",
      payloadHash: contentHash,
      itemCount: 1,
      now,
    });
    return { draftId, contentHash, claimHash };
  },
});

export const recordPublicationDecision = internalMutation({
  args: {
    runKey: v.string(),
    agentSlug: v.string(),
    revision: v.number(),
    title: v.string(),
    body: v.string(),
    claimHashes: v.array(v.string()),
    qualityScore: v.number(),
    publishable: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, args): Promise<PrivateDraftProof> => {
    validateClaimHashes(args.claimHashes, args.publishable);
    if (
      !Number.isFinite(args.qualityScore) ||
      args.qualityScore < 0 ||
      args.qualityScore > 100
    ) {
      throw new Error("Private draft quality score is outside its bound");
    }
    const reason = boundedText(
      args.reason,
      MAX_DECISION_REASON_LENGTH,
      "Publication decision reason",
    );
    const packet = await ctx.db
      .query("forumAgentResearchPackets")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    const draft =
      packet === null
        ? null
        : await ctx.db
            .query("forumAgentDraftRevisions")
            .withIndex("by_packetId_and_revision", (q) =>
              q.eq("packetId", packet._id).eq("revision", args.revision),
            )
            .unique();
    const contentHash = forumAgentDraftContentHash(
      args.title.trim(),
      args.body.trim(),
    );
    const claimHash = forumAgentDraftClaimHash(args.claimHashes);
    if (
      packet === null ||
      packet.agentSlug !== args.agentSlug ||
      draft === null ||
      draft.contentHash !== contentHash ||
      draft.claimHash !== claimHash
    ) {
      throw new Error("Private publication decision does not match its draft");
    }
    const now = Date.now();
    const state = args.publishable
      ? ("publishable" as const)
      : ("held" as const);
    await ctx.db.patch("forumAgentDraftRevisions", draft._id, {
      state,
      qualityScore: Math.round(args.qualityScore),
      decisionReason: reason,
      completedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("forumAgentResearchPackets", packet._id, {
      state,
      currentStage: "publication_decision",
      latestRevision: draft.revision,
      contentHash,
      claimHash,
      decisionReason: reason,
      completedAt: now,
      updatedAt: now,
    });
    await stageUpsert(ctx, {
      packetId: packet._id,
      runKey: packet.runKey,
      stage: "quality_evaluation",
      state: "completed",
      payloadHash: forumAgentResearchPayloadHash([
        contentHash,
        String(Math.round(args.qualityScore)),
      ]),
      score: Math.round(args.qualityScore),
      now,
    });
    await stageUpsert(ctx, {
      packetId: packet._id,
      runKey: packet.runKey,
      stage: "publication_decision",
      state: args.publishable ? "completed" : "held",
      payloadHash: forumAgentResearchPayloadHash([
        contentHash,
        claimHash,
        args.publishable ? "publishable" : "held",
      ]),
      itemCount: args.claimHashes.length,
      score: Math.round(args.qualityScore),
      now,
    });
    return { draftId: draft._id, contentHash, claimHash };
  },
});

export const markResearchPacketTerminated = internalMutation({
  args: {
    runKey: v.string(),
    agentSlug: v.string(),
    state: v.union(
      v.literal("held"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const packet = await ctx.db
      .query("forumAgentResearchPackets")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (
      packet === null ||
      packet.agentSlug !== args.agentSlug ||
      packet.state === "published"
    ) {
      return { updated: false };
    }
    const now = Date.now();
    const reason = boundedText(
      args.reason,
      MAX_DECISION_REASON_LENGTH,
      "Terminal research reason",
    );
    if (packet.latestRevision !== undefined) {
      const draft = await ctx.db
        .query("forumAgentDraftRevisions")
        .withIndex("by_packetId_and_revision", (q) =>
          q.eq("packetId", packet._id).eq("revision", packet.latestRevision!),
        )
        .unique();
      if (draft !== null && draft.state !== "published") {
        await ctx.db.patch("forumAgentDraftRevisions", draft._id, {
          state: "held",
          decisionReason: reason,
          completedAt: now,
          updatedAt: now,
        });
      }
    }
    await ctx.db.patch("forumAgentResearchPackets", packet._id, {
      state: args.state,
      currentStage: "publication_decision",
      decisionReason: reason,
      completedAt: now,
      updatedAt: now,
    });
    await stageUpsert(ctx, {
      packetId: packet._id,
      runKey: packet.runKey,
      stage: "publication_decision",
      state: args.state === "failed" ? "failed" : "held",
      payloadHash: forumAgentResearchPayloadHash([
        packet.contentHash ?? "no-content",
        packet.claimHash ?? "no-claims",
        args.state,
      ]),
      now,
    });
    return { updated: true };
  },
});

export async function verifyPrivateForumAgentDraft(
  ctx: MutationCtx,
  args: {
    runKey: string;
    agentSlug: string;
    title: string;
    body: string;
    claimHashes: string[];
  },
) {
  validateClaimHashes(args.claimHashes, true);
  const packet = await ctx.db
    .query("forumAgentResearchPackets")
    .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
    .unique();
  if (
    packet === null ||
    packet.agentSlug !== args.agentSlug ||
    packet.state !== "publishable" ||
    packet.latestRevision === undefined
  ) {
    throw new Error("Forum publication requires a publishable private draft");
  }
  const draft = await ctx.db
    .query("forumAgentDraftRevisions")
    .withIndex("by_packetId_and_revision", (q) =>
      q.eq("packetId", packet._id).eq("revision", packet.latestRevision!),
    )
    .unique();
  const contentHash = forumAgentDraftContentHash(
    args.title.trim(),
    args.body.trim(),
  );
  const claimHash = forumAgentDraftClaimHash(args.claimHashes);
  if (
    draft === null ||
    draft.state !== "publishable" ||
    draft.contentHash !== contentHash ||
    draft.claimHash !== claimHash ||
    packet.contentHash !== contentHash ||
    packet.claimHash !== claimHash
  ) {
    throw new Error("Forum publication does not match its private draft proof");
  }
  return { packet, draft };
}

export async function markPrivateForumAgentDraftHeld(
  ctx: MutationCtx,
  draftId: Id<"forumAgentDraftRevisions">,
  reason: string,
) {
  const draft = await ctx.db.get("forumAgentDraftRevisions", draftId);
  if (draft === null) return;
  const packet = await ctx.db.get("forumAgentResearchPackets", draft.packetId);
  if (packet === null) return;
  const now = Date.now();
  const boundedReason = boundedText(
    reason,
    MAX_DECISION_REASON_LENGTH,
    "Held decision reason",
  );
  await ctx.db.patch("forumAgentDraftRevisions", draft._id, {
    state: "held",
    decisionReason: boundedReason,
    completedAt: now,
    updatedAt: now,
  });
  await ctx.db.patch("forumAgentResearchPackets", packet._id, {
    state: "held",
    currentStage: "publication_decision",
    decisionReason: boundedReason,
    completedAt: now,
    updatedAt: now,
  });
  await stageUpsert(ctx, {
    packetId: packet._id,
    runKey: packet.runKey,
    stage: "publication_decision",
    state: "held",
    payloadHash: forumAgentResearchPayloadHash([
      draft.contentHash,
      draft.claimHash,
      "held",
    ]),
    itemCount: draft.claimCount,
    score: draft.qualityScore,
    now,
  });
}

export async function markPrivateForumAgentDraftPublished(
  ctx: MutationCtx,
  draftId: Id<"forumAgentDraftRevisions">,
) {
  const draft = await ctx.db.get("forumAgentDraftRevisions", draftId);
  if (draft === null || draft.state !== "publishable") {
    throw new Error("Private forum draft is not publishable");
  }
  const packet = await ctx.db.get("forumAgentResearchPackets", draft.packetId);
  if (packet === null || packet.state !== "publishable") {
    throw new Error("Private forum research packet is not publishable");
  }
  const now = Date.now();
  await ctx.db.patch("forumAgentDraftRevisions", draft._id, {
    state: "published",
    completedAt: now,
    updatedAt: now,
  });
  await ctx.db.patch("forumAgentResearchPackets", packet._id, {
    state: "published",
    completedAt: now,
    updatedAt: now,
  });
}
