import { createRoot } from "react-dom/client";
import { CommunityHub } from "../../../components/community/community-hub";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { useFixtureMint } from "./work-brief-guidance-state";
function Fixture() {
  const mint = useFixtureMint();
  return (
    <ForumRuntimeContext.Provider value={{ host: "website" }}>
      <SurfaceScope.Provider value="forum">
        <main
          className="forum-app-shell bg-background p-3 text-foreground"
          data-surface="forum"
        >
          <div className="forum-surface">
            <CommunityHub mint={mint} />
          </div>
        </main>
      </SurfaceScope.Provider>
    </ForumRuntimeContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
