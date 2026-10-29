import { installation } from "./installation";
/** One owner-configured identity. Historical payment records retain their mint. */
export const SYMF_TOKEN = installation.token;
export const TOKEN_CONFIGURED = Boolean(SYMF_TOKEN.mint);

export const SYMF_PUMP_URL = `https://pump.fun/coin/${SYMF_TOKEN.mint}`;
export const SYMF_EXPLORER_URL = `https://solscan.io/token/${SYMF_TOKEN.mint}`;
export const SYMF_CHART_URL = `https://dexscreener.com/solana/${SYMF_TOKEN.pool}`;
