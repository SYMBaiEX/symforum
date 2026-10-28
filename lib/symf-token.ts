/** Current official Pump.fun mint. The historical Bags token is separate. */
export const SYMF_TOKEN = {
  name: "SYMBaiEX Forum",
  symbol: "SYMF",
  mint: "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
  // Verified against DEX Screener's Solana token-pairs response on 2026-10-28.
  pool: "BqkubRUbgk13q1imaVhKkSVZqrBoVXGc5LJi8JCL8CZr",
  announcementPath:
    "/forum/crypto-pumpfun/introducing-symf-the-new-official-symbaiex-forum-token-on-pump-fun",
} as const;

export const SYMF_PUMP_URL = `https://pump.fun/coin/${SYMF_TOKEN.mint}`;
export const SYMF_EXPLORER_URL = `https://solscan.io/token/${SYMF_TOKEN.mint}`;
export const SYMF_CHART_URL = `https://dexscreener.com/solana/${SYMF_TOKEN.pool}`;
