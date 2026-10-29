import { describe, expect, test } from "vitest";
import { normalizeTokenAmount, parseTokenAmount } from "./swap-amounts";
describe("exact leading-decimal amounts", () => {
  test.each([
    [".5", 9, "500000000"],
    [".000001", 6, "1"],
    ["0.5", 9, "500000000"],
    ["1.", 9, "1000000000"],
  ])("normalizes %s without floating point", (value, decimals, raw) => {
    expect(parseTokenAmount(String(value), Number(decimals))).toBe(raw);
  });
  test("only adds the missing zero", () => {
    expect(normalizeTokenAmount(".5")).toBe("0.5");
    expect(normalizeTokenAmount(".000000000000000001")).toBe(
      "0.000000000000000001",
    );
    expect(parseTokenAmount(".000000000000000001", 18)).toBe("1");
    expect(normalizeTokenAmount(".")).toBe(".");
  });
  test.each([
    ".",
    ".0",
    ".0000001",
    "-.5",
    ".5e1",
    " .5",
    "1..5",
    "00.5",
    "18446744073709551616",
  ])("rejects invalid or unsafe amount %s", (value) => {
    expect(() => parseTokenAmount(value, 6)).toThrow();
  });
});
