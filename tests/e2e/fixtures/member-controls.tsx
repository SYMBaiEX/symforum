import { createRoot } from "react-dom/client";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumMembers } from "../../../components/forum/forum-members";
import "./member-controls-state";
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <main
      data-surface="forum"
      className="forum-app-shell p-4"
      aria-label="Invented local member directory"
    >
      <ForumMembers enabled />
      <button type="button" className="focus-ring min-h-11">
        After member controls
      </button>
    </main>
  </SurfaceScope.Provider>,
);
