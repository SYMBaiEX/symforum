import { createRoot } from "react-dom/client";
import { CommunityHub } from "../../../components/community/community-hub";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
const params = new URLSearchParams(location.search),
  compact = location.pathname.includes("trade");
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <ForumRuntimeContext.Provider
      value={{ host: params.has("native") ? "plugin" : "website" }}
    >
      <main
        data-surface="forum"
        className="forum-app-shell"
        style={{ padding: 16 }}
      >
        <CommunityHub
          compact={compact}
          mint={
            compact ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : undefined
          }
        />
      </main>
    </ForumRuntimeContext.Provider>
  </SurfaceScope.Provider>,
);
