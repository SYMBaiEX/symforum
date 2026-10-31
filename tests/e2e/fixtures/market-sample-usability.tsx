import { createRoot } from "react-dom/client";
import { MarketExplorer } from "../../../components/trading/market-explorer";
import { state, useNow, usePanel } from "./market-sample-usability-state";
function Fixture() {
  const now = useNow();
  const panel = usePanel();
  return (
    <main
      data-surface="forum"
      className="forum-app-shell"
      aria-label="Invented market sample fixture"
      style={{
        height: "100dvh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div hidden={panel === "hidden"} style={{ flex: "1 1 0", minHeight: 0 }}>
        {panel !== "unmounted" && (
          <MarketExplorer
            selected=""
            onSelect={(choice) => state.selected.push(choice)}
            now={now}
          />
        )}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
