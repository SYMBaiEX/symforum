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
import type {
  TokenAlert,
  WatchToken,
} from "../../../components/trading/terminal-api";
import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// Freeze only fixture scenario flags, not real URL navigation or mint state.
// Preserve legacy substring scenarios (e.g. marketrefreshmissing also enables
// marketrefresh); these values must never become application auth settings.
export const fixtureFlags = new Set(
  [
    "alertackfail",
    "authloading",
    "currentcohort",
    "empty",
    "guest",
    "held",
    "highimpact",
    "longhistory",
    "longorder",
    "marketloading",
    "marketrefresh",
    "marketrefreshbudget",
    "marketrefreshdeferred",
    "marketrefresherror",
    "marketrefreshloading",
    "marketrefreshmissing",
    "oldsample",
    "orderinput",
    "orderquote",
    "receiptsempty",
    "receiptsloading",
    "research",
    "samplealerts",
    "settingsloading",
    "stalerisk",
    "tipsavailable",
    "tipsloading",
  ].filter((flag) => location.search.includes(flag)),
);

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
const acknowledgedAlerts = new Set<string>();
let researchVerified = false;
let refreshedMarketRows = false;
let marketCheckedAt: number | null = null;
const marketRefreshArguments: Record<string, unknown>[] = [];
const marketRefreshAdmissions: number[] = [];
let signedOut = false;
const queryNames: string[] = [];
const operationCalls: string[] = [];
Object.assign(window, {
  __terminalFixtureQueries: queryNames,
  __terminalFixtureCalls: operationCalls,
  __terminalFixtureMarketRefreshArgs: marketRefreshArguments,
  __terminalFixtureMarketRefreshAdmissions: marketRefreshAdmissions,
});
window.addEventListener("terminal-fixture:signout", () => {
  signedOut = true;
  revision++;
  listeners.forEach((listener) => listener());
});
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
// A bounded hourly cohort, not a simulated provider or an invented ranking.
// Display timestamps must retain these source ages even when the UI clock ticks.
const currentCohort: TerminalMarket[] = [..."23456789AB"].map(
  (suffix, index) => ({
    ...symf,
    mint: `${"1".repeat(31)}${suffix}`,
    symbol: `FRESH${index + 1}`,
    name: `Invented hourly observation ${index + 1}`,
    platform: index < 5 ? "pumpfun" : "bags",
    observedAt: now,
    metricsAsOf: now - (index + 1) * 60_000,
    marketCapUsd: index === 9 ? null : 55_000 + index * 10_000,
    fdvUsd: 950_000,
    volume1hUsd: 100_000 - index * 1_000,
    sourceUrl: `https://example.com/observation/${index + 1}`,
  }),
);
const selectedMarketRows = () =>
  fixtureFlags.has("currentcohort") ? currentCohort : marketRows;
function displayedMarket(token: TerminalMarket): TerminalMarket {
  if (!refreshedMarketRows || token.mint !== nova.mint) return token;
  const unavailable = fixtureFlags.has("marketrefreshmissing");
  return {
    ...token,
    priceUsd: unavailable ? null : 0.0042,
    marketCapUsd: null,
    fdvUsd: unavailable ? null : 9_000_000,
    liquidityUsd: unavailable ? null : 45_000,
    volume1hUsd: unavailable ? null : 123_000,
    volume24hUsd: unavailable ? null : 234_000,
    priceChange1hPercent: unavailable ? null : -5,
    marketData: {
      state: unavailable ? "unavailable" : "available",
      checkedAt: marketCheckedAt ?? now,
      sourceUrl: unavailable ? null : "https://example.com/checked-market-pool",
    },
  };
}
export function useConvexAuth() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    isAuthenticated:
      !signedOut &&
      !fixtureFlags.has("guest") &&
      !fixtureFlags.has("authloading"),
    isLoading: fixtureFlags.has("authloading"),
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
  queryNames.push(name);
  let result: unknown;
  if (name === "forumCommunity:listProjectPage")
    return {
      page: fixtureFlags.has("empty") ? [] : projects,
      isDone: true,
      continueCursor: "",
    } as FunctionReturnType<Ref>;
  if (name === "forumCommunity:listProjects")
    result = fixtureFlags.has("empty") ? [] : projects;
  else if (name === "forumCommunity:listBounties")
    result = (fixtureFlags.has("empty") ? [] : works).filter(
      (work) => !input.status || work.status === input.status,
    );
  else if (name === "forumCommunity:listPayments")
    result = fixtureFlags.has("receiptsloading")
      ? undefined
      : fixtureFlags.has("receiptsempty")
        ? []
        : [protectedPayment];
  else if (name === "forumCommunity:getPayment") result = protectedPayment;
  else if (name === "forumCommunity:getMine")
    result =
      fixtureFlags.has("settingsloading") && fixtureFlags.has("orderinput")
        ? undefined
        : ({
            userId: memberId,
            recipient: null,
            supporter: null,
          } satisfies FunctionReturnType<typeof api.forumCommunity.getMine>);
  else if (name === "forumCommunity:listSubmissions") result = [];
  else if (name === "forumCommunity:listTipRecipients")
    result = fixtureFlags.has("tipsloading")
      ? undefined
      : fixtureFlags.has("tipsavailable")
        ? [
            {
              userId: memberId,
              username: "fixture_author",
              wallet: "11111111111111111111111111111111",
            },
          ]
        : [];
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
    const rows = (fixtureFlags.has("empty") ? [] : selectedMarketRows()).map(
      displayedMarket,
    );
    result = fixtureFlags.has("marketloading")
      ? undefined
      : {
          markets: rows.filter(
            (token) =>
              matchesMarketCap(
                token.marketCapUsd,
                (input.band ?? "all") as MarketCapBand,
              ) &&
              (!input.platform || token.platform === input.platform),
          ),
          sampledAt: now,
          stale: fixtureFlags.has("oldsample"),
          coverage: "sampled",
          band: input.band ?? "all",
        };
  } else if (name === "forumTerminal:getMarket")
    result =
      selectedMarketRows()
        .map(displayedMarket)
        .find((token) => token.mint === input.mint) ?? null;
  else if (name === "forumTerminal:getRisk")
    result = fixtureFlags.has("stalerisk")
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
  else if (name === "forumTerminal:listAlerts")
    result = fixtureFlags.has("samplealerts")
      ? [nova, quiet].map((token, index): TokenAlert => ({
          id: `fixture-alert-${index}`,
          mint: token.mint,
          symbol: "SAMPLE",
          direction: "above",
          thresholdUsd: 0.0001,
          priceUsd: 0.0002,
          observedAt: now - 120_000,
          acknowledged: acknowledgedAlerts.has(`fixture-alert-${index}`),
        }))
      : [];
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
  else if (
    name === "forumCommerce:getConfig" &&
    (fixtureFlags.has("orderinput") || fixtureFlags.has("orderquote"))
  )
    result = {
      swapsEnabled: fixtureFlags.has("orderquote"),
      automaticPostTokens: true,
      promotionCalendar: true,
      signatureFirstEnabled: true,
      managedEnabled: true,
      promotionsEnabled: false,
      treasury: null,
      platformFeeBps: 50,
      promotionAmountRaw: "10000000000",
      promotionDurationMs: 86_400_000,
      promotionBurnBps: 5000,
      holderThresholdUsd: 1,
      holderCacheTtlMs: 60_000,
      holderDiscountEnabled: false,
      maxPromotedPerBoard: 5,
      symfMint: SYMF_TOKEN.mint,
    } satisfies FunctionReturnType<typeof api.forumCommerce.getConfig>;
  else if (
    name === "forumCommerce:searchTokens" &&
    (fixtureFlags.has("orderinput") || fixtureFlags.has("orderquote"))
  )
    result = [
      {
        mint: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        name: "Solana",
        decimals: 9,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      },
    ];
  else if (name === "forumSwaps:listMine")
    result = fixtureFlags.has("held")
      ? Array.from(
          { length: fixtureFlags.has("longhistory") ? 30 : 1 },
          (_, index) => ({
            quoteId: `isolated-quote${index ? `-${index}` : ""}`,
            wallet: "11111111111111111111111111111111",
            status: "held",
            signature: null,
            inputMint: "So11111111111111111111111111111111111111112",
            outputMint: SYMF_TOKEN.mint,
            amountRaw: "10000",
            createdAt: now,
            issue: null,
          }),
        )
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
      operationCalls.push(`mutation:${name}`);
      const input = args as Record<string, unknown>;
      if (name === "forumTerminal:setWatchlist") {
        const existing = watches.find((entry) => entry.mint === input.mint);
        const high =
          input.priceAboveUsd === undefined
            ? (existing?.priceAboveUsd ?? null)
            : (input.priceAboveUsd as number | null);
        const low =
          input.priceBelowUsd === undefined
            ? (existing?.priceBelowUsd ?? null)
            : (input.priceBelowUsd as number | null);
        if (
          input.enabled &&
          ([high, low].some(
            (value) => value != null && (!Number.isFinite(value) || value <= 0),
          ) ||
            (high != null && low != null && high <= low))
        )
          throw new Error("Invented merged watch threshold validation failure");
        watches = watches.filter((entry) => entry.mint !== input.mint);
        if (input.enabled)
          watches.push({
            mint: String(input.mint),
            symbol: null,
            priceAboveUsd: high,
            priceBelowUsd: low,
            updatedAt: Date.now(),
          });
        revision++;
        listeners.forEach((listener) => listener());
        return null as FunctionReturnType<Ref>;
      }
      if (name === "forumTerminal:acknowledgeAlert") {
        if (fixtureFlags.has("alertackfail"))
          throw new Error("Invented alert acknowledgement failure");
        acknowledgedAlerts.add(String(input.id));
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
      operationCalls.push(`action:${name}`);
      if (name === "forumTerminalRefresh:refresh") {
        marketRefreshArguments.push(_args as Record<string, unknown>);
        if (
          fixtureFlags.has("marketrefreshdeferred") &&
          marketRefreshArguments.length === 1
        )
          return {
            state: "deferred",
            checkedAt: null,
            nextRefreshAt: Date.now() + 1500,
          } as FunctionReturnType<Ref>;
        if (fixtureFlags.has("marketrefresherror"))
          throw new Error("Invented shared refresh failure");
        const state = fixtureFlags.has("marketrefreshbudget")
          ? "budget"
          : fixtureFlags.has("marketrefreshloading")
            ? "loading"
            : "ready";
        if (state === "ready" && fixtureFlags.has("marketrefresh")) {
          marketRefreshAdmissions.push(Date.now());
          refreshedMarketRows = true;
          marketCheckedAt = Date.now();
          revision++;
          listeners.forEach((listener) => listener());
        }
        return {
          state,
          checkedAt: marketCheckedAt,
          nextRefreshAt: Date.now() + (state === "loading" ? 1500 : 600_000),
        } as FunctionReturnType<Ref>;
      }
      if (fixtureFlags.has("orderinput") || fixtureFlags.has("orderquote")) {
        if (name === "forumTerminal:getWalletReadState")
          return null as FunctionReturnType<Ref>;
        if (name === "forumCommerce:resolveMint")
          return {
            mint: (_args as { mint: string }).mint,
            symbol: fixtureFlags.has("longorder")
              ? "LONGCOMMUNITYTOKEN"
              : "SYMF",
            name: fixtureFlags.has("longorder")
              ? "Invented unusually long community token name for viewport coverage"
              : "Invented fixture token",
            decimals: 6,
            tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          } as FunctionReturnType<Ref>;
      }
      if (name === "forumSwaps:quote" && fixtureFlags.has("orderquote")) {
        const request = _args as {
          inputMint: string;
          outputMint: string;
          amountRaw: string;
        };
        return {
          quotes: [
            {
              quoteId: "fixture-geometry-quote" as Id<"forumSwapQuotes">,
              provider: "jupiter",
              execution: "jupiter-managed",
              fees: {
                feeMint: request.outputMint,
                totalFeeBps: 50,
                integratorFeeBps: 50,
                jupiterFeeBps: 0,
              },
              inputMint: request.inputMint,
              outputMint: request.outputMint,
              amountRaw: request.amountRaw,
              swapAmountRaw: request.amountRaw,
              platformFeeRaw: "5000000",
              outputAmountRaw: fixtureFlags.has("longorder")
                ? "9876543210123456"
                : "123456789",
              minimumOutputAmountRaw: fixtureFlags.has("longorder")
                ? "9827160494072838"
                : "122839505",
              priceImpactBps: fixtureFlags.has("highimpact") ? 250 : 25,
              platformFeeBps: 50,
              routeLabels: ["Invented geometry route"],
              expiresAt: Date.now() + 30_000,
            },
          ],
          failures: [],
          benefitEligible: false,
          benefitStatus: "unavailable",
          platformFeeBps: 50,
        } as FunctionReturnType<Ref>;
      }
      if (
        name === "forumResearchActions:check" &&
        fixtureFlags.has("research")
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
export function useConvex() {
  return {
    query: async () => {
      throw new Error("Unexpected directory page read");
    },
  };
}
