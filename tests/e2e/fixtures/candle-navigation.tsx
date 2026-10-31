import { createRoot } from "react-dom/client";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { CandleReadings } from "../../../components/trading/candle-readings";
import { TokenPriceChart } from "../../../components/trading/price-chart";
import styles from "../../../components/trading/forum-terminal.module.css";
import { useLocalState } from "./candle-navigation-state";
function Fixture() {
  const state = useLocalState();
  const leaf = new URLSearchParams(location.search).has("leaf");
  return (
    <SurfaceScope.Provider value="forum">
      <main
        data-surface="forum"
        className="forum-app-shell bg-background text-foreground"
        style={{ height: "100dvh", overflow: "hidden" }}
      >
        <div className={styles.chartWorkspace}>
          {leaf ? (
            <CandleReadings
              candles={state.candles}
              evidence={state.evidence}
              compact
              formatPrice={(value) => `$${value}`}
            />
          ) : (
            <TokenPriceChart
              mint={state.evidence.mint}
              symbol="LOCAL"
              light={false}
              compact
            />
          )}
          <button>After readings</button>
        </div>
      </main>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
