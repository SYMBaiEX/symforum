import { createRoot } from "react-dom/client";
import { TokenPriceChart } from "../../../components/trading/price-chart";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import styles from "../../../components/trading/forum-terminal.module.css";
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <main
      className="forum-app-shell bg-background text-foreground"
      data-surface="forum"
      style={{ height: "100dvh", overflow: "hidden" }}
    >
      <div className={styles.page}>
        <div className={styles.chartWorkspace}>
          <TokenPriceChart
            mint="So11111111111111111111111111111111111111112"
            symbol="FIXTURE"
            light={false}
            compact
          />
        </div>
      </div>
    </main>
  </SurfaceScope.Provider>,
);
