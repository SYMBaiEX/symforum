import { createRoot } from "react-dom/client";
import { CommunityHub } from "../../../components/community/community-hub";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { fixture } from "./symf-project-page-state";
const flags = new URLSearchParams(location.search);
Object.assign(window, { __symfPage: fixture });
document.documentElement.className =
  flags.get("theme") === "light" ? "light" : "dark";
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <ForumRuntimeContext.Provider
      value={{ host: flags.has("native") ? "plugin" : "website" }}
    >
      <main
        data-surface="forum"
        className="forum-surface forum-app-shell bg-background text-foreground"
        style={{ padding: 16 }}
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Isolated preview · illustrative data · wallet actions disabled
        </p>
        <CommunityHub
          compact={flags.has("compact")}
          mint={
            flags.has("compact") ? (flags.get("mint") ?? undefined) : undefined
          }
        />
      </main>
    </ForumRuntimeContext.Provider>
  </SurfaceScope.Provider>,
);
