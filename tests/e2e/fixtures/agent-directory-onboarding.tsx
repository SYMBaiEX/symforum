import { createRoot } from "react-dom/client";
import { ForumAgentsPage } from "../../../components/forum/forum-agents-page";
import { ForumStartHere } from "../../../components/forum/forum-start-here";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import "./agent-directory-onboarding-state";

const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider
    value={{ host: params.has("native") ? "plugin" : "website" }}
  >
    <SurfaceScope.Provider value="forum">
      <main
        className="forum-app-shell bg-background p-4 text-foreground"
        data-surface="forum"
      >
        {location.pathname.endsWith("start-here") ? (
          <ForumStartHere enabled={!params.has("disabled")} />
        ) : (
          <ForumAgentsPage enabled={!params.has("disabled")} />
        )}
      </main>
    </SurfaceScope.Provider>
  </ForumRuntimeContext.Provider>,
);
