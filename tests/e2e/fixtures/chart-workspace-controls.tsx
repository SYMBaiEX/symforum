import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TokenPriceChart } from "../../../components/trading/price-chart";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../../components/ui/dialog";
import styles from "../../../components/trading/forum-terminal.module.css";
import "./chart-workspace-controls-state";

function Fixture() {
  const [mint, setMint] = useState(
    "So11111111111111111111111111111111111111112",
  );
  const [dialog, setDialog] = useState(false);
  const [light, setLight] = useState(false);
  useEffect(() => {
    const change = () =>
      setMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const open = () => setDialog(true);
    const theme = (event: Event) =>
      setLight((event as CustomEvent<boolean>).detail);
    window.addEventListener("chart:switch", change);
    window.addEventListener("chart:dialog", open);
    window.addEventListener("chart:light", theme);
    return () => {
      window.removeEventListener("chart:switch", change);
      window.removeEventListener("chart:dialog", open);
      window.removeEventListener("chart:light", theme);
    };
  }, []);
  return (
    <SurfaceScope.Provider value="forum">
      <main
        data-surface="forum"
        className="forum-app-shell bg-background text-foreground"
        style={{ height: "100dvh", overflow: "hidden" }}
      >
        <div className={styles.page}>
          <div className={styles.chartWorkspace}>
            <TokenPriceChart
              mint={mint}
              symbol="FIXTURE"
              light={light}
              compact
            />
            <button>After chart</button>
          </div>
        </div>
        <Dialog open={dialog} onOpenChange={setDialog}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Protected fixture controls</DialogTitle>
            <button>Keep protected state</button>
          </DialogContent>
        </Dialog>
      </main>
    </SurfaceScope.Provider>
  );
}
if (new URLSearchParams(location.search).has("terminal"))
  void import("./terminal");
else createRoot(document.getElementById("root")!).render(<Fixture />);
