import { createRoot } from "react-dom/client";
import { TransparencyPanel } from "../../../components/trading/transparency-panel";
import { SurfaceScope } from "../../../components/ui/surface-scope";
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <main
      data-surface="forum"
      className="forum-app-shell bg-background text-foreground"
      style={{ height: "100dvh", overflow: "auto" }}
    >
      <TransparencyPanel />
      <button type="button" className="focus-ring min-h-11">
        After transparency
      </button>
    </main>
  </SurfaceScope.Provider>,
);
