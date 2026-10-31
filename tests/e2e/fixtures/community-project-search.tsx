import { createRoot } from "react-dom/client";
import { CommunityHub } from "../../../components/community/community-hub";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
const parameters = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", parameters.has("dark"));
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider value={{ host: "website" }}>
    <main
      data-surface="forum"
      className="forum-app-shell bg-background p-3 text-foreground"
    >
      <CommunityHub
        compact={parameters.has("compact")}
        mint={parameters.get("mint") ?? undefined}
      />
    </main>
  </ForumRuntimeContext.Provider>,
);
