import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { MarketExplorer } from "../../../components/trading/market-explorer";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { evidence, now } from "./market-view-preferences-state";
function Fixture() {
  useEffect(() => {
    evidence.mounts++;
  }, []);
  return (
    <SurfaceScope.Provider value="forum">
      <ForumRuntimeContext.Provider
        value={{
          host: new URLSearchParams(location.search).has("native")
            ? "plugin"
            : "website",
        }}
      >
        <main
          className="forum-app-shell"
          data-surface="forum"
          style={{ height: "100dvh", overflow: "hidden" }}
        >
          <MarketExplorer
            now={now}
            selected="So11111111111111111111111111111111111111112"
            onSelect={(choice) => {
              evidence.selected.push(choice.mint);
            }}
          />
        </main>
      </ForumRuntimeContext.Provider>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
