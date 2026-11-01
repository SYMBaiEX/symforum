import { createRoot } from "react-dom/client";
import { MarketExplorer } from "../../../components/trading/market-explorer";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { now, useFixture } from "./market-export-state";
const host = new URLSearchParams(location.search).has("native")
  ? "plugin"
  : "website";
function Fixture() {
  const { mounted } = useFixture();
  return (
    <SurfaceScope.Provider value="forum">
      <ForumRuntimeContext.Provider value={{ host }}>
        <main
          data-surface="forum"
          className="forum-app-shell"
          style={{ height: "100dvh", overflow: "hidden" }}
        >
          {mounted ? (
            <MarketExplorer
              selected=""
              now={now}
              onSelect={() => {
                throw Error("No automatic selection permitted");
              }}
            />
          ) : null}
        </main>
      </ForumRuntimeContext.Provider>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
