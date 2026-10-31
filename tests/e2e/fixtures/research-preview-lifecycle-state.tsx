import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import {
  buildResearchReport,
  researchRequirements,
  researchResource,
  RESEARCH_ASSET,
  RESEARCH_NETWORK,
  RESEARCH_INTENT_TTL,
  type ResearchState,
} from "../../../lib/forum-research";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
export const mintA = "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump";
export const mintB = "So11111111111111111111111111111111111111112";
const intent = "a".repeat(64),
  wallet = "11111111111111111111111111111111";
type Mode = "ready" | "setup" | "exhausted" | "loading";
const params = new URLSearchParams(location.search);
let state = {
  mint: mintA,
  authenticated: !params.has("guest"),
  linked: !params.has("guest") && !params.has("unlinked"),
  walletLoading: false,
  mode: "ready" as Mode,
  receiptState: "quoted" as ResearchState,
  historyState: (params.has("saved-fulfilled")
    ? "fulfilled"
    : null) as ResearchState | null,
  signature: null as string | null,
  expiresAt: Date.now() + RESEARCH_INTENT_TTL,
  deferQuote: false,
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export function useFixtureState() {
  return useSyncExternalStore(subscribe, () => state);
}
const reads: { name: string; args: unknown }[] = [],
  actions: { name: string; args: unknown }[] = [],
  forbidden: string[] = [];
let releaseQuote: (() => void) | undefined;
function receipt(status: ResearchState, mint = state.mint) {
  return {
    intentKey: intent,
    mint,
    state: status,
    createdAt: Date.now() - 1000,
    expiresAt: state.expiresAt,
    signature: state.signature,
    finalizedAt: status === "fulfilled" ? Date.now() : null,
    report:
      status === "fulfilled"
        ? buildResearchReport({
            mint,
            name: "Invented lifecycle fixture",
            symbol: "TEST",
            generatedAt: Date.now(),
            metricsAsOf: Date.now(),
            priceUsd: null,
            marketCapUsd: null,
            liquidityUsd: null,
            volume1hUsd: null,
            holders: null,
            priceChange1hPercent: null,
            sourceUrl: "https://example.com/fixture-market",
            threadUrl: "https://example.com/fixture-forum",
          })
        : null,
  };
}
export const fixture = {
  update,
  reads,
  actions,
  forbidden,
  intent,
  releaseQuote() {
    releaseQuote?.();
  },
};
declare global {
  interface Window {
    researchPreviewFixture: typeof fixture;
  }
}
window.researchPreviewFixture = fixture;
export function useConvexAuth() {
  const value = useFixtureState();
  return { isAuthenticated: value.authenticated, isLoading: false };
}
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const value = useFixtureState(),
    name = getFunctionName(ref),
    key = JSON.stringify(args);
  useEffect(() => {
    if (key !== '"skip"') reads.push({ name, args: JSON.parse(key) });
  }, [name, key]);
  if (args === "skip") return undefined;
  if (name === "forumResearch:getConfig")
    return value.mode === "loading"
      ? undefined
      : {
          enabled: value.mode === "ready",
          amountRaw: "100000",
          asset: RESEARCH_ASSET,
          network: RESEARCH_NETWORK,
          product: "solana-token-brief-v1",
          priceLabel: "$0.10 USDC",
          reason:
            value.mode === "ready"
              ? "ready"
              : value.mode === "exhausted"
                ? "free_credits_exhausted"
                : "setup_required",
        };
  if (!value.authenticated)
    throw new Error("Private receipt query while signed out");
  if (name === "forumResearch:listMine")
    return value.historyState ? [receipt(value.historyState)] : [];
  if (
    name === "forumResearch:status" &&
    (args as { intentKey: string }).intentKey === intent
  )
    return receipt(value.receiptState);
  throw new Error(`Unexpected fixture query: ${name}`);
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(
    async (args: unknown) => {
      actions.push({ name, args });
      if (name === "forumResearchActions:quote") {
        const request = args as {
          wallet: string;
          mint: string;
          idempotencyKey: string;
        };
        if (
          request.wallet !== wallet ||
          request.mint !== state.mint ||
          !request.idempotencyKey ||
          !state.authenticated ||
          !state.linked ||
          state.mode !== "ready"
        )
          throw new Error("Fixture quote gate denied");
        const result = {
          intentKey: intent,
          expiresAt: state.expiresAt,
          requirementsJson: JSON.stringify(
            researchRequirements(intent, wallet),
          ),
          resource: researchResource(intent),
        };
        if (state.deferQuote)
          await new Promise<void>((resolve) => {
            releaseQuote = resolve;
          });
        return result;
      }
      if (
        name === "forumResearchActions:check" &&
        (args as { intentKey: string }).intentKey === intent
      )
        return false;
      forbidden.push(name);
      throw new Error("All simulate/pay/provider actions forbidden");
    },
    [name],
  );
}
const client = new Proxy(
  {},
  {
    get() {
      forbidden.push("wallet-method");
      throw new Error("No wallet methods or signing capability in fixture");
    },
  },
) as CommerceWalletClient;
export function useCommerceWallet() {
  return useFixtureState().walletLoading ? null : client;
}
export function useCommerceIdentity() {
  const value = useFixtureState();
  return {
    linked: value.linked && value.authenticated,
    connected:
      value.linked && value.authenticated
        ? { account: { address: wallet } }
        : undefined,
  };
}
export function CommerceWalletButton({ disabled }: { disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        forbidden.push("wallet-link");
        throw new Error("Wallet linking forbidden");
      }}
    >
      Link fixture wallet
    </button>
  );
}
