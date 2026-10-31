import { createRoot } from "react-dom/client";
import { ForumFeedList } from "../../../components/forum/forum-feed-list";
import { ForumRecentThreadsPage } from "../../../components/forum/forum-recent-threads-page";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { useFixtureState } from "./shared-forum-query-keys-state";

function Fixture() {
  const value = useFixtureState();
  return (
    <SurfaceScope.Provider value="forum">
      <div
        data-surface="forum"
        className="forum-app-shell min-h-screen bg-background text-foreground"
      >
        <main className="mx-auto w-full max-w-3xl min-w-0 p-3">
          {value.mounted &&
            (value.surface === "feed" ? (
              <ForumFeedList
                key={value.instance}
                sort="active"
                communityOnly={false}
              />
            ) : (
              <ForumRecentThreadsPage
                key={value.instance}
                enabled
                mode={value.mode}
                title="Recent discussions"
                description="Sampled local read results"
              />
            ))}
        </main>
      </div>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
