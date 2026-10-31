import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TokenPriceChart } from "../../../components/trading/price-chart";
import styles from "../../../components/trading/forum-terminal.module.css";

function Fixture() {
  const [mint, setMint] = useState(
    "So11111111111111111111111111111111111111112",
  );
  useEffect(() => {
    const change = () =>
      setMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    window.addEventListener("chart:switch", change);
    return () => window.removeEventListener("chart:switch", change);
  }, []);
  return (
    <main
      data-surface="forum"
      className="forum-app-shell bg-background text-foreground"
      style={{ height: "100dvh", overflow: "hidden" }}
    >
      <div className={styles.chartWorkspace}>
        <TokenPriceChart mint={mint} symbol="FIXTURE" light={false} compact />
        <button>After chart</button>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
