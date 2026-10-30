import {
  getFunctionName,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { useCallback, useSyncExternalStore } from "react";
import {
  matchesMarketCap,
  type MarketCapBand,
} from "../../../lib/forum-market-cap";
import type { TerminalMarket } from "../../../lib/forum-terminal-model";
import { SYMF_TOKEN } from "../../../lib/symf-token";
import type { WatchToken } from "../../../components/trading/terminal-api";
import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snapshot = () => revision;
let watches: WatchToken[] = [];
let researchVerified = false;
const now = Date.now();
// These branded IDs and identities are invented; no fixture can open a transport.
const memberId = "fixture-member" as Id<"users">;
const projects = [
  {
    projectId: "fixture-project" as Id<"forumCommunityProjects">,
    mint: SYMF_TOKEN.mint,
    name: "Fixture research collective",
    symbol: "DEMO",
    claims: [
      {
        userId: memberId,
        username: "fixture_builder",
        role: "Researcher",
        description:
          "An invented project affiliation for isolated interface coverage.",
        website: "https://example.com/fixture",
        updatedAt: now,
      },
    ],
  },
] satisfies FunctionReturnType<typeof api.forumCommunity.listProjects>;
const works = [
  {
    workId: "fixture-work" as Id<"forumCommunityWork">,
    sponsorId: "fixture-sponsor" as Id<"users">,
    sponsor: "fixture_sponsor",
    mint: SYMF_TOKEN.mint,
    kind: "research",
    title: "Review a simulated token report",
    brief:
      "Document the source timestamps and distinguish market cap from diluted value.",
    amountLamports: "250000000",
    status: "open",
    selectedSubmissionId: null,
    updatedAt: now,
  },
] satisfies FunctionReturnType<typeof api.forumCommunity.listBounties>;
const protectedPayment = {
  intentId: "fixture-held-payment" as Id<"forumCommunityPayments">,
  wallet: "11111111111111111111111111111111",
  recipient: "11111111111111111111111111111111",
  amountLamports: "250000000",
  purpose: "reward",
  reference: "11111111111111111111111111111111",
  memo: "isolated-fixture",
  createdAt: now,
  expiresAt: now - 1,
  status: "held",
  signature: null,
  issue: null,
  finalizedAt: null,
  workId: works[0].workId,
} satisfies FunctionReturnType<typeof api.forumCommunity.preparePayment>;
const symf: TerminalMarket = {
  mint: SYMF_TOKEN.mint,
  symbol: SYMF_TOKEN.symbol,
  name: SYMF_TOKEN.name,
  platform: "pumpfun",
  observedAt: now,
  metricsAsOf: now - 120_000,
  priceUsd: 0.00006,
  marketCapUsd: 60_000,
  fdvUsd: 80_000,
  liquidityUsd: 12_000,
  volume1hUsd: 30_000,
  volume24hUsd: 100_000,
  holders: 123,
  priceChange1hPercent: 12.5,
  imageUrl: null,
  website: "https://example.com/project",
  twitter: "https://x.com/example",
  telegram: null,
  description:
    "A simulated token record used only by this isolated browser test.",
  sourceUrl: "https://example.com/source",
  sourceRank: 1,
  threadId: null,
  threadUrl: "/crypto-pumpfun/fixture-discussion",
};
const nova: TerminalMarket = {
  ...symf,
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  symbol: "NOVA",
  name: "Simulated research token",
  marketCapUsd: 700_000,
  fdvUsd: 9_000_000,
  priceUsd: 0.0007,
  liquidityUsd: 42_000,
  volume1hUsd: 90_000,
  volume24hUsd: 900_000,
  holders: 456,
  priceChange1hPercent: -3.25,
  platform: "bags",
  metricsAsOf: now - 3_600_000,
  threadUrl: null,
};
const quiet: TerminalMarket = {
  ...symf,
  mint: "So11111111111111111111111111111111111111112",
  symbol: "QUIET",
  name: "Simulated low-volume token",
  marketCapUsd: 90_000,
  fdvUsd: 1_000_000,
  priceUsd: 0.00009,
  liquidityUsd: 8_000,
  volume1hUsd: 5_000,
  volume24hUsd: 60_000,
  holders: 25,
  priceChange1hPercent: 0,
  sourceUrl: "javascript:alert('fixture-only')",
};
const missing: TerminalMarket = {
  ...symf,
  mint: "11111111111111111111111111111111",
  symbol: "UNKNOWN",
  name: "Simulated missing-metrics token",
  marketCapUsd: null,
  fdvUsd: 900_000,
  priceUsd: null,
  liquidityUsd: null,
  volume1hUsd: null,
  volume24hUsd: null,
  holders: null,
  priceChange1hPercent: null,
  sourceUrl: "https://user:fixture@example.com/not-public",
};
const marketRows = [symf, nova, quiet, missing];
export function useConvexAuth() {
  return {
    isAuthenticated: !location.search.includes("guest"),
    isLoading: false,
  };
}
export function useQuery<Ref extends FunctionReference<"query">>(
  ref: Ref,
  args: FunctionArgs<Ref> | "skip",
): FunctionReturnType<Ref> | undefined {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  if (args === "skip") return undefined;
  const input = args as Record<string, unknown>;
  const name = getFunctionName(ref);
  let result: unknown;
  if (name === "forumCommunity:listProjects")
    result = location.search.includes("empty") ? [] : projects;
  else if (name === "forumCommunity:listBounties")
    result = (location.search.includes("empty") ? [] : works).filter(
      (work) => !input.status || work.status === input.status,
    );
  else if (name === "forumCommunity:listPayments") result = [protectedPayment];
  else if (name === "forumCommunity:getPayment") result = protectedPayment;
  else if (name === "forumCommunity:getMine")
    result = {
      userId: memberId,
      recipient: null,
      supporter: null,
    } satisfies FunctionReturnType<typeof api.forumCommunity.getMine>;
  else if (
    name === "forumCommunity:listSubmissions" ||
    name === "forumCommunity:listTipRecipients"
  )
    result = [];
  else if (name === "forumResearch:getConfig")
    result = {
      enabled: true,
      amountRaw: "100000",
      asset: "USDC",
      network: "solana",
      product: "solana-token-brief-v1",
      priceLabel: "$0.10 USDC",
      reason: "ready",
    };
  else if (name === "forumResearch:listMine")
    result = [
      {
        intentKey: "a".repeat(64),
        mint: SYMF_TOKEN.mint,
        state: researchVerified ? "fulfilled" : "unknown",
        createdAt: now,
        expiresAt: now - 1,
        signature: "2".repeat(88),
        finalizedAt: researchVerified ? now : null,
        report: null,
      },
    ];
  else if (name === "forumTerminal:listMarket") {
    const rows = location.search.includes("empty") ? [] : marketRows;
    result = {
      markets: rows.filter(
        (token) =>
          matchesMarketCap(
            token.marketCapUsd,
            (input.band ?? "all") as MarketCapBand,
          ) &&
          (!input.platform || token.platform === input.platform),
      ),
      sampledAt: now,
      stale: false,
      coverage: "sampled",
      band: input.band ?? "all",
    };
  } else if (name === "forumTerminal:getMarket")
    result = marketRows.find((token) => token.mint === input.mint) ?? null;
  else if (name === "forumTerminal:getRisk")
    result = location.search.includes("stalerisk")
      ? {
          mint: input.mint,
          checkedAt: now - 1_200_000,
          mintAuthority: null,
          freezeAuthority: null,
          tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          unsupportedExtensions: [],
          status: "checked",
        }
      : null;
  else if (name === "forumTerminal:listWatchlist") result = watches;
  else if (name === "forumTerminal:listAlerts") result = [];
  else if (name === "forumTerminalTransparency:getTransparency")
    result = {
      mint: SYMF_TOKEN.mint,
      decimals: 6,
      treasury: "11111111111111111111111111111111",
      promotionAmountRaw: "0",
      treasuryAmountRaw: "0",
      burnAmountRaw: "0",
      verifiedPromotions: 0,
      latestVerifiedAt: null,
      receipts: [],
      coverage: "verified-promotion-receipts",
      historyComplete: false,
    };
  else if (name === "forumSwaps:listMine")
    result = location.search.includes("held")
      ? [
          {
            quoteId: "isolated-quote",
            wallet: "11111111111111111111111111111111",
            status: "held",
            signature: null,
            inputMint: "So11111111111111111111111111111111111111112",
            outputMint: SYMF_TOKEN.mint,
            amountRaw: "10000",
            createdAt: now,
            issue: null,
          },
        ]
      : [];
  else throw new Error(`Unmocked terminal query: ${name}`);
  return result as FunctionReturnType<Ref>;
}
export function useMutation<Ref extends FunctionReference<"mutation">>(
  ref: Ref,
) {
  const name = getFunctionName(ref);
  return useCallback(
    async (args: FunctionArgs<Ref>) => {
      const input = args as Record<string, unknown>;
      if (name === "forumTerminal:setWatchlist") {
        watches = watches.filter((entry) => entry.mint !== input.mint);
        if (input.enabled)
          watches.push({
            mint: String(input.mint),
            symbol: null,
            priceAboveUsd: input.priceAboveUsd as number | null,
            priceBelowUsd: input.priceBelowUsd as number | null,
            updatedAt: Date.now(),
          });
        revision++;
        listeners.forEach((listener) => listener());
        return null as FunctionReturnType<Ref>;
      }
      throw new Error(`Unmocked terminal mutation: ${name}`);
    },
    [name],
  );
}
export function useAction<Ref extends FunctionReference<"action">>(ref: Ref) {
  const name = getFunctionName(ref);
  return useCallback(
    async (_args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>> => {
      if (
        name === "forumResearchActions:check" &&
        location.search.includes("research")
      ) {
        researchVerified = true;
        revision++;
        listeners.forEach((listener) => listener());
        return true as FunctionReturnType<Ref>;
      }
      throw new Error(
        `No wallet or RPC action authorized in terminal UI fixture: ${name}`,
      );
    },
    [name],
  );
}
