"use node";

import { v, ConvexError } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import {
  address,
  getBase64EncodedWireTransaction,
  getBase58Decoder,
  getPublicKeyFromAddress,
  verifySignature,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  action,
  env,
  internalAction,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { commerceConfig, record, TOKEN_PROGRAM } from "../lib/forum-commerce";
import {
  exactResearchPayload,
  RESEARCH_ASSET,
  RESEARCH_FACILITATOR,
  RESEARCH_NETWORK,
  RESEARCH_TREASURY,
  researchHash,
  researchSignatureValid,
} from "../lib/forum-research";
import { inspectResearchWire } from "../lib/forum-research-wire";
import {
  verifyResearchPayment,
  settleResearchPayment,
} from "../lib/forum-research-facilitator";
import { researchRateWithinReserve } from "../lib/forum-research-readiness";
import { providerJson } from "../lib/swap-router";
import { commerceRpc } from "./forumCommerceRpc";
import { providerFetch } from "./forumProviderFetch";

type Intent = Doc<"forumResearchIntents">;
const readIntentRef = makeFunctionReference<
  "query",
  { intentKey: string },
  Intent
>("forumResearch:readIntent");
const claimReadRef = makeFunctionReference<
  "mutation",
  { intentKey: string; purpose: "sdk" | "simulation" },
  Intent
>("forumResearch:claimRead");
const simulationRef = makeFunctionReference<
  "mutation",
  { intentKey: string; messageHash: string },
  null
>("forumResearch:saveSimulation");
const claimRef = makeFunctionReference<
  "mutation",
  { intentKey: string; payloadHash: string; messageHash: string },
  boolean
>("forumResearch:claimPayment");
const settleRef = makeFunctionReference<
  "mutation",
  { intentKey: string; payloadHash: string; payer: string },
  boolean
>("forumResearch:claimSettlement");
const finishRef = makeFunctionReference<
  "mutation",
  {
    intentKey: string;
    payloadHash: string;
    state: "unknown" | "rejected" | "fulfilled";
    signature?: string;
    finalizedAt?: number;
  },
  null
>("forumResearch:finish");
function rpcUrl() {
  const url = commerceConfig(env).rpcUrl;
  if (!url) throw new ConvexError("Research chain access is unavailable.");
  return url;
}
const signatureValid = researchSignatureValid;
async function finalized(
  row: Intent,
  signature: string,
  fetcher: typeof fetch,
) {
  if (!signatureValid(signature)) return false;
  const result = record(
    await commerceRpc(
      rpcUrl(),
      "getTransaction",
      [
        signature,
        {
          encoding: "base64",
          commitment: "finalized",
          maxSupportedTransactionVersion: 1,
        },
      ],
      fetcher,
    ),
  );
  const meta = record(result.meta),
    wire = result.transaction;
  if (
    meta.err !== null ||
    !Number.isSafeInteger(result.slot) ||
    !Array.isArray(wire) ||
    wire[1] !== "base64" ||
    typeof wire[0] !== "string"
  )
    return false;
  const checked = await inspectResearchWire(
    wire[0],
    row.wallet,
    row.requirements,
    true,
  );
  const feePayer = address(row.requirements.extra.feePayer),
    feeSignature = checked.transaction.signatures[feePayer];
  return (
    checked.messageHash === row.simulationHash &&
    !!feeSignature &&
    getBase58Decoder().decode(feeSignature) === signature &&
    (await verifySignature(
      await getPublicKeyFromAddress(feePayer),
      feeSignature,
      checked.transaction.messageBytes,
    ))
  );
}
/** Fixed RPC allowlist used only by the official SDK for this owner's live quote. Never forwards arbitrary RPC methods. */
export const sdkRead = action({
  args: {
    intentKey: v.string(),
    method: v.union(
      v.literal("getAccountInfo"),
      v.literal("getLatestBlockhash"),
    ),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const row = await ctx.runMutation(claimReadRef, {
      intentKey: args.intentKey,
      purpose: "sdk",
    });
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet: row.wallet,
      cost: 1,
    });
    const params =
      args.method === "getAccountInfo"
        ? [RESEARCH_ASSET, { encoding: "base64", commitment: "confirmed" }]
        : [{ commitment: "confirmed" }];
    return JSON.stringify(
      await commerceRpc(
        rpcUrl(),
        args.method,
        params,
        providerFetch(ctx, { rpcUrls: [rpcUrl()] }),
      ),
    );
  },
});
/** Exact instruction binding + simulation precede the one explicit wallet signature. */
export const simulate = action({
  args: { intentKey: v.string(), transactionBase64: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.runMutation(claimReadRef, {
      intentKey: args.intentKey,
      purpose: "simulation",
    });
    const checked = await inspectResearchWire(
      args.transactionBase64,
      row.wallet,
      row.requirements,
      false,
    );
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet: row.wallet,
      cost: 1,
    });
    const result = record(
      await commerceRpc(
        rpcUrl(),
        "simulateTransaction",
        [
          getBase64EncodedWireTransaction(checked.transaction),
          {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: false,
            commitment: "confirmed",
          },
        ],
        providerFetch(ctx, { rpcUrls: [rpcUrl()] }),
      ),
    );
    const value = record(result.value);
    if (
      value.err !== null ||
      !Number.isSafeInteger(value.unitsConsumed) ||
      Number(value.unitsConsumed) <= 0
    )
      throw new ConvexError(
        "Research payment simulation failed. No wallet request was made.",
      );
    await ctx.runMutation(simulationRef, {
      intentKey: args.intentKey,
      messageHash: checked.messageHash,
    });
    return null;
  },
});
export const pay = action({
  args: { intentKey: v.string(), paymentHeader: v.string() },
  returns: v.object({
    state: v.union(
      v.literal("protected"),
      v.literal("rejected"),
      v.literal("fulfilled"),
    ),
    signature: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(readIntentRef, {
      intentKey: args.intentKey,
    });
    if (args.paymentHeader.length > 8192)
      throw new ConvexError("Invalid payment header.");
    let payload, checked;
    try {
      payload = decodePaymentSignatureHeader(args.paymentHeader);
      const wire = exactResearchPayload(
        payload,
        row.requirements,
        row.resource,
      );
      checked = await inspectResearchWire(
        wire,
        row.wallet,
        row.requirements,
        true,
      );
    } catch {
      throw new ConvexError(
        "Payment does not match the prepared research request. Nothing was settled.",
      );
    }
    // Reserve before the durable claim; no external request has happened yet.
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet: row.wallet,
      cost: 3,
    });
    const payloadHash = await researchHash(payload);
    if (
      !(await ctx.runMutation(claimRef, {
        intentKey: args.intentKey,
        payloadHash,
        messageHash: checked.messageHash,
      }))
    )
      return {
        state:
          row.state === "fulfilled"
            ? ("fulfilled" as const)
            : ("protected" as const),
        signature: row.signature ?? null,
      };
    // Explicit direct calls only: the SDK resource-server's settlement retry helper is intentionally not used.
    let verified;
    try {
      verified = await verifyResearchPayment(payload, row.requirements);
    } catch {
      await ctx.runMutation(finishRef, {
        intentKey: args.intentKey,
        payloadHash,
        state: "unknown",
      });
      return { state: "protected" as const, signature: null };
    }
    if (!verified.isValid || verified.payer !== row.wallet) {
      await ctx.runMutation(finishRef, {
        intentKey: args.intentKey,
        payloadHash,
        state: "rejected",
      });
      return { state: "rejected" as const, signature: null };
    }
    if (
      !(await ctx.runMutation(settleRef, {
        intentKey: args.intentKey,
        payloadHash,
        payer: verified.payer,
      }))
    ) {
      await ctx.runMutation(finishRef, {
        intentKey: args.intentKey,
        payloadHash,
        state: "unknown",
      });
      return { state: "protected" as const, signature: null };
    }
    let signature: string | undefined;
    try {
      const result = await settleResearchPayment(payload, row.requirements);
      if (
        result.network === RESEARCH_NETWORK &&
        signatureValid(result.transaction)
      ) {
        signature = result.transaction;
        await ctx.runMutation(
          makeFunctionReference<"mutation">(
            "forumResearch:saveSettlementSignature",
          ),
          { intentKey: args.intentKey, payloadHash, signature },
        );
        if (
          result.success &&
          (result.payer === undefined || result.payer === row.wallet) &&
          (result.amount === undefined ||
            result.amount === row.requirements.amount) &&
          (await finalized(
            row,
            signature,
            providerFetch(ctx, { rpcUrls: [rpcUrl()] }),
          ))
        ) {
          await ctx.runMutation(finishRef, {
            intentKey: args.intentKey,
            payloadHash,
            state: "fulfilled",
            signature,
            finalizedAt: Date.now(),
          });
          return { state: "fulfilled" as const, signature };
        }
      }
    } catch {
      /* A timeout/5xx never authorizes another settlement call. */
    }
    await ctx.runMutation(finishRef, {
      intentKey: args.intentKey,
      payloadHash,
      state: "unknown",
      ...(signature ? { signature } : {}),
    });
    return { state: "protected" as const, signature: signature ?? null };
  },
});
/** Read-only receipt reconciliation, never a facilitator retry. Missing signature/history leaves the hold intact. */
export const check = action({
  args: { intentKey: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(readIntentRef, args);
    if (row.state === "fulfilled") return true;
    if (row.state !== "unknown" || !row.signature || !row.payloadHash)
      return false;
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet: row.wallet,
      cost: 1,
    });
    try {
      if (
        await finalized(
          row,
          row.signature,
          providerFetch(ctx, { rpcUrls: [rpcUrl()] }),
        )
      ) {
        await ctx.runMutation(finishRef, {
          ...args,
          payloadHash: row.payloadHash,
          state: "fulfilled",
          signature: row.signature,
          finalizedAt: Date.now(),
        });
        return true;
      }
    } catch {
      /* Not proven finalized is not permission to replay. */
    }
    return false;
  },
});
/** Deployment operator supplies a manually verified actual free-credit balance; this action checks chain/provider readiness, without paying. */
const readinessArgs = {
  wallet: v.string(),
  creditLimit: v.number(),
  creditEvidence: v.literal("provider-dashboard-verified"),
  enabled: v.boolean(),
};
const readinessResult = v.object({
  ready: v.boolean(),
  recipientAta: v.string(),
  verifiedAt: v.number(),
});
async function verifySetup(
  ctx: ActionCtx,
  args: {
    wallet: string;
    creditLimit: number;
    creditEvidence: "provider-dashboard-verified";
    enabled: boolean;
    expectedUpdatedAt?: number;
  },
) {
  await ctx.runMutation(
    makeFunctionReference<"mutation">("forumResearch:reserveReadinessNetwork"),
    {},
  );
  const supported = await providerJson(
    `${RESEARCH_FACILITATOR}/supported`,
    fetch,
    { signal: AbortSignal.timeout(10_000), redirect: "error" },
  );
  const kinds = supported.kinds;
  if (!researchRateWithinReserve(supported, Date.now()))
    throw new ConvexError(
      "The facilitator rate cannot be covered by the reserved free credits.",
    );
  if (!Array.isArray(kinds) || kinds.length > 100)
    throw new ConvexError("Facilitator capability unavailable.");
  const kind = kinds
    .map(record)
    .find(
      (item) =>
        item.x402Version === 2 &&
        item.scheme === "exact" &&
        item.network === RESEARCH_NETWORK,
    );
  const extra = record(kind?.extra),
    signers = record(supported.signers),
    networkSigners = signers[RESEARCH_NETWORK];
  const feePayer =
    typeof extra.feePayer === "string"
      ? extra.feePayer
      : Array.isArray(networkSigners) && typeof networkSigners[0] === "string"
        ? networkSigners[0]
        : null;
  const versions = extra.transactionVersions;
  if (
    !kind ||
    !feePayer ||
    (versions !== undefined &&
      (!Array.isArray(versions) || !versions.includes(0)))
  )
    throw new ConvexError("Compatible exact Solana facilitator unavailable.");
  const [recipientAta] = await findAssociatedTokenPda({
    owner: address(RESEARCH_TREASURY),
    mint: address(RESEARCH_ASSET),
    tokenProgram: address(TOKEN_PROGRAM),
  });
  const result = record(
    await commerceRpc(
      rpcUrl(),
      "getAccountInfo",
      [recipientAta, { encoding: "jsonParsed", commitment: "finalized" }],
      providerFetch(ctx, { rpcUrls: [rpcUrl()] }),
    ),
  );
  const account = record(result.value),
    parsed = record(record(account.data).parsed),
    info = record(parsed.info);
  if (
    account.owner !== TOKEN_PROGRAM ||
    parsed.type !== "account" ||
    info.owner !== RESEARCH_TREASURY ||
    info.mint !== RESEARCH_ASSET ||
    info.state !== "initialized"
  )
    throw new ConvexError(
      "The treasury's USDC associated token account must exist before accepting payments.",
    );
  const verifiedAt = Date.now();
  await ctx.runMutation(
    makeFunctionReference<"mutation">("forumResearch:configureReadiness"),
    {
      enabled: args.enabled,
      creditLimit: args.creditLimit,
      creditEvidence: args.creditEvidence,
      feePayer,
      recipientAta,
      verifiedAt,
      ...(args.expectedUpdatedAt !== undefined
        ? { expectedUpdatedAt: args.expectedUpdatedAt }
        : {}),
    },
  );
  return {
    ready: args.enabled && args.creditLimit >= 2,
    recipientAta,
    verifiedAt,
  };
}
export const verifyReadiness = internalAction({
  args: readinessArgs,
  returns: readinessResult,
  handler: verifySetup,
});
/** Read-only refresh never invents or replenishes the operator's initial free-credit evidence. */
export const quote = action({
  args: { wallet: v.string(), mint: v.string(), idempotencyKey: v.string() },
  returns: v.object({
    intentKey: v.string(),
    expiresAt: v.number(),
    requirementsJson: v.string(),
    resource: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    intentKey: string;
    expiresAt: number;
    requirementsJson: string;
    resource: string;
  }> => {
    const stale: Doc<"forumResearchControl"> | null = await ctx.runMutation(
      makeFunctionReference<
        "mutation",
        { wallet: string },
        Doc<"forumResearchControl"> | null
      >("forumResearch:claimReadinessRefresh"),
      { wallet: args.wallet },
    );
    if (stale)
      await verifySetup(ctx, {
        wallet: args.wallet,
        enabled: stale.enabled,
        creditLimit: stale.creditLimit,
        creditEvidence: stale.creditEvidence,
        expectedUpdatedAt: stale.updatedAt,
      });
    return await ctx.runMutation(
      makeFunctionReference<"mutation">("forumResearch:quote"),
      args,
    );
  },
});
