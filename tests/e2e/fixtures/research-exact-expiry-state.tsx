// Inert quote metadata/read states only. No transaction, signer or provider.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import {
  buildResearchReport,
  RESEARCH_ASSET,
  RESEARCH_NETWORK,
  type ResearchState,
} from "../../../lib/forum-research";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
export const mintA = "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
  mintB = "So11111111111111111111111111111111111111112";
export const walletA = "11111111111111111111111111111111",
  walletB = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
const params = new URLSearchParams(location.search);
let state = {
  mint: mintA,
  wallet: walletA,
  authenticated: !params.has("guest"),
  linked: !params.has("guest") && !params.has("unlinked"),
  mode: params.get("mode") ?? "ready",
  receiptState: "quoted" as ResearchState,
  intentKey: "a".repeat(64),
  expiresAt: Date.now() + 25000,
  mounted: true,
  holdReview: false,
};
const listeners = new Set<() => void>();
export function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export function useFixtureState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}
const reads: { name: string; args: unknown }[] = [],
  actions: { name: string; args: unknown }[] = [],
  forbidden: string[] = [];
const quoted = new Map<
  string,
  { intentKey: string; mint: string; expiresAt: number }
>();
let releaseReview: (() => void) | null = null;
export const fixture = {
  update,
  reads,
  actions,
  forbidden,
  releaseReview() {
    const release = releaseReview;
    releaseReview = null;
    release?.();
  },
};
Object.assign(window, { __researchExpiry: fixture });
export function useConvexAuth() {
  return { isAuthenticated: useFixtureState().authenticated, isLoading: false };
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
  if (!value.authenticated) throw new Error("Private read while signed out");
  if (name === "forumResearch:listMine") return [];
  if (name === "forumResearch:status") {
    const record = quoted.get((args as { intentKey: string }).intentKey);
    if (!record) throw new Error("Unknown inert intent read");
    return {
      ...record,
      state: value.receiptState,
      createdAt: record.expiresAt - 25000,
      signature: null,
      finalizedAt: value.receiptState === "fulfilled" ? Date.now() : null,
      report:
        value.receiptState === "fulfilled"
          ? buildResearchReport({
              mint: record.mint,
              name: "Inert expiry fixture",
              symbol: "TEST",
              generatedAt: Date.now(),
              metricsAsOf: Date.now(),
              priceUsd: null,
              marketCapUsd: null,
              liquidityUsd: null,
              volume1hUsd: null,
              holders: null,
              priceChange1hPercent: null,
              sourceUrl: "https://source.example.test/inert",
              threadUrl: "https://forum.example.test/inert",
            })
          : null,
    };
  }
  throw new Error(`Unexpected read ${name}`);
}
export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  return useCallback(
    async (args: unknown) => {
      actions.push({ name, args });
      if (name !== "forumResearchActions:quote") {
        forbidden.push(name);
        throw new Error("Financial/provider action denied");
      }
      const input = args as {
        wallet: string;
        mint: string;
        idempotencyKey: string;
      };
      if (
        !state.authenticated ||
        !state.linked ||
        state.mode !== "ready" ||
        input.wallet !== state.wallet ||
        input.mint !== state.mint ||
        !input.idempotencyKey
      )
        throw new Error("Inert review metadata gate denied");
      let record = quoted.get(state.intentKey);
      if (!record) {
        record = {
          intentKey: state.intentKey,
          mint: state.mint,
          expiresAt: state.expiresAt,
        };
        quoted.set(state.intentKey, record);
      }
      if (state.holdReview)
        await new Promise<void>((resolve) => {
          releaseReview = resolve;
        });
      return {
        intentKey: record.intentKey,
        expiresAt: record.expiresAt,
        requirementsJson: "{}",
        resource: "https://inert.example.test/not-a-payment",
      };
    },
    [name],
  );
}
const client = new Proxy(
  {},
  {
    get() {
      forbidden.push("wallet-method");
      throw new Error("Wallet methods and signing denied");
    },
  },
) as CommerceWalletClient;
export function useCommerceWallet() {
  useFixtureState();
  return client;
}
export function useCommerceIdentity() {
  const value = useFixtureState();
  return {
    linked: value.authenticated && value.linked,
    connected:
      value.authenticated && value.linked
        ? { account: { address: value.wallet } }
        : null,
  };
}
export function CommerceWalletButton({ disabled }: { disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        forbidden.push("wallet-link");
        throw new Error("Wallet link denied");
      }}
    >
      Link inert fixture wallet
    </button>
  );
}
