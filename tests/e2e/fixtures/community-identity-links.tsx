import { createRoot } from "react-dom/client";
import { CommunityHub } from "../../../components/community/community-hub";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider
    value={{ host: params.has("native") ? "plugin" : "website" }}
  >
    <main
      data-surface="forum"
      className="forum-app-shell bg-background p-3 text-foreground"
    >
      <CommunityHub
        compact={params.has("compact")}
        mint={params.get("mint") ?? undefined}
      />
    </main>
  </ForumRuntimeContext.Provider>,
);
