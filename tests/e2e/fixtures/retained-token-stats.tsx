import { createRoot } from "react-dom/client";
import { TokenDetail } from "../../../components/trading/token-detail";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import {
  now,
  useFixture,
  update,
  late,
  current,
  reads,
  forbidden,
} from "./retained-token-stats-state";
Object.assign(window, {
  __retainedStats: { update, late, current, reads, forbidden },
});
function Fixture() {
  const { mint } = useFixture();
  return (
    <SurfaceScope.Provider value="forum">
      <ForumRuntimeContext.Provider value={{ host: "plugin", routeHash: "" }}>
        <main
          data-surface="forum"
          className="forum-app-shell bg-background text-foreground"
        >
          <TokenDetail
            token={{ mint, symbol: "TEST", name: "Invented token" }}
            now={now}
          />
        </main>
      </ForumRuntimeContext.Provider>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
