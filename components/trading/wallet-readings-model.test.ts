import { expect, test } from "vitest";
import type { TerminalWalletReadState } from "@/lib/forum-terminal-model";
import {
  walletAmountLabel,
  walletSolReadings,
  WALLET_SOL_MINT,
} from "./wallet-readings-model";

const state = (
  overrides: Partial<TerminalWalletReadState> = {},
): TerminalWalletReadState => ({
  wallet: "fixture",
  checkedAt: 1,
  expiresAt: 2,
  slot: 3,
  balances: [{ mint: WALLET_SOL_MINT, rawAmount: "1000000000", decimals: 9 }],
  maxSolRaw: null,
  feeReserveLamports: null,
  ...overrides,
});

test("returned zero and precise raw amounts are not confused with unknown balances", () => {
  expect(walletAmountLabel("0", 9)).toBe("0");
  expect(walletAmountLabel("1", 9)).toBe("0.000000001");
  expect(walletAmountLabel("1", 0)).toBe("1");
  expect(walletAmountLabel("1", 18)).toBe("0.000000000000000001");
  expect(walletAmountLabel("18446744073709551615", 9)).toBe(
    "18446744073.709551615",
  );
});
test("malformed raw amounts and unsupported decimals remain unavailable", () => {
  for (const value of [
    undefined,
    null,
    0,
    123,
    "",
    "-1",
    "1.2",
    "1e9",
    "NaN",
    " 0",
    "0x10",
  ])
    expect(walletAmountLabel(value, 9)).toBe("Unavailable");
  for (const decimals of [undefined, null, "9", -1, 1.5, 19, NaN, Infinity])
    expect(walletAmountLabel("0", decimals)).toBe("Unavailable");
});
test("missing SOL is unavailable, not zero or an inferred spendable estimate", () => {
  expect(
    walletSolReadings(
      state({ balances: [], maxSolRaw: "1", feeReserveLamports: "0" }),
    ),
  ).toEqual({
    balance: "Unavailable",
    estimate: "Unavailable",
    reserve: "Unavailable",
  });
});
test("an actual zero SOL balance can retain a returned zero limit and zero reserve", () => {
  expect(
    walletSolReadings(
      state({
        balances: [{ mint: WALLET_SOL_MINT, rawAmount: "0", decimals: 9 }],
        maxSolRaw: "0",
        feeReserveLamports: "0",
      }),
    ),
  ).toEqual({ balance: "0", estimate: "0", reserve: "0" });
});
test("a coherent returned estimate and reserve are displayed without recalculation", () => {
  expect(
    walletSolReadings(
      state({ maxSolRaw: "800000000", feeReserveLamports: "200000000" }),
    ),
  ).toEqual({ balance: "1", estimate: "0.8", reserve: "0.2" });
});
test("missing, malformed or inconsistent limit fields cannot claim verified spendability", () => {
  for (const override of [
    { maxSolRaw: "800000000" },
    { maxSolRaw: "bad", feeReserveLamports: "1" },
    { maxSolRaw: "900000000", feeReserveLamports: "200000000" },
    { maxSolRaw: "0", feeReserveLamports: "-1" },
    {
      maxSolRaw: "0",
      feeReserveLamports: "0",
      balances: [{ mint: WALLET_SOL_MINT, rawAmount: "0", decimals: 18 }],
    },
  ])
    expect(walletSolReadings(state(override)).estimate).toBe("Unavailable");
});
