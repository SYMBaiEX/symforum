import { useEffect, type ComponentProps } from "react";
import { TokenSwap as ActualSwap } from "../../../components/swap/token-swap";
import { ResearchPurchase as ActualResearch } from "../../../components/trading/research-purchase";
import { SwapHistory as ActualHistory } from "../../../components/trading/wallet-panel";
export { WalletPanel } from "../../../components/trading/wallet-panel";
export type { TradeToken } from "../../../components/swap/token-swap";
const mounts: Record<string, number> = {};
Object.assign(window, { communityTerminalMounts: mounts });
function useMount(name: string) {
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
  }, [name]);
}
export function TokenSwap(props: ComponentProps<typeof ActualSwap>) {
  useMount("order");
  return <ActualSwap {...props} />;
}
export function ResearchPurchase(props: ComponentProps<typeof ActualResearch>) {
  useMount("research");
  return <ActualResearch {...props} />;
}
export function SwapHistory() {
  useMount("receipts");
  return <ActualHistory />;
}
