import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { isSolanaAddress, record } from "./forum-commerce";
import { getBase58Encoder } from "@solana/kit";

export const RESEARCH_PRODUCT = "solana-token-brief-v1";
export const RESEARCH_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const RESEARCH_ASSET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const RESEARCH_TREASURY = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
export const RESEARCH_AMOUNT = "100000";
export const RESEARCH_FACILITATOR = "https://facilitator.payai.network";
export const RESEARCH_CREDIT_RESERVE = 2;
export const RESEARCH_INTENT_TTL = 5 * 60_000;
export const RESEARCH_READINESS_TTL = 60 * 60_000;
export const RESEARCH_MAX_REPORT_AGE = 60 * 60_000;
export type ResearchState =
  | "quoted"
  | "verifying"
  | "settlement_claimed"
  | "unknown"
  | "fulfilled"
  | "rejected"
  | "expired";
export type ResearchReport = {
  product: typeof RESEARCH_PRODUCT;
  mint: string;
  title: string;
  generatedAt: number;
  metricsAsOf: number;
  facts: { label: string; value: string }[];
  analysis: string[];
  sources: { label: string; url: string }[];
  methodology: string;
};
export function researchSignatureValid(value: string) {
  try {
    return (
      /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value) &&
      getBase58Encoder().encode(value).length === 64
    );
  } catch {
    return false;
  }
}

export function researchResource(intentKey: string) {
  if (!/^[a-f0-9]{64}$/.test(intentKey))
    throw new Error("Invalid research identity.");
  return `https://forum.symbaiex.com/api/research/token/${intentKey}`;
}
export function researchRequirements(
  intentKey: string,
  feePayer: string,
): PaymentRequirements {
  if (!isSolanaAddress(feePayer) || feePayer === RESEARCH_TREASURY)
    throw new Error("Invalid facilitator identity.");
  return {
    scheme: "exact",
    network: RESEARCH_NETWORK,
    asset: RESEARCH_ASSET,
    amount: RESEARCH_AMOUNT,
    payTo: RESEARCH_TREASURY,
    maxTimeoutSeconds: 120,
    extra: {
      feePayer,
      memo: `symforum:research:${intentKey}`,
      transactionVersions: [0],
    },
  };
}
export function researchPaymentRequired(
  intentKey: string,
  requirements: PaymentRequirements,
): PaymentRequired {
  return {
    x402Version: 2,
    resource: {
      url: researchResource(intentKey),
      description:
        "One source-backed Solana token research brief and JSON export",
      mimeType: "application/json",
    },
    accepts: [requirements],
  };
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`)
    .join(",")}}`;
}
export async function researchHash(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalJson(value)),
      ),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export function exactResearchPayload(
  payload: unknown,
  requirements: PaymentRequirements,
  resource: string,
) {
  const row = record(payload);
  const body = record(row.payload);
  const location = record(row.resource);
  if (
    row.x402Version !== 2 ||
    canonicalJson(row.accepted) !== canonicalJson(requirements) ||
    location.url !== resource ||
    Object.keys(body).length !== 1 ||
    typeof body.transaction !== "string" ||
    body.transaction.length > 4096 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(body.transaction) ||
    row.extensions !== undefined
  )
    throw new Error("Payment does not match this research quote.");
  return body.transaction;
}
function safeSource(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
export function buildResearchReport(input: {
  mint: string;
  name: string;
  symbol: string;
  metricsAsOf: number;
  generatedAt: number;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume1hUsd: number | null;
  holders: number | null;
  priceChange1hPercent: number | null;
  sourceUrl: string;
  threadUrl: string;
}): ResearchReport {
  if (
    !isSolanaAddress(input.mint) ||
    !Number.isSafeInteger(input.metricsAsOf) ||
    input.metricsAsOf > input.generatedAt + 60_000 ||
    input.generatedAt - input.metricsAsOf > RESEARCH_MAX_REPORT_AGE
  )
    throw new Error(
      "Fresh source data is unavailable. No payment is required.",
    );
  const metric = (value: number | null, currency = false) =>
    value !== null && Number.isFinite(value)
      ? `${currency ? "$" : ""}${(value === 0 ? 0 : value).toLocaleString(
          "en-US",
          // Match raw market inspection's significant-digit convention below
          // the normal decimal floor, without rounding a nonzero fact to zero.
          // Plain decimals also remain readable in the JSON export without ARIA.
          value !== 0 && Math.abs(value) < 1e-8
            ? { maximumSignificantDigits: 21 }
            : { maximumFractionDigits: 8 },
        )}`
      : "Unavailable";
  const cap = input.marketCapUsd;
  const depth =
    cap !== null && cap > 0 && input.liquidityUsd !== null
      ? input.liquidityUsd / cap
      : null;
  const turnover =
    cap !== null && cap > 0 && input.volume1hUsd !== null
      ? input.volume1hUsd / cap
      : null;
  const sources = [
    { label: "Recorded market source", url: input.sourceUrl },
    { label: "Forum coverage", url: input.threadUrl },
  ].flatMap((item) => {
    const url = safeSource(item.url);
    return url ? [{ ...item, url }] : [];
  });
  if (sources.length !== 2)
    throw new Error("Citable source data is unavailable.");
  return {
    product: RESEARCH_PRODUCT,
    mint: input.mint,
    title: `${input.name.slice(0, 80)} (${input.symbol.slice(0, 20)}): source-backed brief`,
    generatedAt: input.generatedAt,
    metricsAsOf: input.metricsAsOf,
    facts: [
      { label: "Price (USD)", value: metric(input.priceUsd, true) },
      { label: "Market capitalization (not FDV)", value: metric(cap, true) },
      {
        label: "Reported pool liquidity",
        value: metric(input.liquidityUsd, true),
      },
      { label: "One-hour volume", value: metric(input.volume1hUsd, true) },
      { label: "Reported holders", value: metric(input.holders) },
      {
        label: "One-hour price change",
        value:
          input.priceChange1hPercent === null
            ? "Unavailable"
            : `${metric(input.priceChange1hPercent)}%`,
      },
    ],
    analysis: [
      depth === null
        ? "Liquidity-to-cap ratio cannot be calculated from the available data."
        : `Reported liquidity is ${(depth * 100).toFixed(2)}% of market capitalization. This is a depth indicator, not a guarantee of executable liquidity or safe exit.`,
      turnover === null
        ? "One-hour turnover cannot be calculated from the available data."
        : `One-hour reported volume equals ${(turnover * 100).toFixed(2)}% of market capitalization. High turnover can reflect activity or churn; it is not proof of organic demand.`,
      "Holder concentration, insider relationships, contract audit status and future returns are not established by these source metrics. Treat missing fields as unknown, not favorable.",
    ],
    sources,
    methodology:
      "Deterministic export of timestamped public observations and explicit arithmetic; no new model call. Coverage is sampled, not an exhaustive ranking. Prices are not quotes. This report is not investment advice or an endorsement. The $0.10 charge is for this versioned export, not access to otherwise-free forum content.",
  };
}
