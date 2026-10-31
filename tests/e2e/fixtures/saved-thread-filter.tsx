import { createRoot } from "react-dom/client";
import { ForumSavedThreads } from "../../../components/forum/forum-saved-threads";
import { SurfaceScope } from "../../../components/ui/surface-scope";
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <main
      data-surface="forum"
      className="forum-app-shell"
      style={{ padding: 16 }}
    >
      <h1>Saved discussions</h1>
      <ForumSavedThreads enabled />
    </main>
  </SurfaceScope.Provider>,
);
