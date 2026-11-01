import { createRoot } from "react-dom/client";
import { ForumFeedList } from "../../../components/forum/forum-feed-list";
import { resolveForumFeedSort } from "../../../components/forum/forum-home-model";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <ForumRuntimeContext.Provider
      value={{ host: params.has("native") ? "plugin" : "website" }}
    >
      <main
        className="forum-app-shell"
        data-surface="forum"
        style={{ padding: 16 }}
      >
        <ForumFeedList
          sort={resolveForumFeedSort(params.get("sort") ?? undefined)}
          communityOnly={params.get("view") === "community"}
        />
      </main>
    </ForumRuntimeContext.Provider>
  </SurfaceScope.Provider>,
);
