import { createRoot } from "react-dom/client";
import { ResearchPurchase } from "../../../components/trading/research-purchase";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { useFixtureState } from "./research-exact-expiry-state";
function Fixture() {
  const state = useFixtureState();
  return (
    <SurfaceScope.Provider value="forum">
      <main
        data-surface="forum"
        className="forum-app-shell bg-background p-3 text-foreground"
        style={{ height: "100dvh", overflow: "auto" }}
      >
        {state.mounted ? (
          <ResearchPurchase mint={state.mint} />
        ) : (
          <p>Fixture unmounted</p>
        )}
        <button type="button" className="focus-ring min-h-11">
          Outside research fixture
        </button>
      </main>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
