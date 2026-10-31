import { createRoot } from "react-dom/client";
import {
  TokenDetail,
  RiskPanel,
} from "../../../components/trading/token-detail";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import styles from "../../../components/trading/forum-terminal.module.css";
import {
  mintA,
  mintB,
  symfMint,
  now,
  select,
  setPath,
  setMounted,
  useFixtureState,
  reads,
  forbidden,
} from "./token-sharing-facts-state";
Object.assign(window, {
  __sharingFacts: { select, setPath, setMounted, symfMint, reads, forbidden },
});
function Fixture() {
  const state = useFixtureState();
  return (
    <SurfaceScope.Provider value="forum">
      <ForumRuntimeContext.Provider
        value={{
          host: new URLSearchParams(location.search).has("native")
            ? "plugin"
            : "website",
          routeHash: "",
        }}
      >
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
            aria-label="Loaded sharing workspace"
            tabIndex={0}
            className="min-h-0 min-w-0"
            style={{ flex: "1 1 0", overflow: "auto" }}
          >
            {state.mounted ? (
              <>
                <div
                  className={styles.chartWorkspace}
                  style={{ height: "auto" }}
                >
                  <TokenDetail
                    token={{
                      mint: state.mint,
                      symbol: "SAME",
                      name: "Invented duplicate symbol",
                    }}
                    now={now}
                  />
                </div>
                <aside className={styles.aside}>
                  <details className={styles.riskDisclosure}>
                    <summary className="focus-ring">
                      Mint facts <span>Authorities &amp; recorded checks</span>
                    </summary>
                    <RiskPanel mint={state.mint} wallet={null} now={now} />
                  </details>
                </aside>
              </>
            ) : (
              <p>Fixture unmounted</p>
            )}
          </div>
        </main>
      </ForumRuntimeContext.Provider>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
