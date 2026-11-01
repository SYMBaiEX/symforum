import { createRoot } from "react-dom/client";
import { TokenSwap } from "../../../components/swap/token-swap";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import styles from "../../../components/trading/forum-terminal.module.css";
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <ForumRuntimeContext.Provider value={{ host: "website" }}>
      <main
        data-surface="forum"
        className="forum-app-shell bg-background text-foreground"
        style={{
          height: "100dvh",
          overflow: "auto",
          containerType: "inline-size",
        }}
      >
        <div className={styles.page} data-terminal-viewport>
          <div className={styles.layout} data-terminal-layout data-pane="trade">
            <div className={styles.analysis} data-terminal-analysis />
            <aside className={styles.aside} data-terminal-order>
              <section className={styles.orderSurface}>
                <div className={styles.body}>
                  <TokenSwap />
                </div>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </ForumRuntimeContext.Provider>
  </SurfaceScope.Provider>,
);
