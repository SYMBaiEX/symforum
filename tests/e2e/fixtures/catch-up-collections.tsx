import { createRoot } from "react-dom/client";
import { ForumCatchUp } from "../../../components/forum/forum-catch-up";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import "./catch-up-collections-state";
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider value={{ host: "website" }}>
    <SurfaceScope.Provider value="forum">
      <main
        className="forum-app-shell bg-background p-3 text-foreground"
        data-surface="forum"
      >
        <div className="forum-surface">
          <ForumCatchUp />
        </div>
      </main>
    </SurfaceScope.Provider>
  </ForumRuntimeContext.Provider>,
);
