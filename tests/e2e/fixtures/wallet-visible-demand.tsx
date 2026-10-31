import { createRoot } from "react-dom/client";
import type { ComponentType } from "react";
import * as Terminal from "../../../components/trading/forum-terminal";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import {
  fixture,
  client,
  useFixtureState,
} from "./wallet-visible-demand-state";
const AccountPanels = (
  Terminal as unknown as {
    VisibleDemandAccountPanels: ComponentType<{
      client: typeof client;
      selected: { mint: string; symbol: string; name: string };
      active: "wallet" | "receipts";
      visible?: boolean;
      onSelect(): void;
    }>;
  }
).VisibleDemandAccountPanels;
Object.assign(window, { walletDemand: fixture });
function App() {
  const state = useFixtureState();
  return (
    <SurfaceScope.Provider value="forum">
      <ForumRuntimeContext.Provider value={{ host: state.host }}>
        <main
          data-surface="forum"
          className="forum-app-shell bg-background text-foreground"
          style={{ height: "100dvh", overflow: "auto" }}
        >
          {new URLSearchParams(location.search).has("offscreen") && (
            <div style={{ height: "200dvh" }} aria-hidden="true" />
          )}
          {state.mounted &&
            (new URLSearchParams(location.search).has("parent") &&
            state.host === "website" ? (
              <AccountPanels
                client={client}
                selected={{
                  mint: state.mint,
                  symbol: "FIXTURE",
                  name: "Invented token",
                }}
                active="wallet"
                onSelect={() => {
                  throw Error("Selection forbidden");
                }}
              />
            ) : (
              <Terminal.ForumTerminal enabled />
            ))}
        </main>
      </ForumRuntimeContext.Provider>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
