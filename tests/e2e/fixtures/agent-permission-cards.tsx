import { createRoot } from "react-dom/client";
import { ForumAgentAccess } from "../../../components/forum/forum-agent-access";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { useFixtureState } from "./agent-permission-cards-state";
function Fixture() {
  const state = useFixtureState();
  return (
    <SurfaceScope.Provider value="forum">
      <ForumRuntimeContext.Provider value={state.runtime}>
        <main
          className="forum-app-shell forum-surface min-w-0"
          data-surface="forum"
        >
          <ForumAgentAccess
            enabled={
              new URLSearchParams(location.search).get("scenario") !==
              "disabled"
            }
          />
        </main>
      </ForumRuntimeContext.Provider>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
