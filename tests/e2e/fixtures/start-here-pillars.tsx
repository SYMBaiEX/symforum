import { createRoot } from "react-dom/client";
import { ForumStartHere } from "../../../components/forum/forum-start-here";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import "./start-here-pillars-state";
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <main
      className="forum-app-shell bg-background text-foreground p-4"
      data-surface="forum"
    >
      <ForumStartHere
        enabled={!new URLSearchParams(location.search).has("disabled")}
      />
    </main>
  </SurfaceScope.Provider>,
);
