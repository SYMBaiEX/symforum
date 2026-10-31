import { createRoot } from "react-dom/client";
import type { ComponentType } from "react";
import * as Terminal from "../../../components/trading/forum-terminal";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import {
  fixture,
  client,
  mintA,
  mintB,
  walletA,
  walletB,
  change,
  useFixtureState,
} from "./wallet-read-isolation-state";
// The build appends only this private export in memory. Production AccountPanels
// (including its wallet:mint key and auth/link gates) executes without rewriting it.
const AccountPanels = (
  Terminal as unknown as {
    WalletReadIsolationParent: ComponentType<{
      client: typeof client;
      selected: { mint: string; symbol: string; name: string };
      onSelect(): void;
      active: "wallet";
    }>;
  }
).WalletReadIsolationParent;
Object.assign(window, { __walletReadIsolation: fixture });
function Fixture() {
  const state = useFixtureState();
  return (
    <SurfaceScope.Provider value="forum">
      <ForumRuntimeContext.Provider value={{ host: state.host }}>
        <main
          data-surface="forum"
          className="forum-app-shell bg-background text-foreground"
          aria-label="Invented wallet read isolation fixture"
          style={{ height: "100dvh", overflow: "auto" }}
        >
          <nav
            aria-label="Fixture identity controls"
            className="flex min-w-0 flex-wrap gap-2"
          >
            <button
              type="button"
              className="focus-ring min-h-11"
              onClick={() => change({ wallet: walletA })}
            >
              Wallet A
            </button>
            <button
              type="button"
              className="focus-ring min-h-11"
              onClick={() => change({ wallet: walletB })}
            >
              Wallet B
            </button>
            <button
              type="button"
              className="focus-ring min-h-11"
              onClick={() => change({ mint: mintA })}
            >
              Token A
            </button>
            <button
              type="button"
              className="focus-ring min-h-11"
              onClick={() => change({ mint: mintB })}
            >
              Token B
            </button>
          </nav>
          {state.mounted &&
            (state.host === "plugin" ? (
              <Terminal.ForumTerminal enabled />
            ) : (
              <AccountPanels
                client={client}
                selected={{
                  mint: state.mint,
                  symbol: state.mint === mintA ? "FIXTURE_A" : "FIXTURE_B",
                  name: "Invented sampled token",
                }}
                onSelect={() => {
                  throw new Error("Selection via inert watchlist forbidden");
                }}
                active="wallet"
              />
            ))}
          <button type="button" className="focus-ring min-h-11">
            After wallet panel
          </button>
        </main>
      </ForumRuntimeContext.Provider>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
