import { createRoot } from "react-dom/client";
import { WalletPanel } from "../../../components/trading/wallet-panel";
import { selectedMint, wallet } from "./wallet-readability-state";

createRoot(document.getElementById("root")!).render(
  <main
    data-surface="forum"
    aria-label="Invented read-only wallet fixture"
    className="forum-app-shell bg-background text-foreground"
    style={{ height: "100dvh", overflow: "auto" }}
  >
    <WalletPanel
      wallet={wallet}
      selectedMint={selectedMint}
      selectedSymbol={
        location.search.includes("large")
          ? "LONG_SELECTED_TOKEN_NAME_ABCDEFGHIJKLMNOPQRSTUVWXYZ"
          : "FIXTURE"
      }
    />
    <button type="button" className="focus-ring min-h-11">
      After wallet explanation
    </button>
  </main>,
);
