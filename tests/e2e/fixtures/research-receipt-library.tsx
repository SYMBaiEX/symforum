import { createRoot } from "react-dom/client";
import { ResearchPurchase } from "../../../components/trading/research-purchase";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { useFixture } from "./research-receipt-library-state";
function Fixture() {
  const state = useFixture();
  return (
    <SurfaceScope.Provider value="forum">
      <main
        className="forum-app-shell bg-background p-3 text-foreground"
        data-surface="forum"
      >
        {state.mounted ? (
          <ResearchPurchase mint={state.mint} />
        ) : (
          <p>Fixture unmounted</p>
        )}
      </main>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
