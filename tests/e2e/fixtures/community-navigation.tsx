import { createRoot } from "react-dom/client";
import { CommunityHub } from "../../../components/community/community-hub";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
const query = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider
    value={{ host: query.has("native") ? "plugin" : "website" }}
  >
    <main data-surface="forum">
      <CommunityHub compact={location.pathname.includes("trade")} />
    </main>
  </ForumRuntimeContext.Provider>,
);
