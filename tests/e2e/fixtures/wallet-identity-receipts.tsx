import { createRoot } from "react-dom/client";
import { ForumTerminal } from "../../../components/trading/forum-terminal";
import {
  WalletPanel,
  SwapHistory,
} from "../../../components/trading/wallet-panel";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import {
  fixture,
  selectedMint,
  useFixtureWallet,
} from "./wallet-identity-receipts-state";
const root = createRoot(document.getElementById("root")!);
window.walletIdentityFixture = {
  ...fixture,
  unmount() {
    root.unmount();
  },
};
const params = new URLSearchParams(location.search);
function Fixture() {
  const wallet = useFixtureWallet();
  return (
    <ForumRuntimeContext.Provider
      value={{ host: params.has("native") ? "plugin" : "website" }}
    >
      <SurfaceScope.Provider value="forum">
        <main
          className="forum-app-shell bg-background text-foreground"
          data-surface="forum"
        >
          {params.has("integration") ? (
            <ForumTerminal enabled />
          ) : (
            <>
              <WalletPanel
                wallet={wallet}
                selectedMint={selectedMint}
                selectedSymbol="SYMF"
              />
              <SwapHistory ownerId="isolated-wallet-reader" />
            </>
          )}
        </main>
      </SurfaceScope.Provider>
    </ForumRuntimeContext.Provider>
  );
}
root.render(<Fixture />);
