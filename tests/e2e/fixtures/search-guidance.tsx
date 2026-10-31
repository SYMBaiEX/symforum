import { createRoot } from "react-dom/client";
import { ForumSearchPage } from "../../../components/forum/forum-search-page";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import "./search-guidance-state";

createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <main
      className="forum-app-shell bg-background p-3 text-foreground"
      data-surface="forum"
    >
      <div className="forum-surface">
        <ForumSearchPage enabled />
      </div>
    </main>
  </SurfaceScope.Provider>,
);
