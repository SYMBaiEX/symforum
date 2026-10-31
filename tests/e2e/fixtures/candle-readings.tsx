import { createRoot } from "react-dom/client";
import { TokenPriceChart } from "../../../components/trading/price-chart";
import styles from "../../../components/trading/forum-terminal.module.css";

createRoot(document.getElementById("root")!).render(
  <main
    data-surface="forum"
    aria-label="Invented chart fixture, not live market data"
    className="forum-app-shell bg-background text-foreground"
    style={{ height: "100dvh", overflow: "hidden" }}
  >
    <div className={styles.chartWorkspace}>
      <TokenPriceChart
        mint="So11111111111111111111111111111111111111112"
        symbol="FIXTURE"
        light={false}
        compact
      />
      <button className="focus-ring" type="button">
        After candle readings
      </button>
    </div>
  </main>,
);
