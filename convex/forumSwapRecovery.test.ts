/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setImmediate } from "node:timers";
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerAuth } from "@convex-dev/better-auth/test";
import {
  address,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import schema from "./schema";
import { api, components, internal } from "./_generated/api";
import { IDENTITY_MARKER } from "../lib/identity-config";
import {
  MAINNET_GENESIS,
  reconciliationHash,
} from "../lib/swap-reconciliation";
import { queueSwapRecovery } from "./forumSwapRecovery";
import { commerceLimiter } from "./forumCommerce";

const modules = import.meta.glob("./**/*.ts");
const yieldEventLoop = setImmediate;
// Isolate durable job timers between tests while allowing each admission
// sleep to advance alongside its asynchronous component mutation.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function fixture(
  options: {
    signature?: boolean;
    fresh?: boolean;
    signatureFirst?: boolean;
  } = {},
) {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  registerAuth(t);
  vi.stubEnv("FORUM_SWAP_AUTORECOVERY_ENABLED", "true");
  vi.stubEnv("BETTER_AUTH_ENABLED", "true");
  vi.stubEnv(
    "FORUM_COMMERCE_RPC_URL",
    "https://mainnet.helius-rpc.com/?api-key=fixture",
  );
  const now = Date.now(),
    wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
  const native = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Reader",
          email: "reader@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { name: "Reader" });
    await ctx.db.insert("betterAuthIdentityLinks", {
      authUserId: native._id,
      userId: id,
      linkedAt: now,
    });
    return id;
  });
  const session = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: native._id,
          token: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 86400000,
        },
      },
    }),
  );
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          userId: native._id,
          providerId: "solana",
          accountId: wallet,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  const client = t.withIdentity({
    issuer: "https://convex.test",
    subject: native._id,
    authSystem: IDENTITY_MARKER,
    sessionId: session._id,
  });
  const tx = compileTransaction(
    setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: blockhash("11111111111111111111111111111111"),
        lastValidBlockHeight: 100n,
      },
      setTransactionMessageFeePayer(
        address(wallet),
        createTransactionMessage({ version: 1 }),
      ),
    ),
  );
  const messageHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(tx.messageBytes)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const signature = getBase58Decoder().decode(new Uint8Array(64).fill(1));
  const signedWire = getBase64EncodedWireTransaction({
    ...tx,
    signatures: { [wallet]: new Uint8Array(64).fill(1) },
  } as unknown as Parameters<typeof getBase64EncodedWireTransaction>[0]);
  const createdAt = options.fresh ? now - 1000 : now - 3600000,
    expiresAt = createdAt + 25000;
  const row = {
    authUserId: native._id,
    userId,
    wallet,
    provider: "jupiter" as const,
    quoteJson: JSON.stringify({
      request: { inputMint: wallet, outputMint: wallet, amountRaw: "1" },
    }),
    treasury: wallet,
    platformFeeBps: 25,
    createdAt,
    expiresAt,
    status: "held" as const,
    issue: "wallet_outcome_unknown",
    transactionBase64: getBase64EncodedWireTransaction(tx),
    messageHash,
    lastValidBlockHeight: 100,
    simulationSlot: 200,
    transactionVersion: 1,
    ...(options.signature ? { signature } : {}),
    ...(options.signatureFirst ? { signatureFirst: true } : {}),
  };
  const id = await t.run((ctx) => ctx.db.insert("forumSwapQuotes", row)),
    other = await t.run((ctx) => ctx.db.insert("forumSwapQuotes", row));
  if (options.signatureFirst)
    await t.run((ctx) =>
      ctx.db.insert("forumSwapSubmissions", {
        quoteId: id,
        signature,
        wireHash: "a".repeat(64),
        registeredAt: createdAt,
        attemptedAt: createdAt + 1,
        rpcState: "unknown",
      }),
    );
  const data: {
    recent: boolean;
    empty: boolean;
    unavailable: boolean;
    receipt: unknown;
    progress: "processed" | "confirmed" | "finalized" | null;
    statusSlot: number;
    afterExpiryFound: boolean;
  } = {
    recent: false,
    empty: false,
    unavailable: false,
    progress: null,
    statusSlot: 350,
    afterExpiryFound: false,
    receipt: {
      slot: 250,
      meta: { err: null },
      transaction: [signedWire, "base64"],
    },
  };
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (data.unavailable && String(url).includes("api.mainnet-beta"))
      return new Response("unavailable", { status: 429 });
    const { method } = JSON.parse(String(init?.body));
    let result: unknown;
    if (method === "getGenesisHash") result = MAINNET_GENESIS;
    else if (method === "isBlockhashValid")
      result = { context: { slot: 300 }, value: false };
    else if (method === "getBlockHeight") result = 150;
    else if (method === "getFirstAvailableBlock") result = 1;
    else if (method === "getSignaturesForAddress")
      result = data.empty
        ? []
        : [
            {
              signature,
              slot: data.recent ? 220 : 190,
              blockTime: Math.floor(createdAt / 1000) - 180,
              confirmationStatus: "finalized",
              err: null,
            },
          ];
    else if (method === "getSignatureStatuses")
      result = {
        context: { slot: data.statusSlot },
        value: [
          data.progress ||
          (data.afterExpiryFound &&
            fetcher.mock.calls.filter(
              (call) =>
                JSON.parse(String(call[1]?.body)).method === "isBlockhashValid",
            ).length > 0)
            ? {
                slot: 250,
                err: null,
                confirmationStatus: data.progress ?? "confirmed",
              }
            : null,
        ],
      };
    else if (method === "getTransaction") result = data.receipt;
    else throw Error("No simulation, signing or sending allowed");
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  });
  vi.stubGlobal("fetch", fetcher);
  const job = () =>
    t.run((ctx) =>
      ctx.db
        .query("forumSwapRecoveries")
        .withIndex("by_quoteId", (q) => q.eq("quoteId", id))
        .unique(),
    );
  const due = async () => {
    const j = await job();
    await t.run((ctx) =>
      ctx.db.patch("forumSwapRecoveries", j!._id, {
        nextCheckAt: Date.now() - 1,
      }),
    );
  };
  return { t, client, id, other, row, data, fetcher, job, due, signature };
}
test("owner admission is idempotent, cannot reset attempts, and does no network IO", async () => {
  const f = await fixture();
  await expect(
    f.t.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id }),
  ).rejects.toThrow("Sign in");
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  const first = await f.job();
  await f.t.run((ctx) =>
    ctx.db.patch("forumSwapRecoveries", first!._id, {
      attempts: 2,
      state: "review",
    }),
  );
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  expect(await f.job()).toMatchObject({ attempts: 2, state: "review" });
  expect(f.fetcher).not.toHaveBeenCalled();
  await f.t.run((ctx) =>
    ctx.db.patch("forumSwapQuotes", f.other, { authUserId: "someone-else" }),
  );
  await expect(
    f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.other }),
  ).rejects.toThrow("Swap not found");
  expect(
    await f.t.run((ctx) => ctx.db.query("forumSwapRecoveries").take(10)),
  ).toHaveLength(1);
});
test("two quiet finalized providers automatically settle exactly the eligible hold and retain its audit", async () => {
  const f = await fixture();
  const before = await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id));
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  await f.due();
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id))).toEqual({
    ...before,
    status: "failed",
    issue: "reconciled_expired_not_landed",
    reconciliation: expect.objectContaining({
      authorization: "automatic-expiry-proof-v1",
      previousRecordHash: await reconciliationHash(before),
    }),
  });
  expect(await f.job()).toMatchObject({
    state: "resolved",
    outcome: "not_landed",
    attempts: 1,
  });
  expect(
    await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.other)),
  ).toMatchObject({ status: "held" });
  expect(f.fetcher).toHaveBeenCalledTimes(10);
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(f.fetcher).toHaveBeenCalledTimes(10);
});
test.each(["unavailable", "empty", "recent"] as const)(
  "%s evidence never unlocks a swap or retries payment",
  async (mode) => {
    const f = await fixture();
    f.data[mode] = true;
    await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
    await f.due();
    await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
    expect(
      await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
    ).toMatchObject({ status: "held" });
    expect(await f.job()).toMatchObject({
      state: "scheduled",
      attempts: 1,
      reason: "evidence_inconclusive",
    });
  },
);
test("a fresh missing-signature request waits the complete safety window without any RPC", async () => {
  const f = await fixture({ fresh: true });
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  expect((await f.job())!.nextCheckAt).toBeGreaterThanOrEqual(
    f.row.expiresAt + 900000,
  );
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(f.fetcher).not.toHaveBeenCalled();
});
test("duplicate actions share a single lease; a signature arriving mid-check fences stale expiry evidence", async () => {
  const f = await fixture();
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  await f.due();
  const results = await Promise.all([
    f.t.mutation(internal.forumSwapRecovery.claim, { quoteId: f.id }),
    f.t.mutation(internal.forumSwapRecovery.claim, { quoteId: f.id }),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const claimed = results.find(Boolean)!;
  await f.t.run((ctx) =>
    ctx.db.patch("forumSwapQuotes", f.id, { signature: f.signature }),
  );
  await f.t.mutation(internal.forumSwapRecovery.finish, {
    quoteId: f.id,
    lease: claimed.lease,
    snapshotHash: await reconciliationHash(claimed.row),
    evidence: null,
  });
  expect(await f.job()).toMatchObject({
    state: "scheduled",
    reason: "record_changed",
    attempts: 1,
  });
  expect(
    await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
  ).toMatchObject({ status: "held", signature: f.signature });
});
test("known signed receipts are auto-confirmed against both providers", async () => {
  const f = await fixture({ signature: true });
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  await f.due();
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(
    await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
  ).toMatchObject({ status: "confirmed", signature: f.signature });
  expect(await f.job()).toMatchObject({
    state: "resolved",
    outcome: "confirmed",
  });
  expect(f.fetcher).toHaveBeenCalledTimes(4);
});
test("signature-first confirmation checks start promptly and progress never regresses", async () => {
  const f = await fixture({ signature: true, signatureFirst: true });
  f.data.receipt = null;
  f.data.progress = "confirmed";
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  expect((await f.job())!.nextCheckAt - Date.now()).toBeLessThanOrEqual(1000);
  await f.due();
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(await f.job()).toMatchObject({
    state: "scheduled",
    attempts: 1,
    progress: "confirmed",
  });
  expect(f.fetcher).toHaveBeenCalledTimes(6);
  f.data.progress = "processed";
  await f.due();
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(await f.job()).toMatchObject({ progress: "confirmed" });
  expect(
    await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
  ).toMatchObject({ status: "held" });
});
test("signature-first expiry uses fresh post-expiry absence from both providers and retains the signature/proof", async () => {
  const f = await fixture({ signature: true, signatureFirst: true });
  f.data.receipt = null;
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  await f.due();
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(
    await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
  ).toMatchObject({
    status: "failed",
    issue: "signature_expired_not_found",
    signature: f.signature,
  });
  expect(await f.job()).toMatchObject({
    state: "resolved",
    outcome: "not_landed",
    attempts: 1,
  });
  const saved = await f.t.run((ctx) =>
    ctx.db
      .query("forumSwapSubmissions")
      .withIndex("by_quoteId", (q) => q.eq("quoteId", f.id))
      .unique(),
  );
  expect(saved).toMatchObject({
    signature: f.signature,
    expiryProofHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    expiryProof: {
      helius: { statusSlot: 350, invalidAtSlot: 300 },
      solana: { statusSlot: 350, invalidAtSlot: 300 },
    },
  });
  expect(f.fetcher).toHaveBeenCalledTimes(14);
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(f.fetcher).toHaveBeenCalledTimes(14);
});
test.each(["late_signature", "lagging_status", "missing_ledger", "budget"])(
  "%s cannot authorize signature-first expiry",
  async (mode) => {
    const f = await fixture({ signature: true, signatureFirst: true });
    f.data.receipt = null;
    if (mode === "late_signature") f.data.afterExpiryFound = true;
    if (mode === "lagging_status") f.data.statusSlot = 299;
    if (mode === "missing_ledger")
      await f.t.run(async (ctx) => {
        const sub = await ctx.db
          .query("forumSwapSubmissions")
          .withIndex("by_quoteId", (q) => q.eq("quoteId", f.id))
          .unique();
        await ctx.db.delete("forumSwapSubmissions", sub!._id);
      });
    if (mode === "budget")
      await f.t.run((ctx) =>
        commerceLimiter.limit(ctx, "commerceRecoveryDaily", {
          key: "all",
          count: 94,
        }),
      );
    await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
    await f.due();
    if (mode === "missing_ledger")
      await expect(
        f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id }),
      ).rejects.toThrow("binding missing");
    else await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
    expect(
      await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
    ).toMatchObject({ status: "held", signature: f.signature });
    expect((await f.job())!.state).not.toBe("resolved");
  },
);
test("new signed pending checks stop at six; old signed checks still stop at three", async () => {
  const f = await fixture({ signature: true, signatureFirst: true });
  // Advance only this awaited check's bounded admission sleeps. Yield between
  // steps so async component mutations can install their timers first.
  const check = async () => {
    let finished = false;
    const pending = f.t.action(internal.forumSwapRecovery.check, {
      quoteId: f.id,
    });
    void pending.then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );
    for (let step = 0; step < 150 && !finished; step++) {
      await new Promise<void>((resolve) => yieldEventLoop(resolve));
      await vi.advanceTimersByTimeAsync(100);
    }
    await pending;
  };
  f.data.receipt = null;
  f.data.progress = "processed";
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  for (let i = 0; i < 6; i++) {
    await f.due();
    await check();
  }
  expect(await f.job()).toMatchObject({
    state: "review",
    attempts: 6,
    nextCheckAt: 0,
  });
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  await check();
  expect(f.fetcher).toHaveBeenCalledTimes(36);
}, 20000);
test("a finalized exact-message chain failure terminates without replay", async () => {
  const f = await fixture({ signature: true });
  (f.data.receipt as { meta: { err: unknown } }).meta.err = {
    InstructionError: [0, "fixture"],
  };
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  await f.due();
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(
    await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
  ).toMatchObject({ status: "failed", issue: "finalized_transaction_failed" });
  expect(await f.job()).toMatchObject({
    state: "resolved",
    outcome: "chain_failed",
  });
});
test("pending signed receipts stop after three bounded checks and survive re-enrollment unchanged", async () => {
  const f = await fixture({ signature: true });
  f.data.receipt = null;
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  for (let i = 0; i < 3; i++) {
    await f.due();
    await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  }
  expect(await f.job()).toMatchObject({
    state: "review",
    attempts: 3,
    nextCheckAt: 0,
  });
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(f.fetcher).toHaveBeenCalledTimes(12);
}, 15000);
test("global free-tier exhaustion defers without any RPC or hold release", async () => {
  const f = await fixture();
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  await f.due();
  await f.t.run((ctx) =>
    commerceLimiter.limit(ctx, "commerceNetworkDaily", {
      key: "all",
      count: 20_000,
    }),
  );
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(await f.job()).toMatchObject({
    state: "scheduled",
    reason: "budget_unavailable",
  });
  expect(
    await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
  ).toMatchObject({ status: "held" });
});
test("disabled mode creates no jobs, requests, or changes to held records", async () => {
  const f = await fixture();
  vi.stubEnv("FORUM_SWAP_AUTORECOVERY_ENABLED", "false");
  expect(
    await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id }),
  ).toBeNull();
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(await f.job()).toBeNull();
  expect(f.fetcher).not.toHaveBeenCalled();
});
test("agent profiles cannot enroll human wallet recovery", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch("users", f.row.userId, { isAgent: true }),
  );
  await expect(
    f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id }),
  ).rejects.toThrow("cannot use commerce");
  expect(await f.job()).toBeNull();
  expect(f.fetcher).not.toHaveBeenCalled();
});
test("the two receipt providers must agree on the finalized outcome", async () => {
  const f = await fixture({ signature: true }),
    original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation(async (url, init) => {
    const method = JSON.parse(String(init?.body)).method;
    if (String(url).includes("api.mainnet-beta") && method === "getTransaction")
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          ...(f.data.receipt as object),
          meta: { err: { InstructionError: [0, "fixture"] } },
        },
      });
    return original(url, init);
  });
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  await f.due();
  await f.t.action(internal.forumSwapRecovery.check, { quoteId: f.id });
  expect(
    await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
  ).toMatchObject({ status: "held" });
  expect(await f.job()).toMatchObject({
    state: "scheduled",
    reason: "evidence_inconclusive",
  });
});
test("the normal wallet request fence queues recovery even if the browser never returns", async () => {
  const f = await fixture({ fresh: true });
  vi.stubEnv("FORUM_SWAPS_ENABLED", "true");
  vi.stubEnv("FORUM_PLATFORM_FEE_BPS", "25"); // This legacy fixture's quoted fee.
  vi.stubEnv("FORUM_COMMERCE_TREASURY", f.row.wallet);
  await f.t.run(async (ctx) => {
    await ctx.db.patch("forumSwapQuotes", f.id, { status: "prepared" });
    await ctx.db.patch("forumSwapQuotes", f.other, { status: "failed" });
  });
  await f.client.mutation(api.forumSwaps.beginWalletRequest, { quoteId: f.id });
  expect(await f.job()).toMatchObject({
    state: "scheduled",
    reason: "waiting_expiry",
    attempts: 0,
  });
});
test("a completed quote never starts a new recovery job", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    await ctx.db.patch("forumSwapQuotes", f.id, { status: "failed" });
    const row = await ctx.db.get("forumSwapQuotes", f.id);
    expect(await queueSwapRecovery(ctx, row!)).toBeNull();
  });
  expect(await f.job()).toBeNull();
});
test("the durable scheduler settles the swap without a second browser request", async () => {
  // Component mutations settle asynchronously; let their bounded pre-I/O
  // admission sleeps advance too, without jumping to the recovery watchdog.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const f = await fixture();
  await f.client.mutation(api.forumSwapRecovery.ensure, { quoteId: f.id });
  // Advance only to the due job. Jumping through every timeout would also
  // expire its live watchdog before the mocked RPC microtasks can finish.
  await vi.advanceTimersByTimeAsync(1100);
  await f.t.finishInProgressScheduledFunctions();
  expect(await f.job()).toMatchObject({
    state: "resolved",
    outcome: "not_landed",
    attempts: 1,
  });
  expect(f.fetcher).toHaveBeenCalledTimes(10);
}, 15000);
