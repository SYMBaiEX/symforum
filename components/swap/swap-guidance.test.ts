import { expect, test } from "vitest";
import { parseTokenAmount, normalizeTokenAmount } from "@/lib/swap-amounts";
import { swapAmountHelp, swapAmountIssue } from "./swap-guidance";

test("amount guidance uses only known local parser messages", () => {
  expect(
    swapAmountIssue(new Error("This token supports at most 6 decimal places.")),
  ).toBe("This token supports at most 6 decimal places.");
  expect(swapAmountIssue(new Error("Amount is out of range."))).toContain(
    "greater than zero",
  );
  for (const reason of [
    null,
    new Error("private provider body"),
    new Error("This token supports at most 99 decimal places."),
  ])
    expect(swapAmountIssue(reason)).toBe(
      "Enter a positive decimal amount, without commas or an exponent.",
    );
});
test("unknown token precision stays unknown and valid precision is not rounded", () => {
  expect(swapAmountHelp("SOL", 9)).toContain("at most 9 decimal places");
  expect(swapAmountHelp("WHOLE", 0)).toContain("at most 0 decimal places");
  for (const decimals of [undefined, -1, 19, 1.5, NaN])
    expect(swapAmountHelp("TOKEN", decimals)).toContain("Choose a pay token");
});
test("existing exact parser and leading decimal normalization are unchanged", () => {
  expect(normalizeTokenAmount(".5")).toBe("0.5");
  expect(parseTokenAmount(".5", 9)).toBe("500000000");
  expect(parseTokenAmount("0.123456789", 9)).toBe("123456789");
  expect(() => parseTokenAmount("0.1234567891", 9)).toThrow("at most 9");
  for (const value of [".", "0", "-1", "1e3", "1,000", "18446744074"])
    expect(() => parseTokenAmount(value, 9)).toThrow();
});
