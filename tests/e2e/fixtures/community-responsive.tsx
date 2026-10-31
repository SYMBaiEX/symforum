import { createRoot } from "react-dom/client";
import { CommunityHub } from "../../../components/community/community-hub";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { forbidden, reads } from "./community-responsive-mocks";
declare global {
  interface Window {
    communityResponsiveFixture: { forbidden: string[]; reads: string[] };
  }
}
window.communityResponsiveFixture = { forbidden, reads };
const compact = new URLSearchParams(location.search).has("compact");
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider value={{ host: "website" }}>
    <main data-surface="forum" className="bg-background p-4 text-foreground">
      <CommunityHub compact={compact} />
    </main>
  </ForumRuntimeContext.Provider>,
);
