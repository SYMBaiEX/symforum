import { RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { commerceActor, publicCommerceThread } from "./forumCommerceAccess";
import { isSolanaAddress, publicReference } from "../lib/forum-commerce";
import {
  communityAmount,
  communityHttpsUrl,
  communityPaymentUrl,
  communityText,
  COMMUNITY_PAYMENT_TTL_MS,
  COMMUNITY_SUPPORTER_TTL_MS,
} from "../lib/forum-community";
import {
  communityPaymentStatus,
  communityWorkKind,
  communityWorkStatus,
} from "./forumCommunitySchema";

const writes = new RateLimiter(components.rateLimiter, {
  communityWrite: {
    kind: "token bucket",
    rate: 20,
    period: 3_600_000,
    capacity: 6,
  },
});
const nullableString = v.union(v.string(), v.null());
const projectView = v.object({
  projectId: v.id("forumCommunityProjects"),
  mint: v.string(),
  name: v.string(),
  symbol: v.string(),
  claims: v.array(
    v.object({
      userId: v.id("users"),
      username: v.string(),
      role: v.string(),
      description: v.string(),
      website: nullableString,
      updatedAt: v.number(),
    }),
  ),
});
const workView = v.object({
  workId: v.id("forumCommunityWork"),
  sponsorId: v.id("users"),
  sponsor: v.string(),
  mint: nullableString,
  kind: communityWorkKind,
  title: v.string(),
  brief: v.string(),
  amountLamports: v.string(),
  status: communityWorkStatus,
  selectedSubmissionId: v.union(v.id("forumCommunitySubmissions"), v.null()),
  updatedAt: v.number(),
});
export const paymentView = v.object({
  intentId: v.id("forumCommunityPayments"),
  wallet: v.string(),
  recipient: v.string(),
  amountLamports: v.string(),
  purpose: v.union(v.literal("tip"), v.literal("reward")),
  reference: v.string(),
  memo: v.string(),
  createdAt: v.number(),
  expiresAt: v.number(),
  status: communityPaymentStatus,
  signature: nullableString,
  issue: nullableString,
  finalizedAt: v.union(v.number(), v.null()),
  workId: v.union(v.id("forumCommunityWork"), v.null()),
});
const supporterView = v.object({
  optedIn: v.boolean(),
  eligible: v.boolean(),
  checkedAt: v.number(),
  expiresAt: v.number(),
  proofSlot: v.union(v.number(), v.null()),
});
function safeError(error: unknown): never {
  throw new ConvexError(
    error instanceof Error ? error.message : "Check the supplied details.",
  );
}
function checkedMint(mint: string | undefined) {
  if (mint !== undefined && !isSolanaAddress(mint))
    throw new ConvexError("Use the exact Solana mint address.");
  return mint;
}
async function writeActor(ctx: MutationCtx, wallet?: string) {
  const actor = await commerceActor(ctx, wallet);
  const gate = await writes.limit(ctx, "communityWrite", {
    key: actor.authUserId,
  });
  if (!gate.ok)
    throw new ConvexError("Community changes are rate limited. Try later.");
  return actor;
}
async function name(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  return user?.username ?? "Forum member";
}
function publicPayment(row: Doc<"forumCommunityPayments">) {
  return {
    intentId: row._id,
    wallet: row.wallet,
    recipient: row.recipient,
    amountLamports: row.amountLamports,
    purpose: row.purpose,
    reference: row.reference,
    memo: row.memo,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    status: row.status,
    signature: row.signature ?? null,
    issue: row.issue ?? null,
    finalizedAt: row.finalizedAt ?? null,
    workId: row.workId ?? null,
  };
}
async function ownedPayment(
  ctx: QueryCtx | MutationCtx,
  intentId: Id<"forumCommunityPayments">,
) {
  const actor = await commerceActor(ctx),
    row = await ctx.db.get("forumCommunityPayments", intentId);
  if (
    !row ||
    row.payerId !== actor.userId ||
    row.authUserId !== actor.authUserId
  )
    throw new ConvexError("Payment not found.");
  await commerceActor(ctx, row.wallet);
  return row;
}

export const listProjects = query({
  args: { mint: v.optional(v.string()) },
  returns: v.array(projectView),
  handler: async (ctx, { mint }) => {
    checkedMint(mint);
    const rows = mint
      ? await ctx.db
          .query("forumCommunityProjects")
          .withIndex("by_mint", (q) => q.eq("mint", mint))
          .take(1)
      : await ctx.db
          .query("forumCommunityProjects")
          .withIndex("by_updatedAt")
          .order("desc")
          .take(24);
    return await Promise.all(
      rows.map(async (project) => {
        const claims = await ctx.db
          .query("forumCommunityProjectClaims")
          .withIndex("by_projectId_and_userId", (q) =>
            q.eq("projectId", project._id),
          )
          .take(12);
        return {
          projectId: project._id,
          mint: project.mint,
          name: project.name,
          symbol: project.symbol,
          claims: await Promise.all(
            claims.map(async (claim) => ({
              userId: claim.userId,
              username: await name(ctx, claim.userId),
              role: claim.role,
              description: claim.description,
              website: claim.website,
              updatedAt: claim.updatedAt,
            })),
          ),
        };
      }),
    );
  },
});
export const createProjectClaim = mutation({
  args: {
    wallet: v.string(),
    mint: v.string(),
    role: v.string(),
    description: v.string(),
    website: v.optional(v.string()),
  },
  returns: v.id("forumCommunityProjects"),
  handler: async (ctx, args) => {
    const actor = await writeActor(ctx, args.wallet);
    checkedMint(args.mint);
    const token = await ctx.db
      .query("forumVerifiedMints")
      .withIndex("by_mint", (q) => q.eq("mint", args.mint))
      .unique();
    const listed = await ctx.db
      .query("forumTradeTokens")
      .withIndex("by_mint", (q) => q.eq("mint", args.mint))
      .unique();
    if (listed?.status === "blocked")
      throw new ConvexError("This mint is not eligible for a project hub.");
    if (!token || token.expiresAt <= Date.now())
      throw new ConvexError(
        "Verify this mint using the token picker before creating a project hub.",
      );
    let role: string, description: string, website: string | null;
    try {
      role = communityText(args.role, 60);
      description = communityText(args.description, 2000, 20);
      website = args.website ? communityHttpsUrl(args.website) : null;
    } catch (error) {
      safeError(error);
    }
    const now = Date.now(),
      project = await ctx.db
        .query("forumCommunityProjects")
        .withIndex("by_mint", (q) => q.eq("mint", args.mint))
        .unique();
    const projectId =
      project?._id ??
      (await ctx.db.insert("forumCommunityProjects", {
        mint: args.mint,
        name: token.name || "Token project",
        symbol: token.symbol || args.mint.slice(0, 6),
        createdAt: now,
        updatedAt: now,
      }));
    const prior = await ctx.db
      .query("forumCommunityProjectClaims")
      .withIndex("by_projectId_and_userId", (q) =>
        q.eq("projectId", projectId).eq("userId", actor.userId),
      )
      .unique();
    const fields = {
      projectId,
      userId: actor.userId,
      wallet: args.wallet,
      role,
      description,
      website,
      updatedAt: now,
    };
    if (prior)
      await ctx.db.patch("forumCommunityProjectClaims", prior._id, fields);
    else await ctx.db.insert("forumCommunityProjectClaims", fields);
    await ctx.db.patch("forumCommunityProjects", projectId, { updatedAt: now });
    return projectId;
  },
});

export const getMine = query({
  args: { now: v.number() },
  returns: v.object({
    userId: v.id("users"),
    recipient: v.union(
      v.object({ wallet: v.string(), accepting: v.boolean() }),
      v.null(),
    ),
    supporter: v.union(supporterView, v.null()),
  }),
  handler: async (ctx, { now }) => {
    if (!Number.isFinite(now)) throw new ConvexError("Invalid time.");
    const actor = await commerceActor(ctx),
      recipient = await ctx.db
        .query("forumCommunityRecipients")
        .withIndex("by_userId", (q) => q.eq("userId", actor.userId))
        .unique(),
      proof = await ctx.db
        .query("forumCommunitySupporters")
        .withIndex("by_userId", (q) => q.eq("userId", actor.userId))
        .unique();
    return {
      userId: actor.userId,
      recipient: recipient
        ? { wallet: recipient.wallet, accepting: recipient.accepting }
        : null,
      supporter: proof
        ? {
            optedIn: proof.optedIn,
            eligible: proof.eligible && proof.expiresAt > now,
            checkedAt: proof.checkedAt,
            expiresAt: proof.expiresAt,
            proofSlot: proof.proofSlot,
          }
        : null,
    };
  },
});
export const setTipRecipient = mutation({
  args: { wallet: v.string(), accepting: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await writeActor(ctx, args.wallet),
      old = await ctx.db
        .query("forumCommunityRecipients")
        .withIndex("by_userId", (q) => q.eq("userId", actor.userId))
        .unique(),
      fields = {
        userId: actor.userId,
        wallet: args.wallet,
        accepting: args.accepting,
        updatedAt: Date.now(),
      };
    if (old) await ctx.db.patch("forumCommunityRecipients", old._id, fields);
    else await ctx.db.insert("forumCommunityRecipients", fields);
    return null;
  },
});
export const listTipRecipients = query({
  args: {},
  returns: v.array(
    v.object({
      userId: v.id("users"),
      username: v.string(),
      wallet: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("forumCommunityRecipients")
      .withIndex("by_accepting_and_updatedAt", (q) => q.eq("accepting", true))
      .order("desc")
      .take(24);
    return await Promise.all(
      rows.map(async (row) => ({
        userId: row.userId,
        username: await name(ctx, row.userId),
        wallet: row.wallet,
      })),
    );
  },
});
export const getThreadRecipient = query({
  args: { threadId: v.id("forumThreads") },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      username: v.string(),
      wallet: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { threadId }) => {
    const thread = await publicCommerceThread(ctx, threadId);
    if (!thread) return null;
    const row = await ctx.db
      .query("forumCommunityRecipients")
      .withIndex("by_userId", (q) => q.eq("userId", thread.authorId))
      .unique();
    return row?.accepting
      ? {
          userId: row.userId,
          username: await name(ctx, row.userId),
          wallet: row.wallet,
        }
      : null;
  },
});
export const listBounties = query({
  args: {
    mint: v.optional(v.string()),
    status: v.optional(communityWorkStatus),
  },
  returns: v.array(workView),
  handler: async (ctx, { mint, status }) => {
    checkedMint(mint);
    const rows =
      mint && status
        ? await ctx.db
            .query("forumCommunityWork")
            .withIndex("by_mint_and_status_and_updatedAt", (q) =>
              q.eq("mint", mint).eq("status", status),
            )
            .order("desc")
            .take(32)
        : mint
          ? await ctx.db
              .query("forumCommunityWork")
              .withIndex("by_mint_and_updatedAt", (q) => q.eq("mint", mint))
              .order("desc")
              .take(32)
          : await ctx.db
              .query("forumCommunityWork")
              .withIndex("by_status_and_updatedAt", (q) =>
                q.eq("status", status ?? "open"),
              )
              .order("desc")
              .take(32);
    return await Promise.all(
      rows
        .filter((row) => !status || row.status === status)
        .map(async (row) => ({
          workId: row._id,
          sponsorId: row.sponsorId,
          sponsor: await name(ctx, row.sponsorId),
          mint: row.mint,
          kind: row.kind,
          title: row.title,
          brief: row.brief,
          amountLamports: row.amountLamports,
          status: row.status,
          selectedSubmissionId: row.selectedSubmissionId ?? null,
          updatedAt: row.updatedAt,
        })),
    );
  },
});
export const createBounty = mutation({
  args: {
    kind: communityWorkKind,
    mint: v.optional(v.string()),
    title: v.string(),
    brief: v.string(),
    amountLamports: v.string(),
  },
  returns: v.id("forumCommunityWork"),
  handler: async (ctx, args) => {
    const actor = await writeActor(ctx);
    checkedMint(args.mint);
    try {
      const now = Date.now();
      return await ctx.db.insert("forumCommunityWork", {
        sponsorId: actor.userId,
        mint: args.mint ?? null,
        kind: args.kind,
        title: communityText(args.title, 120, 8),
        brief: communityText(args.brief, 5000, 40),
        amountLamports: communityAmount(args.amountLamports),
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      safeError(error);
    }
  },
});
export const cancelBounty = mutation({
  args: { workId: v.id("forumCommunityWork") },
  returns: v.null(),
  handler: async (ctx, { workId }) => {
    const actor = await writeActor(ctx),
      row = await ctx.db.get("forumCommunityWork", workId);
    if (
      !row ||
      row.sponsorId !== actor.userId ||
      !["open", "selected"].includes(row.status)
    )
      throw new ConvexError("Only the sponsor can cancel an open pledge.");
    const payments = await ctx.db
      .query("forumCommunityPayments")
      .withIndex("by_workId", (q) => q.eq("workId", workId))
      .take(8);
    if (
      payments.length === 8 ||
      payments.some((payment) => !["ready", "expired"].includes(payment.status))
    )
      throw new ConvexError(
        "A payment may be in progress. Keep the selected pledge and verify its existing receipt.",
      );
    for (const payment of payments)
      if (payment.status === "ready")
        await ctx.db.patch("forumCommunityPayments", payment._id, {
          status: "expired",
        });
    await ctx.db.patch("forumCommunityWork", workId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const claimBounty = mutation({
  args: {
    workId: v.id("forumCommunityWork"),
    url: v.string(),
    summary: v.string(),
  },
  returns: v.id("forumCommunitySubmissions"),
  handler: async (ctx, args) => {
    const actor = await writeActor(ctx),
      work = await ctx.db.get("forumCommunityWork", args.workId);
    if (!work || work.status !== "open" || work.sponsorId === actor.userId)
      throw new ConvexError("This pledge is not accepting your submission.");
    const prior = await ctx.db
      .query("forumCommunitySubmissions")
      .withIndex("by_workId_and_authorId", (q) =>
        q.eq("workId", args.workId).eq("authorId", actor.userId),
      )
      .unique();
    try {
      const fields = {
        workId: args.workId,
        authorId: actor.userId,
        url: communityHttpsUrl(args.url),
        summary: communityText(args.summary, 2000, 20),
        submittedAt: Date.now(),
      };
      if (prior) {
        await ctx.db.patch("forumCommunitySubmissions", prior._id, fields);
        return prior._id;
      }
      return await ctx.db.insert("forumCommunitySubmissions", fields);
    } catch (error) {
      safeError(error);
    }
  },
});
export const listSubmissions = query({
  args: { workId: v.id("forumCommunityWork") },
  returns: v.array(
    v.object({
      submissionId: v.id("forumCommunitySubmissions"),
      authorId: v.id("users"),
      username: v.string(),
      url: v.string(),
      summary: v.string(),
      submittedAt: v.number(),
    }),
  ),
  handler: async (ctx, { workId }) => {
    const actor = await commerceActor(ctx),
      work = await ctx.db.get("forumCommunityWork", workId);
    if (!work) return [];
    const rows =
      work.sponsorId === actor.userId
        ? await ctx.db
            .query("forumCommunitySubmissions")
            .withIndex("by_workId_and_submittedAt", (q) =>
              q.eq("workId", workId),
            )
            .order("desc")
            .take(50)
        : await ctx.db
            .query("forumCommunitySubmissions")
            .withIndex("by_workId_and_authorId", (q) =>
              q.eq("workId", workId).eq("authorId", actor.userId),
            )
            .take(1);
    return await Promise.all(
      rows.map(async (row) => ({
        submissionId: row._id,
        authorId: row.authorId,
        username: await name(ctx, row.authorId),
        url: row.url,
        summary: row.summary,
        submittedAt: row.submittedAt,
      })),
    );
  },
});
export const selectSubmission = mutation({
  args: {
    workId: v.id("forumCommunityWork"),
    submissionId: v.id("forumCommunitySubmissions"),
  },
  returns: v.null(),
  handler: async (ctx, { workId, submissionId }) => {
    const actor = await writeActor(ctx),
      work = await ctx.db.get("forumCommunityWork", workId),
      submission = await ctx.db.get("forumCommunitySubmissions", submissionId);
    if (
      !work ||
      work.status !== "open" ||
      work.sponsorId !== actor.userId ||
      !submission ||
      submission.workId !== workId ||
      submission.authorId === actor.userId
    )
      throw new ConvexError(
        "Only the sponsor can select a valid submission for this pledge.",
      );
    await ctx.db.patch("forumCommunityWork", workId, {
      selectedSubmissionId: submissionId,
      status: "selected",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const preparePayment = mutation({
  args: {
    wallet: v.string(),
    recipientId: v.optional(v.id("users")),
    threadId: v.optional(v.id("forumThreads")),
    workId: v.optional(v.id("forumCommunityWork")),
    amountLamports: v.optional(v.string()),
  },
  returns: paymentView,
  handler: async (ctx, args) => {
    const actor = await writeActor(ctx, args.wallet),
      now = Date.now();
    let recipientId: Id<"users">,
      amount: string,
      submissionId: Id<"forumCommunitySubmissions"> | undefined;
    if (args.workId) {
      if (args.recipientId || args.threadId || args.amountLamports)
        throw new ConvexError(
          "A reward must use only its selected pledge binding.",
        );
      const work = await ctx.db.get("forumCommunityWork", args.workId),
        submission = work?.selectedSubmissionId
          ? await ctx.db.get(
              "forumCommunitySubmissions",
              work.selectedSubmissionId,
            )
          : null;
      if (
        !work ||
        work.status !== "selected" ||
        work.sponsorId !== actor.userId ||
        !submission ||
        submission.workId !== work._id
      )
        throw new ConvexError(
          "Select a deliverable before approving its reward.",
        );
      recipientId = submission.authorId;
      amount = work.amountLamports;
      submissionId = submission._id;
      // The canonical binding prevents old expired rows from hiding a later hold.
      // Indexed state probes also fence legacy rows lacking that binding.
      const prior = work.paymentIntentId
        ? [await ctx.db.get("forumCommunityPayments", work.paymentIntentId)]
        : [];
      if (work.paymentIntentId && !prior[0])
        throw new ConvexError("This pledge's saved payment requires review.");
      for (const status of [
        "held",
        "checking",
        "opened",
        "verified",
        "ready",
      ] as const) {
        const rows = await ctx.db
          .query("forumCommunityPayments")
          .withIndex("by_workId_and_status", (q) =>
            q.eq("workId", work._id).eq("status", status),
          )
          .take(2);
        if (rows.length === 2)
          throw new ConvexError(
            "Multiple saved payments require review. Do not pay again.",
          );
        for (const row of rows)
          if (!prior.some((existing) => existing?._id === row._id))
            prior.push(row);
      }
      const protectedRows = prior.filter(
        (row): row is Doc<"forumCommunityPayments"> =>
          !!row &&
          row.status !== "expired" &&
          (row.status !== "ready" || row.expiresAt > now),
      );
      if (protectedRows.length > 1)
        throw new ConvexError(
          "Multiple saved payments require review. Do not pay again.",
        );
      const previous = protectedRows[0];
      if (previous) {
        if (
          previous.wallet !== args.wallet ||
          previous.submissionId !== submissionId
        )
          throw new ConvexError(
            "A saved reward already binds this pledge. Review that payment instead.",
          );
        if (work.paymentIntentId !== previous._id)
          await ctx.db.patch("forumCommunityWork", work._id, {
            paymentIntentId: previous._id,
          });
        return publicPayment(previous);
      }
      for (const row of prior)
        if (row?.status === "ready" && row.expiresAt <= now)
          await ctx.db.patch("forumCommunityPayments", row._id, {
            status: "expired",
          });
    } else {
      if (!args.recipientId || !args.amountLamports)
        throw new ConvexError("Choose an author and a tip amount.");
      recipientId = args.recipientId;
      try {
        amount = communityAmount(args.amountLamports);
      } catch (error) {
        safeError(error);
      }
      if (args.threadId) {
        const thread = await publicCommerceThread(ctx, args.threadId);
        if (!thread || thread.authorId !== recipientId)
          throw new ConvexError(
            "This tip must go to the public post's author.",
          );
      }
    }
    if (recipientId === actor.userId)
      throw new ConvexError("Choose another contributor to support.");
    const recipient = await ctx.db
      .query("forumCommunityRecipients")
      .withIndex("by_userId", (q) => q.eq("userId", recipientId))
      .unique();
    const profile = await ctx.db.get("users", recipientId);
    if (
      !recipient?.accepting ||
      !profile ||
      profile.forumBannedAt !== undefined ||
      profile.isAgent ||
      recipient.wallet === args.wallet
    )
      throw new ConvexError(
        "This contributor has not enabled a payment address.",
      );
    for (const state of ["ready", "opened", "checking", "held"] as const) {
      const outstanding = await ctx.db
        .query("forumCommunityPayments")
        .withIndex("by_payerId_and_status_and_createdAt", (q) =>
          q.eq("payerId", actor.userId).eq("status", state),
        )
        .order("desc")
        .take(25);
      if (outstanding.length === 25)
        throw new ConvexError(
          "Payment history requires review before another payment.",
        );
      const duplicate = outstanding.find(
        (row) => row.recipientId === recipientId,
      );
      if (duplicate) {
        if (state === "ready" && duplicate.expiresAt <= now)
          await ctx.db.patch("forumCommunityPayments", duplicate._id, {
            status: "expired",
          });
        else if (
          duplicate.wallet === args.wallet &&
          duplicate.workId === args.workId &&
          duplicate.threadId === args.threadId &&
          duplicate.amountLamports === amount
        )
          return publicPayment(duplicate);
        else
          throw new ConvexError(
            "A previous payment to this contributor is unresolved. Check its saved receipt before creating a different payment.",
          );
      }
    }
    const reference = publicReference(
        crypto.getRandomValues(new Uint8Array(32)),
      ),
      intentId = await ctx.db.insert("forumCommunityPayments", {
        authUserId: actor.authUserId,
        payerId: actor.userId,
        wallet: args.wallet,
        recipientId,
        recipient: recipient.wallet,
        amountLamports: amount,
        purpose: args.workId ? "reward" : "tip",
        threadId: args.threadId,
        workId: args.workId,
        submissionId,
        reference,
        memo: `SYMF-COMMUNITY:${reference}`,
        createdAt: now,
        expiresAt: now + COMMUNITY_PAYMENT_TTL_MS,
        status: "ready",
      });
    if (args.workId)
      await ctx.db.patch("forumCommunityWork", args.workId, {
        paymentIntentId: intentId,
      });
    return publicPayment(
      (await ctx.db.get("forumCommunityPayments", intentId))!,
    );
  },
});
export const markPaymentOpened = mutation({
  args: { intentId: v.id("forumCommunityPayments") },
  returns: v.object({ paymentUrl: v.string() }),
  handler: async (ctx, { intentId }) => {
    const row = await ownedPayment(ctx, intentId);
    if (row.status !== "ready" || row.expiresAt <= Date.now())
      throw new ConvexError(
        "This payment request cannot be opened again. Check its receipt; do not pay twice.",
      );
    await ctx.db.patch("forumCommunityPayments", row._id, {
      status: "opened",
      issue: "awaiting_wallet_receipt",
    });
    return { paymentUrl: communityPaymentUrl(row) };
  },
});
export const listPayments = query({
  args: {},
  returns: v.array(paymentView),
  handler: async (ctx) => {
    const actor = await commerceActor(ctx);
    const rows = await ctx.db
      .query("forumCommunityPayments")
      .withIndex("by_payerId_and_createdAt", (q) =>
        q.eq("payerId", actor.userId),
      )
      .order("desc")
      .take(30);
    return rows.map(publicPayment);
  },
});
export const getPayment = query({
  args: { intentId: v.id("forumCommunityPayments") },
  returns: paymentView,
  handler: async (ctx, { intentId }) =>
    publicPayment(await ownedPayment(ctx, intentId)),
});

export const claimPaymentCheck = internalMutation({
  args: {
    intentId: v.id("forumCommunityPayments"),
    signature: v.string(),
    lease: v.string(),
  },
  returns: v.object({ check: v.boolean(), payment: paymentView }),
  handler: async (ctx, args) => {
    const row = await ownedPayment(ctx, args.intentId),
      now = Date.now();
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(args.signature))
      throw new ConvexError("Use a Solana transaction signature.");
    if (row.signature && row.signature !== args.signature)
      throw new ConvexError(
        "This attempt is bound to its saved signature. Do not substitute another payment.",
      );
    const duplicate = await ctx.db
      .query("forumCommunityPayments")
      .withIndex("by_signature", (q) => q.eq("signature", args.signature))
      .unique();
    if (duplicate && duplicate._id !== row._id)
      throw new ConvexError(
        "This signature is already bound to another payment.",
      );
    if (row.status === "verified")
      return { check: false, payment: publicPayment(row) };
    if (row.status === "ready" || row.status === "expired")
      throw new ConvexError(
        "Open and approve this exact payment request before checking its receipt.",
      );
    if ((row.leaseUntil ?? 0) > now || (row.nextCheckAt ?? 0) > now)
      return { check: false, payment: publicPayment(row) };
    await ctx.db.patch("forumCommunityPayments", row._id, {
      status: "checking",
      signature: args.signature,
      checkLease: args.lease,
      leaseUntil: now + 20_000,
      nextCheckAt: now + 30_000,
      issue: "checking_finalized_receipt",
    });
    return {
      check: true,
      payment: publicPayment({
        ...row,
        status: "checking",
        signature: args.signature,
      }),
    };
  },
});
export const finishPaymentCheck = internalMutation({
  args: {
    intentId: v.id("forumCommunityPayments"),
    lease: v.string(),
    valid: v.boolean(),
    issue: v.string(),
    finalizedAt: v.union(v.number(), v.null()),
    slot: v.union(v.number(), v.null()),
  },
  returns: paymentView,
  handler: async (ctx, args) => {
    const row = await ownedPayment(ctx, args.intentId);
    if (row.checkLease !== args.lease || row.status !== "checking")
      return publicPayment(row);
    const now = Date.now();
    const valid = args.valid && args.finalizedAt !== null && args.slot !== null;
    if (valid && row.workId) {
      const work = await ctx.db.get("forumCommunityWork", row.workId);
      if (
        !work ||
        work.status !== "selected" ||
        work.sponsorId !== row.payerId ||
        work.paymentIntentId !== row._id ||
        work.selectedSubmissionId !== row.submissionId ||
        work.amountLamports !== row.amountLamports
      )
        throw new ConvexError(
          "Pledge binding changed; retain this payment for review.",
        );
      await ctx.db.patch("forumCommunityWork", work._id, {
        status: "paid",
        paidIntentId: row._id,
        updatedAt: now,
      });
    }
    await ctx.db.patch("forumCommunityPayments", row._id, {
      status: valid ? "verified" : "held",
      issue: valid ? "finalized" : args.issue.slice(0, 80),
      finalizedAt: valid ? args.finalizedAt! : undefined,
      slot: valid ? args.slot! : undefined,
      checkedAt: now,
      leaseUntil: 0,
    });
    return publicPayment(
      (await ctx.db.get("forumCommunityPayments", row._id))!,
    );
  },
});

export const setSupporterVisibility = mutation({
  args: { optedIn: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { optedIn }) => {
    const actor = await writeActor(ctx),
      old = await ctx.db
        .query("forumCommunitySupporters")
        .withIndex("by_userId", (q) => q.eq("userId", actor.userId))
        .unique();
    if (!old)
      throw new ConvexError("Verify a linked wallet's SYMF balance first.");
    await ctx.db.patch("forumCommunitySupporters", old._id, { optedIn });
    return null;
  },
});
export const getPublicSupporter = query({
  args: { userId: v.id("users"), now: v.number() },
  returns: v.union(
    v.object({ checkedAt: v.number(), expiresAt: v.number() }),
    v.null(),
  ),
  handler: async (ctx, { userId, now }) => {
    if (!Number.isFinite(now)) return null;
    const proof = await ctx.db
      .query("forumCommunitySupporters")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return proof?.eligible && proof.optedIn && proof.expiresAt > now
      ? { checkedAt: proof.checkedAt, expiresAt: proof.expiresAt }
      : null;
  },
});
export const claimSupporterRefresh = internalMutation({
  args: { wallet: v.string() },
  returns: v.object({
    fetch: v.boolean(),
    userId: v.id("users"),
    proof: v.union(supporterView, v.null()),
  }),
  handler: async (ctx, { wallet }) => {
    const actor = await commerceActor(ctx, wallet),
      now = Date.now(),
      old = await ctx.db
        .query("forumCommunitySupporters")
        .withIndex("by_userId", (q) => q.eq("userId", actor.userId))
        .unique();
    const view = old
      ? {
          optedIn: old.optedIn,
          eligible: old.eligible,
          checkedAt: old.checkedAt,
          expiresAt: old.expiresAt,
          proofSlot: old.proofSlot,
        }
      : null;
    if (
      old &&
      (old.leaseUntil > now || (old.wallet === wallet && old.expiresAt > now))
    )
      return { fetch: false, userId: actor.userId, proof: view };
    const fields = {
      userId: actor.userId,
      wallet,
      optedIn: old?.optedIn ?? false,
      eligible: false,
      checkedAt: old?.checkedAt ?? 0,
      expiresAt: 0,
      leaseUntil: now + 30_000,
      proofSlot: null,
    };
    if (old) await ctx.db.patch("forumCommunitySupporters", old._id, fields);
    else await ctx.db.insert("forumCommunitySupporters", fields);
    return { fetch: true, userId: actor.userId, proof: null };
  },
});
export const saveSupporterProof = internalMutation({
  args: {
    wallet: v.string(),
    eligible: v.boolean(),
    slot: v.union(v.number(), v.null()),
  },
  returns: supporterView,
  handler: async (ctx, args) => {
    const actor = await commerceActor(ctx, args.wallet),
      old = await ctx.db
        .query("forumCommunitySupporters")
        .withIndex("by_userId", (q) => q.eq("userId", actor.userId))
        .unique();
    if (!old || old.wallet !== args.wallet)
      throw new ConvexError("Wallet proof changed; refresh explicitly.");
    const now = Date.now(),
      fields = {
        eligible: args.eligible,
        checkedAt: now,
        expiresAt: now + COMMUNITY_SUPPORTER_TTL_MS,
        leaseUntil: 0,
        proofSlot: args.slot,
      };
    await ctx.db.patch("forumCommunitySupporters", old._id, fields);
    return {
      optedIn: old.optedIn,
      eligible: fields.eligible,
      checkedAt: fields.checkedAt,
      expiresAt: fields.expiresAt,
      proofSlot: fields.proofSlot,
    };
  },
});
