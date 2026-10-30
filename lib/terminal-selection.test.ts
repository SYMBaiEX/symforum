import { describe, expect, test } from "vitest";
import {
  parseTerminalMint,
  terminalRedirectForMint,
} from "./terminal-selection";

const mint = "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump";

describe("terminal URL identity", () => {
  test("only a missing parameter selects the default", () => {
    expect(parseTerminalMint([])).toEqual({ status: "default" });
    expect(terminalRedirectForMint(undefined)).toBe("/forum/trade");
  });

  test.each([
    mint,
    "So11111111111111111111111111111111111111112",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  ])("preserves the exact case-sensitive 32-byte address %s", (value) => {
    expect(parseTerminalMint([value])).toEqual({
      status: "valid",
      mint: value,
    });
    expect(terminalRedirectForMint(value)).toBe(`/forum/trade?mint=${value}`);
  });

  test.each([
    "",
    "invalid",
    "z".repeat(32),
    "z".repeat(44),
    "1".repeat(31),
    "1".repeat(33),
    ` ${mint}`,
    `${mint} `,
    `${mint}?outputMint=other`,
    "https://example.com/token",
    "javascript:alert(1)",
    "0".repeat(44),
  ])(
    "blocks malformed intent instead of choosing a different token: %s",
    (value) => {
      expect(parseTerminalMint([value])).toEqual({ status: "invalid" });
      expect(terminalRedirectForMint(value)).toBe("/forum/trade?mint=invalid");
    },
  );

  test("rejects duplicate parameters even when they repeat the same mint", () => {
    expect(parseTerminalMint([mint, mint])).toEqual({ status: "invalid" });
    expect(terminalRedirectForMint([mint, mint])).toBe(
      "/forum/trade?mint=invalid",
    );
  });
});
