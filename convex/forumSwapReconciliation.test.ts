/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
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
import { internal } from "./_generated/api";
import {
  MAINNET_GENESIS,
  reconciliationHash,
} from "../lib/swap-reconciliation";
import { commerceLimiter } from "./forumCommerce";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
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
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { name: "Reconciliation fixture" }),
  );
  const row = {
    authUserId: "fixture-owner",
    userId,
    wallet,
    provider: "jupiter" as const,
    quoteJson: "{}",
    treasury: wallet,
    platformFeeBps: 25,
    createdAt: Date.now() - 3600000,
    expiresAt: Date.now() - 3575000,
    status: "held" as const,
    issue: "wallet_outcome_unknown",
    messageHash,
    transactionBase64: getBase64EncodedWireTransaction(tx),
    lastValidBlockHeight: 100,
    simulationSlot: 200,
    transactionVersion: 1,
  };
  const id = await t.run((ctx) => ctx.db.insert("forumSwapQuotes", row));
  const other = await t.run((ctx) => ctx.db.insert("forumSwapQuotes", row));
  const approval = {
    quoteId: id,
    wallet,
    messageHash,
    approvedAt: Date.now() - 1000,
    expiresAt: Date.now() + 1800000,
    authorization: "fixture-owner-approved",
  };
  vi.stubEnv("FORUM_SWAP_RECONCILIATION_TARGET", JSON.stringify(approval));
  vi.stubEnv(
    "FORUM_COMMERCE_RPC_URL",
    "https://mainnet.helius-rpc.com/?api-key=fixture",
  );
  const history = [
    {
      signature: getBase58Decoder().decode(new Uint8Array(64).fill(1)),
      slot: 190,
      blockTime: Math.floor(row.createdAt / 1000) - 180,
      confirmationStatus: "finalized",
      err: null,
    },
  ];
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { method, params } = JSON.parse(String(init?.body));
      let result: unknown;
      if (method === "getGenesisHash") result = MAINNET_GENESIS;
      else if (method === "isBlockhashValid") {
        expect(params[1]).toMatchObject({
          commitment: "finalized",
          minContextSlot: 200,
        });
        result = { context: { slot: 300 }, value: false };
      } else if (method === "getBlockHeight") result = 150;
      else if (method === "getFirstAvailableBlock") result = 1;
      else if (method === "getSignaturesForAddress") {
        expect(params).toEqual([
          wallet,
          { commitment: "finalized", minContextSlot: 300, limit: 10 },
        ]);
        result = history;
      } else
        throw new Error(
          "Unexpected RPC method; signing, simulation and sending are forbidden",
        );
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    },
  );
  vi.stubGlobal("fetch", fetcher);
  return { t, id, other, approval, history, fetcher };
}
describe("operator approved single-swap reconciliation", () => {
  test("one-shot diagnostic survives a failed proof and cannot be reused or reset", async () => {
    const f = await setup();
    vi.stubEnv(
      "FORUM_SWAP_RECONCILIATION_TARGET",
      JSON.stringify({
        ...f.approval,
        authorization: "one-shot-diagnostic-fixture",
      }),
    );
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) =>
      String(url).includes("api.mainnet-beta")
        ? new Response("private-provider-failure", { status: 429 })
        : original(url, init),
    );
    expect(
      await f.t.action(internal.forumSwapReconciliation.reconcileApproved, {}),
    ).toEqual({ status: "held", reason: "solana_genesis" });
    expect(f.fetcher).toHaveBeenCalledTimes(6);
    const markers = await f.t.run((ctx) =>
      ctx.db
        .query("forumSwapReconciliationAttempts")
        .withIndex("by_authorization", (q) =>
          q.eq("authorization", "one-shot-diagnostic-fixture"),
        )
        .take(2),
    );
    expect(markers).toHaveLength(1);
    expect(
      await f.t.action(internal.forumSwapReconciliation.reconcileApproved, {}),
    ).toEqual({ status: "held", reason: "reservation_inconclusive_no_replay" });
    expect(f.fetcher).toHaveBeenCalledTimes(6);
    expect(
      await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
    ).toMatchObject({ status: "held" });
  });
  test("one-shot diagnostic still respects the unchanged daily recovery cap", async () => {
    const f = await setup();
    vi.stubEnv(
      "FORUM_SWAP_RECONCILIATION_TARGET",
      JSON.stringify({
        ...f.approval,
        authorization: "one-shot-diagnostic-capped",
      }),
    );
    await f.t.run((ctx) =>
      commerceLimiter.limit(ctx, "commerceRecoveryDaily", {
        key: "all",
        count: 100,
      }),
    );
    expect(
      await f.t.action(internal.forumSwapReconciliation.reconcileApproved, {}),
    ).toMatchObject({
      status: "held",
      reason: "reservation_inconclusive_no_replay",
    });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  test("retains the complete old record, audits only the approved hold and is idempotent", async () => {
    const f = await setup();
    const before = await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id));
    const otherBefore = await f.t.run((ctx) =>
      ctx.db.get("forumSwapQuotes", f.other),
    );
    expect(
      await f.t.action(internal.forumSwapReconciliation.reconcileApproved, {}),
    ).toMatchObject({ status: "reconciled_not_landed" });
    const after = await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id));
    expect(after).toEqual({
      ...before,
      status: "failed",
      issue: "reconciled_expired_not_landed",
      reconciliation: expect.objectContaining({
        kind: "expired_not_landed",
        authorization: f.approval.authorization,
        previousStatus: "held",
        previousIssue: "wallet_outcome_unknown",
        previousRecordHash: await reconciliationHash(before),
      }),
    });
    expect(
      await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.other)),
    ).toEqual(otherBefore);
    expect(f.fetcher).toHaveBeenCalledTimes(10);
    expect(
      await f.t.action(internal.forumSwapReconciliation.reconcileApproved, {}),
    ).toMatchObject({
      status: "reconciled_not_landed",
      reason: "already_reconciled_no_replay",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(10);
  });
  test.each(["missing", "expired", "wrong-wallet", "wrong-message"])(
    "rejects %s approval before network IO",
    async (mode) => {
      const f = await setup();
      if (mode === "missing")
        vi.stubEnv("FORUM_SWAP_RECONCILIATION_TARGET", "");
      else
        vi.stubEnv(
          "FORUM_SWAP_RECONCILIATION_TARGET",
          JSON.stringify({
            ...f.approval,
            ...(mode === "expired"
              ? { expiresAt: Date.now() - 1 }
              : mode === "wrong-wallet"
                ? { wallet: "11111111111111111111111111111111" }
                : { messageHash: "0".repeat(64) }),
          }),
        );
      await expect(
        f.t.action(internal.forumSwapReconciliation.reconcileApproved, {}),
      ).rejects.toThrow();
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(
        (await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)))?.status,
      ).toBe("held");
    },
  );
  test("an unavailable independent RPC cannot release the hold", async () => {
    const f = await setup(),
      original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) =>
      String(url).includes("api.mainnet-beta")
        ? new Response("unavailable", { status: 429 })
        : original(url, init),
    );
    expect(
      await f.t.action(internal.forumSwapReconciliation.reconcileApproved, {}),
    ).toMatchObject({ status: "held" });
    expect(
      (await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)))
        ?.reconciliation,
    ).toBeUndefined();
  });
  test("a signature appearing during verification prevents the audited update", async () => {
    const f = await setup(),
      original = f.fetcher.getMockImplementation()!;
    let calls = 0;
    f.fetcher.mockImplementation(async (url, init) => {
      calls++;
      if (calls === 10)
        await f.t.run((ctx) =>
          ctx.db.patch("forumSwapQuotes", f.id, {
            signature: f.history[0].signature,
          }),
        );
      return original(url, init);
    });
    expect(
      await f.t.action(internal.forumSwapReconciliation.reconcileApproved, {}),
    ).toMatchObject({ status: "held" });
    expect(
      await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)),
    ).toMatchObject({ status: "held", signature: f.history[0].signature });
  });
  test("new wallet activity or an empty index is inconclusive, not proof of absence", async () => {
    const f = await setup();
    f.history[0].slot = 250;
    expect(
      await f.t.action(internal.forumSwapReconciliation.reconcileApproved, {}),
    ).toMatchObject({ status: "held" });
    expect(
      (await f.t.run((ctx) => ctx.db.get("forumSwapQuotes", f.id)))?.status,
    ).toBe("held");
  });
});
