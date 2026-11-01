import { createRoot } from "react-dom/client";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { TokenPriceChart } from "../../../components/trading/price-chart";
import styles from "../../../components/trading/forum-terminal.module.css";
import { MINT } from "./forced-colors-state";

createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <main
      data-surface="forum"
      className="forum-app-shell forum-surface bg-background text-foreground"
      style={{ height: "100dvh", overflow: "hidden" }}
    >
      <section className={styles.page} aria-label="Local chart workspace">
        <div className={styles.chartWorkspace}>
          <TokenPriceChart mint={MINT} symbol="LOCAL" light={false} compact />
          <button className="focus-ring min-h-11 min-w-11">
            After readings
          </button>
        </div>
      </section>
    </main>
  </SurfaceScope.Provider>,
);
