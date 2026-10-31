import { createRoot } from "react-dom/client";
import {
  AuthorTip,
  CommunityHub,
} from "../../../components/community/community-hub";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import type { Id } from "../../../convex/_generated/dataModel";
import "./tip-context-state";
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider
    value={{ host: params.has("native") ? "plugin" : "website" }}
  >
    <SurfaceScope.Provider value="forum">
      <main
        className="forum-app-shell bg-background p-3 text-foreground"
        data-surface="forum"
      >
        <div className="forum-surface">
          {params.has("author") ? (
            <AuthorTip threadId={"public-thread" as Id<"forumThreads">} />
          ) : (
            <CommunityHub compact={params.has("compact")} />
          )}
        </div>
      </main>
    </SurfaceScope.Provider>
  </ForumRuntimeContext.Provider>,
);
