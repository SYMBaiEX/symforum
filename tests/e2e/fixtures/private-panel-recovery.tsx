import { createRoot } from "react-dom/client";
import { useEffect, type ComponentType } from "react";
import * as Terminal from "../../../components/trading/forum-terminal";
import { SwapHistory } from "../../../components/trading/wallet-panel";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import {
  TerminalAttentionProvider,
  useTerminalAttentionSnapshot,
} from "../../../components/trading/terminal-attention";
import { SYMF_TOKEN } from "../../../lib/symf-token";
import {
  fixture,
  client,
  useFixtureState,
} from "./private-panel-recovery-state";
const AccountPanels = (
  Terminal as unknown as {
    PrivateHistoryParent: ComponentType<{
      client: typeof client;
      selected: { mint: string; symbol: string; name: string };
      onSelect(): void;
      active: "wallet" | "receipts";
    }>;
  }
).PrivateHistoryParent;
const counts = { mounts: 0, unmounts: 0 };
Object.assign(window, { privateHistoryFixture: { ...fixture, counts } });
function StableSibling() {
  useEffect(() => {
    counts.mounts++;
    return () => {
      counts.unmounts++;
    };
  }, []);
  return (
    <label>
      Unrelated retained draft
      <input aria-label="Unrelated retained draft" defaultValue="" />
    </label>
  );
}
function Attention() {
  const values = useTerminalAttentionSnapshot();
  return (
    <output aria-label="Known protected counts">
      {JSON.stringify(values)}
    </output>
  );
}
function Fixture() {
  const state = useFixtureState();
  const direct = new URLSearchParams(location.search).has("direct");
  return (
    <SurfaceScope.Provider value="forum">
      <ForumRuntimeContext.Provider value={{ host: "website" }}>
        <main
          data-surface="forum"
          className="forum-app-shell bg-background text-foreground p-4"
        >
          <div className="forum-surface">
            <TerminalAttentionProvider>
              <Attention />
              <StableSibling />
              {state.mounted &&
                (direct ? (
                  <SwapHistory ownerId={state.owner} />
                ) : (
                  <AccountPanels
                    client={client}
                    selected={{
                      mint: SYMF_TOKEN.mint,
                      symbol: "SYMF",
                      name: "Invented token",
                    }}
                    onSelect={() => {
                      throw new Error("Unexpected token selection");
                    }}
                    active={state.active}
                  />
                ))}
              <button type="button" className="min-h-11">
                After private history
              </button>
            </TerminalAttentionProvider>
          </div>
        </main>
      </ForumRuntimeContext.Provider>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
