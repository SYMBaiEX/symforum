import { createRoot } from "react-dom/client";
import { TokenDetail } from "../../../components/trading/token-detail";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import styles from "../../../components/trading/forum-terminal.module.css";
import {
  mintA,
  mintB,
  now,
  select,
  useSelection,
  reads,
  forbidden,
} from "./token-metric-inspection-state";
Object.assign(window, { __metricInspection: { select, reads, forbidden } });
function Fixture() {
  const mint = useSelection();
  return (
    <SurfaceScope.Provider value="forum">
      <ForumRuntimeContext.Provider value={{ host: "plugin", routeHash: "" }}>
        <main
          data-surface="forum"
          className="forum-app-shell bg-background text-foreground"
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100dvh",
            overflow: "hidden",
          }}
        >
          <nav aria-label="Fixture token selection">
            <button onClick={() => select(mintA)}>Token A</button>
            <button onClick={() => select(mintB)}>Token B</button>
          </nav>
          <div
            role="region"
            aria-label="Loaded metric workspace"
            tabIndex={0}
            className={styles.chartWorkspace}
            style={{ flex: "1 1 0", height: "auto" }}
          >
            <TokenDetail
              token={{
                mint,
                symbol: "SAME",
                name: "Invented duplicate symbol",
              }}
              now={now}
            />
          </div>
        </main>
      </ForumRuntimeContext.Provider>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
