import { expect, test } from "vitest";
import { parseDiscoveredTokens } from "./swap-token-discovery";
import { TOKEN_PROGRAM } from "./forum-commerce";
const token = {
  id: "So11111111111111111111111111111111111111112",
  name: "Solana",
  symbol: "SOL",
  decimals: 9,
  tokenProgram: TOKEN_PROGRAM,
  isVerified: true,
  icon: "https://example.com/sol.png",
};
test("token discovery is bounded and never trusts invalid identities or programs", () => {
  expect(parseDiscoveredTokens([token, token])).toHaveLength(1);
  expect(
    parseDiscoveredTokens([
      { ...token, id: "fake" },
      { ...token, tokenProgram: "fake" },
      { ...token, decimals: 255 },
    ]),
  ).toEqual([]);
  expect(() => parseDiscoveredTokens({ error: "failure" })).toThrow();
});
test("icons and provider verification are strictly normalized", () => {
  expect(
    parseDiscoveredTokens([
      { ...token, icon: "javascript:alert(1)", isVerified: "true" },
    ])[0],
  ).toMatchObject({ icon: null, verified: false });
  expect(
    parseDiscoveredTokens([
      { ...token, icon: "https://user:pass@example.com/icon" },
    ])[0].icon,
  ).toBeNull();
});
