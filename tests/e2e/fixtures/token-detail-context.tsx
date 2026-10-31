import { createRoot } from "react-dom/client";
import { TokenDetail } from "../../../components/trading/token-detail";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import styles from "../../../components/trading/forum-terminal.module.css";
import {
  mintA,
  mintB,
  now,
  select,
  useSelection,
  reads,
  forbidden,
} from "./token-detail-context-state";
Object.assign(window, { __tokenContext: { select, reads, forbidden } });
function Fixture() {
  const mint = useSelection();
  return (
    <ForumRuntimeContext.Provider value={{ host: "plugin", routeHash: "" }}>
      <main
        data-surface="forum"
        className="forum-app-shell bg-background text-foreground"
        aria-label="Invented native token-detail fixture"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100dvh",
          overflow: "hidden",
        }}
      >
        <nav aria-label="Fixture token selection">
          <button type="button" onClick={() => select(mintA)}>
            Token A
          </button>
          <button type="button" onClick={() => select(mintB)}>
            Token B
          </button>
        </nav>
        <div
          role="region"
          aria-label="Loaded token workspace"
          tabIndex={0}
          className={styles.chartWorkspace}
          style={{ flex: "1 1 0", height: "auto" }}
        >
          <TokenDetail
            token={{
              mint,
              symbol: "SAME",
              name: "Invented duplicate-symbol token",
            }}
            now={now}
          />
        </div>
      </main>
    </ForumRuntimeContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
