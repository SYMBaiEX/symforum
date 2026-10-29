import {
  isSolanaAddress,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
} from "./forum-commerce";

export type DiscoveredToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tokenProgram: string;
  icon: string | null;
  verified: boolean;
};
/** Provider metadata is display/discovery only; selection still verifies the mint on-chain. */
export function parseDiscoveredTokens(body: unknown): DiscoveredToken[] {
  if (!Array.isArray(body)) throw new Error("Invalid token response.");
  const tokens: DiscoveredToken[] = [];
  for (const value of body.slice(0, 100)) {
    if (!value || typeof value !== "object") continue;
    const t = value as Record<string, unknown>;
    if (
      typeof t.id !== "string" ||
      !isSolanaAddress(t.id) ||
      typeof t.symbol !== "string" ||
      !t.symbol.trim() ||
      t.symbol.length > 24 ||
      typeof t.name !== "string" ||
      !t.name.trim() ||
      t.name.length > 100 ||
      !Number.isInteger(t.decimals) ||
      (t.decimals as number) < 0 ||
      (t.decimals as number) > 18 ||
      ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(String(t.tokenProgram))
    )
      continue;
    let icon: string | null = null;
    try {
      const url = new URL(String(t.icon));
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.href.length <= 500
      )
        icon = url.href;
    } catch {
      /* Optional untrusted image: fall back to initials. */
    }
    if (!tokens.some((x) => x.mint === t.id))
      tokens.push({
        mint: t.id,
        symbol: t.symbol.trim(),
        name: t.name.trim(),
        decimals: t.decimals as number,
        tokenProgram: String(t.tokenProgram),
        icon,
        verified: t.isVerified === true,
      });
  }
  return tokens.slice(0, 60);
}
