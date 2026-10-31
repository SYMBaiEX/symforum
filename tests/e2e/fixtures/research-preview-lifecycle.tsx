import { createRoot } from "react-dom/client";
import { ResearchPurchase } from "../../../components/trading/research-purchase";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { useFixtureState } from "./research-preview-lifecycle-state";
function Fixture() {
  const state = useFixtureState();
  return (
    <SurfaceScope.Provider value="forum">
      <main
        className="forum-app-shell bg-background p-3 text-foreground"
        data-surface="forum"
      >
        <div className="forum-surface">
          <ResearchPurchase mint={state.mint} />
        </div>
      </main>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
