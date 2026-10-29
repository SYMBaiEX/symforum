import { expect, test } from "vitest";
import {
  publicSwapPreparationError,
  swapPreparationIssue,
  SwapRpcError,
  SWAP_PREPARATION_MESSAGES,
} from "./swap-preparation-errors";
import { swapRpc } from "./swap-rpc";
test.each([
  [403, "rpc_blocked"],
  [429, "rpc_rate_limited"],
  [500, "rpc_unavailable"],
] as const)(
  "classifies RPC HTTP %s without exposing the body or retrying",
  async (status, code) => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return new Response("secret provider body", { status });
    };
    try {
      await swapRpc(
        "https://rpc.example?api-key=private",
        "getAccountInfo",
        [],
        fetcher,
      );
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(SwapRpcError);
      expect(swapPreparationIssue(error)).toBe(code);
      expect(String(error)).not.toMatch(/secret|private/);
    }
    expect(calls).toBe(1);
  },
);
test("never forwards arbitrary server/provider error text", () => {
  expect(publicSwapPreparationError({ data: "private provider body" })).toBe(
    SWAP_PREPARATION_MESSAGES.preparation_not_completed,
  );
  expect(
    publicSwapPreparationError({ data: SWAP_PREPARATION_MESSAGES.rpc_blocked }),
  ).toBe(SWAP_PREPARATION_MESSAGES.rpc_blocked);
  expect(
    swapPreparationIssue(
      new Error("Simulation failed. Nothing was signed or sent."),
    ),
  ).toBe("simulation_failed");
  expect(
    swapPreparationIssue(new Error("Quote expired. Review a fresh quote.")),
  ).toBe("quote_expired");
});
