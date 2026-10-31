import { createRoot } from "react-dom/client";
import { CommunityHub } from "../../../components/community/community-hub";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";

createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider value={{ host: "website" }}>
    <main data-surface="forum" className="bg-background p-4 text-foreground">
      <CommunityHub />
    </main>
  </ForumRuntimeContext.Provider>,
);
