import { describe, expect, test } from "vitest";
import {
  allocatePromotionLane,
  linkedMintCandidate,
  commerceConfig,
  COMMERCE_MINT,
  holderEligible,
  priceNanoUsd,
  PROMOTION_MEMO_PROGRAM,
  TOKEN_2022_PROGRAM,
  verifyPromotionReceipt,
} from "./forum-commerce";
describe("linked mint candidates are discovery hints, not ticker guesses", () => {
  test("exact official links identify one case-sensitive mint", () => {
    expect(
      linkedMintCandidate(
        `Read [token](https://pump.fun/coin/${COMMERCE_MINT}?x=1)`,
      ),
    ).toBe(COMMERCE_MINT);
    expect(
      linkedMintCandidate(
        `https://bags.fm/${COMMERCE_MINT}/ https://www.pump.fun/coin/${COMMERCE_MINT}`,
      ),
    ).toBe(COMMERCE_MINT);
  });
  test("ambiguous, malformed, spoofed and plain ticker content fails closed", () => {
    expect(
      linkedMintCandidate(
        `https://bags.fm/${COMMERCE_MINT} https://pump.fun/coin/${"11111111111111111111111111111111"}`,
      ),
    ).toBeNull();
    for (const value of [
      "$SYMF",
      `https://pump.fun.evil.test/coin/${COMMERCE_MINT}`,
      `https://evil.test/https://pump.fun/coin/${COMMERCE_MINT}`,
      `https://pump.fun@evil.test/coin/${COMMERCE_MINT}`,
      `http://pump.fun/coin/${COMMERCE_MINT}`,
      "https://pump.fun/coin/not-a-mint",
    ])
      expect(linkedMintCandidate(value)).toBeNull();
    expect(linkedMintCandidate("x".repeat(100001))).toBeNull();
  });
});
const wallet = "11111111111111111111111111111111",
  treasury = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY",
  source = "So11111111111111111111111111111111111111112",
  destination = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const intent = {
  wallet,
  treasury,
  mint: COMMERCE_MINT,
  tokenProgram: TOKEN_2022_PROGRAM,
  amountRaw: "10000000000",
  treasuryAmountRaw: "5000000000",
  burnAmountRaw: "5000000000",
  decimals: 6,
  reference: wallet,
  createdAt: 1_000_000,
  checkoutExpiresAt: 1_600_000,
};
function receipt() {
  return {
    blockTime: 1100,
    meta: {
      err: null,
      preTokenBalances: [
        {
          accountIndex: 1,
          owner: wallet,
          mint: COMMERCE_MINT,
          programId: TOKEN_2022_PROGRAM,
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 2,
          owner: treasury,
          mint: COMMERCE_MINT,
          programId: TOKEN_2022_PROGRAM,
        },
      ],
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: wallet, signer: true },
          { pubkey: source, signer: false },
          { pubkey: destination, signer: false },
        ],
        instructions: [
          {
            programId: TOKEN_2022_PROGRAM,
            parsed: {
              type: "transferChecked",
              info: {
                authority: wallet,
                source,
                destination,
                mint: COMMERCE_MINT,
                tokenAmount: { amount: intent.treasuryAmountRaw, decimals: 6 },
              },
            },
          },
          {
            programId: TOKEN_2022_PROGRAM,
            parsed: {
              type: "burnChecked",
              info: {
                authority: wallet,
                account: source,
                mint: COMMERCE_MINT,
                tokenAmount: { amount: intent.burnAmountRaw, decimals: 6 },
              },
            },
          },
          {
            programId: PROMOTION_MEMO_PROGRAM,
            parsed: `SYMF-PROMOTION:${wallet}`,
          },
        ],
      },
    },
  };
}
describe("holder waiver and opt-in commerce config", () => {
  test("strictly more than one dollar, exact raw-unit arithmetic and conservative price precision", () => {
    expect(holderEligible("1000000", 6, "1")).toBe(false);
    expect(holderEligible("1000001", 6, "1")).toBe(true);
    expect(holderEligible("100000000000", 6, "0.00001000000000001")).toBe(
      false,
    );
    expect(holderEligible("100000100000", 6, "0.00001000000000001")).toBe(true);
    expect(holderEligible("18446744073709551615", 18, "1")).toBe(true);
    expect(holderEligible("-1", 6, "10")).toBe(false);
    expect(holderEligible("1e9", 6, "1")).toBe(false);
    expect(holderEligible("1000001", 6, "NaN")).toBe(false);
    expect(holderEligible("1000001", 6, "0")).toBe(false);
    expect(holderEligible("1000001", 99, "1")).toBe(false);
    expect(priceNanoUsd("0.0000123456789")).toBe(12345n);
  });
  test("economic capabilities remain disabled without explicit switches and valid treasury/RPC", () => {
    expect(commerceConfig({})).toMatchObject({
      swapsEnabled: false,
      promotionsEnabled: false,
      platformFeeBps: 50,
      promotionBurnBps: 5000,
    });
    const base = {
      FORUM_SWAPS_ENABLED: "true",
      FORUM_PROMOTIONS_ENABLED: "true",
      FORUM_COMMERCE_TREASURY: treasury,
      FORUM_COMMERCE_RPC_URL: "https://api.mainnet-beta.solana.com",
    };
    expect(commerceConfig(base)).toMatchObject({
      swapsEnabled: true,
      promotionsEnabled: true,
      promotionAmountRaw: "10000000000",
    });
    expect(
      commerceConfig({ ...base, FORUM_COMMERCE_TREASURY: "bad" }).swapsEnabled,
    ).toBe(false);
    expect(
      commerceConfig({
        ...base,
        FORUM_COMMERCE_RPC_URL: "http://localhost:4444",
      }).swapsEnabled,
    ).toBe(false);
    expect(
      commerceConfig({ ...base, FORUM_PLATFORM_FEE_BPS: "101" }).swapsEnabled,
    ).toBe(false);
    expect(
      commerceConfig({ ...base, FORUM_PROMOTION_AMOUNT_RAW: "0" })
        .promotionsEnabled,
    ).toBe(false);
    expect(
      commerceConfig({ ...base, FORUM_PROMOTION_AMOUNT_RAW: "3" })
        .promotionsEnabled,
    ).toBe(false);
  });
});
describe("five-lane paid placement queue", () => {
  test("only five placements overlap; the sixth gets the next free lane", () => {
    const rows: ReturnType<typeof allocatePromotionLane>[] = [];
    for (let i = 0; i < 6; i++)
      rows.push(allocatePromotionLane(1000, 86_400_000, rows));
    expect(rows.slice(0, 5).map((r) => r.lane)).toEqual([0, 1, 2, 3, 4]);
    expect(rows[5]).toEqual({
      lane: 0,
      startsAt: 86_401_000,
      endsAt: 172_801_000,
    });
  });
  test("fills real gaps, honors reservations, caps queue and rejects invalid duration", () => {
    expect(
      allocatePromotionLane(1000, 10, [
        { lane: 0, startsAt: 1020, endsAt: 1040 },
      ]),
    ).toEqual({ lane: 0, startsAt: 1000, endsAt: 1010 });
    expect(() =>
      allocatePromotionLane(
        1000,
        10,
        Array.from({ length: 5 }, (_, lane) => ({
          lane,
          startsAt: 1000,
          endsAt: 1_000 + 8 * 86_400_000,
        })),
      ),
    ).toThrow("full");
    expect(() => allocatePromotionLane(0, 0, [])).toThrow();
  });
});
describe("irreversible 50/50 promotion payment verification", () => {
  test("accepts one exact finalized treasury transfer plus a genuine same-source burn", () => {
    expect(verifyPromotionReceipt(receipt(), intent)).toEqual({
      valid: true,
      reason: "finalized",
      blockTime: 1_100_000,
    });
  });
  test.each([
    "mint",
    "amount",
    "burn",
    "source",
    "wallet",
    "treasury",
    "program",
    "memo",
    "time",
    "failed",
    "multiple",
  ])("holds %s mismatches instead of granting placement", (kind) => {
    const tx = receipt();
    if (kind === "mint")
      tx.transaction.message.instructions[0].parsed = {
        type: "transferChecked",
        info: {
          authority: wallet,
          source,
          destination,
          mint: source,
          tokenAmount: { amount: intent.treasuryAmountRaw, decimals: 6 },
        },
      } as never;
    if (kind === "amount")
      tx.transaction.message.instructions[0].parsed = {
        ...(tx.transaction.message.instructions[0].parsed as object),
        info: {
          authority: wallet,
          source,
          destination,
          mint: COMMERCE_MINT,
          tokenAmount: { amount: "1", decimals: 6 },
        },
      } as never;
    if (kind === "burn") tx.transaction.message.instructions.splice(1, 1);
    if (kind === "source")
      tx.transaction.message.instructions[1].parsed = {
        type: "burnChecked",
        info: {
          authority: wallet,
          account: destination,
          mint: COMMERCE_MINT,
          tokenAmount: { amount: intent.burnAmountRaw, decimals: 6 },
        },
      } as never;
    if (kind === "wallet")
      tx.transaction.message.accountKeys[0].pubkey = source;
    if (kind === "treasury") tx.meta.postTokenBalances[0].owner = wallet;
    if (kind === "program")
      tx.transaction.message.instructions[0].programId = source;
    if (kind === "memo")
      tx.transaction.message.instructions[2].parsed = "SYMF-PROMOTION:wrong";
    if (kind === "time") tx.blockTime = 1800;
    if (kind === "failed") tx.meta.err = "failed" as never;
    if (kind === "multiple")
      tx.transaction.message.instructions.push({
        ...tx.transaction.message.instructions[0],
      });
    expect(verifyPromotionReceipt(tx, intent).valid).toBe(false);
  });
  test("malformed bodies fail closed", () => {
    expect(verifyPromotionReceipt(null, intent).valid).toBe(false);
    expect(verifyPromotionReceipt({}, intent).valid).toBe(false);
  });
  test("a payer cannot use an approved delegate's unrelated source account", () => {
    const tx = receipt();
    tx.meta.preTokenBalances[0].owner = treasury;
    expect(verifyPromotionReceipt(tx, intent)).toMatchObject({
      valid: false,
      reason: "source_owner_mismatch",
    });
  });
});
