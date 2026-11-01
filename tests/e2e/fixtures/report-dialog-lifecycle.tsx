import { createRoot } from "react-dom/client";
import { ForumThreadView } from "../../../components/forum/forum-thread-view";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { useFixture } from "./report-dialog-lifecycle-state";
function Fixture() {
  const state = useFixture();
  return (
    <SurfaceScope.Provider value="forum">
      <main
        className="forum-app-shell forum-surface bg-background p-3 text-foreground"
        data-surface="forum"
      >
        {state.mounted ? (
          <ForumThreadView enabled categorySlug="crypto" threadSlug="example" />
        ) : (
          <p>Fixture unmounted</p>
        )}
      </main>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
