// Instrument real components under the real terminal; all transports stay inert.
import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  getFunctionName,
  type FunctionReference,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import * as convex from "./terminal-convex";
import * as wallet from "./terminal-wallet";
import {
  TokenDetail as RealTokenDetail,
  RiskPanel,
} from "../../../components/trading/token-detail";
import { MarketExplorer as RealMarketExplorer } from "../../../components/trading/market-explorer";
import { TransparencyPanel as RealTransparencyPanel } from "../../../components/trading/transparency-panel";
import {
  WalletPanel as RealWalletPanel,
  SwapHistory as RealSwapHistory,
} from "../../../components/trading/wallet-panel";
import { TokenSwap as RealTokenSwap } from "../../../components/swap/token-swap";
import { ResearchPurchase as RealResearchPurchase } from "../../../components/trading/research-purchase";
import { CommunityHub as RealCommunityHub } from "../../../components/community/community-hub";

type Failure = "none" | "market" | "markets" | "treasury" | "swap";
let failure: Failure = "none";
const listeners = new Set<() => void>();
const mounts: Record<string, number> = {},
  unmounts: Record<string, number> = {};
const calls: string[] = [],
  denied: string[] = [];
export const fixture = {
  mounts,
  unmounts,
  calls,
  denied,
  fail(next: Failure) {
    failure = next;
    listeners.forEach((fn) => fn());
  },
  signOut() {
    window.dispatchEvent(new Event("terminal-fixture:signout"));
  },
};
Object.assign(window, { __panelRecovery: fixture });
function useInstrument(name: string, throws?: Failure) {
  const current = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => failure,
  );
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      unmounts[name] = (unmounts[name] ?? 0) + 1;
    };
  }, [name]);
  if (throws && current === throws)
    throw new Error("Inert panel render failure");
}
export function TokenDetail(props: ComponentProps<typeof RealTokenDetail>) {
  useInstrument("market", "market");
  return <RealTokenDetail {...props} />;
}
export function MarketExplorer(
  props: ComponentProps<typeof RealMarketExplorer>,
) {
  useInstrument("markets", "markets");
  return <RealMarketExplorer {...props} />;
}
export function TransparencyPanel() {
  useInstrument("treasury", "treasury");
  return <RealTransparencyPanel />;
}
export function TokenSwap(props: ComponentProps<typeof RealTokenSwap>) {
  useInstrument("swap", "swap");
  return <RealTokenSwap {...props} />;
}
export function SwapHistory() {
  useInstrument("receipts");
  return <RealSwapHistory />;
}
export function WalletPanel(props: ComponentProps<typeof RealWalletPanel>) {
  useInstrument("balances");
  return <RealWalletPanel {...props} />;
}
export function ResearchPurchase(
  props: ComponentProps<typeof RealResearchPurchase>,
) {
  useInstrument("research");
  return <RealResearchPurchase {...props} />;
}
export function CommunityHub(props: ComponentProps<typeof RealCommunityHub>) {
  useInstrument("community");
  return <RealCommunityHub {...props} />;
}
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  useInstrument("wallet-provider");
  return (
    <wallet.CommerceWalletProvider>{children}</wallet.CommerceWalletProvider>
  );
}
export const useCommerceWallet = wallet.useCommerceWallet;
export const useCommerceIdentity = wallet.useCommerceIdentity;
export const CommerceWalletButton = wallet.CommerceWalletButton;
export { RiskPanel };
export const useConvexAuth = convex.useConvexAuth;
export function useQuery<Ref extends FunctionReference<"query">>(
  ref: Ref,
  args: FunctionArgs<Ref> | "skip",
): FunctionReturnType<Ref> | undefined {
  const value = convex.useQuery(ref, args);
  // The saved unknown receipt is real UI data, but never starts a check timer.
  return getFunctionName(ref) === "forumResearch:listMine" &&
    Array.isArray(value)
    ? (value.map((row: Record<string, unknown>) => ({
        ...row,
        signature: null,
      })) as FunctionReturnType<Ref>)
    : value;
}
export function useAction<Ref extends FunctionReference<"action">>(ref: Ref) {
  const original = convex.useAction(ref),
    name = getFunctionName(ref);
  return useCallback(
    async (args: FunctionArgs<Ref>) => {
      calls.push(name);
      if (
        ![
          "forumCommerce:resolveMint",
          "forumSwaps:quote",
          "forumTerminal:getWalletReadState",
          "forumTerminalRefresh:refresh",
        ].includes(name)
      ) {
        denied.push(name);
        throw new Error("Financial or unconfigured action denied");
      }
      return original(args);
    },
    [name, original],
  );
}
export function useMutation<Ref extends FunctionReference<"mutation">>(
  ref: Ref,
) {
  const name = getFunctionName(ref);
  return useCallback(async () => {
    // The real swap controller's initial idempotent recovery registration is
    // counted but inert. Retrying a sibling must not register it again.
    if (name === "forumSwapRecovery:ensure") {
      calls.push(name);
      return null;
    }
    denied.push(name);
    throw new Error("Mutation denied");
  }, [name]);
}
export function TokenPriceChart() {
  return <p>Inert chart renderer; no HTTP or canvas.</p>;
}
