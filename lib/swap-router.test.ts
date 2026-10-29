import { describe, expect, test } from "vitest";
import {
  collectSwapQuotes,
  validateSwapRequest,
  rawAmount,
  SOL_MINT,
  USDC_MINT,
  type SwapRequest,
} from "./swap-router";
import { parseTokenAmount, formatTokenAmount } from "./swap-amounts";
const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
const request: SwapRequest = {
  wallet,
  inputMint: SOL_MINT,
  outputMint: USDC_MINT,
  amountRaw: "10000000",
  slippageBps: 50,
  platformFeeBps: 25,
  supportsV1: false,
};
function response(
  provider: "jupiter" | "raydium",
  out = "1000000",
  overrides: Record<string, unknown> = {},
) {
  const common = {
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    slippageBps: 50,
    otherAmountThreshold: ((BigInt(out) * 9950n) / 10000n).toString(),
    priceImpactPct: "0.001",
  };
  return provider === "jupiter"
    ? {
        ...common,
        inAmount: "9975000",
        outAmount: out,
        swapMode: "ExactIn",
        routePlan: [{ swapInfo: { ammKey: wallet, label: "Pool" } }],
        ...overrides,
      }
    : {
        success: true,
        data: {
          ...common,
          inputAmount: "9975000",
          outputAmount: out,
          swapType: "BaseIn",
          referrerAmount: "0",
          routePlan: [{ poolId: wallet }],
          ...overrides,
        },
      };
}
const config = {
  rpcUrl: "https://api.mainnet-beta.solana.com",
  treasury: wallet,
};
const fake =
  (j: unknown, r: unknown): typeof fetch =>
  async (input) =>
    Response.json(String(input).includes("jup.ag") ? j : r);
describe("swap quote validation", () => {
  test("the entered amount includes the exact platform fee", () => {
    expect(validateSwapRequest(request)).toEqual({
      total: 10000000n,
      fee: 25000n,
      swap: 9975000n,
    });
  });
  test("fee waiver changes only the platform fee", () => {
    expect(validateSwapRequest({ ...request, platformFeeBps: 0 }).swap).toBe(
      10000000n,
    );
  });
  test.each(["-1", "1e10", "1.1", "01", "18446744073709551616", ""])(
    "rejects invalid raw %s",
    (value) => {
      expect(() => rawAmount(value)).toThrow();
    },
  );
  test.each([
    { slippageBps: 501 },
    { slippageBps: 0 },
    { platformFeeBps: 101 },
    { outputMint: SOL_MINT },
    { wallet: "not-a-wallet" },
  ])("rejects unsafe request %j", (change) => {
    expect(() => validateSwapRequest({ ...request, ...change })).toThrow();
  });
  test("compares both providers without a paid API key, preserving exact bigint ordering", async () => {
    const data = await collectSwapQuotes(
      request,
      config,
      fake(
        response("jupiter", "9007199254740994"),
        response("raydium", "9007199254740993"),
      ),
    );
    expect(data.failures).toEqual([]);
    expect(data.quotes.map((q) => q.provider)).toEqual(["jupiter", "raydium"]);
    expect(data.quotes[0].platformFeeRaw).toBe("25000");
  });
  test.each([
    { inAmount: "10000000" },
    { outputMint: SOL_MINT },
    { swapMode: "ExactOut" },
    { slippageBps: 100 },
    { otherAmountThreshold: "990000" },
    { otherAmountThreshold: "1000000" },
    { priceImpactPct: "5.01" },
    { priceImpactPct: "NaN" },
  ])("rejects mismatched or unsafe Jupiter quote %j", async (change) => {
    const data = await collectSwapQuotes(
      request,
      config,
      fake(response("jupiter", "1000000", change), response("raydium")),
    );
    expect(data.quotes.map((q) => q.provider)).toEqual(["raydium"]);
    expect(data.failures).toHaveLength(1);
  });
  test("does not advertise a provider rounded minimum above the enforced floor", async () => {
    const d = await collectSwapQuotes(
      request,
      config,
      fake(
        response("jupiter", "1000000", { otherAmountThreshold: "995001" }),
        response("raydium"),
      ),
    );
    expect(d.quotes[0].minimumOutputAmountRaw).toBe("995000");
  });
  test("rejects hidden Raydium referrer fee", async () => {
    const d = await collectSwapQuotes(
      request,
      config,
      fake(
        response("jupiter"),
        response("raydium", "1000000", { referrerAmount: "1" }),
      ),
    );
    expect(d.quotes.map((q) => q.provider)).toEqual(["jupiter"]);
  });
  test("provider errors stay generic without leaking bodies", async () => {
    const d = await collectSwapQuotes(
      request,
      config,
      async () => new Response("private provider error", { status: 400 }),
    );
    expect(d.quotes).toEqual([]);
    expect(JSON.stringify(d)).not.toContain("private");
  });
});
describe("exact token formatting", () => {
  test("parses token amounts without floating point loss", () => {
    expect(parseTokenAmount("9007199254.740993", 6)).toBe("9007199254740993");
    expect(formatTokenAmount("9007199254740993", 6)).toBe(
      "9,007,199,254.740993",
    );
  });
  test.each(["1e3", "-3", "NaN", "0", "0.0000001"])(
    "rejects %s for six decimals",
    (n) => expect(() => parseTokenAmount(n, 6)).toThrow(),
  );
});
