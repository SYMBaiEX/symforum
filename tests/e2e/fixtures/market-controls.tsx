import { createRoot } from "react-dom/client";
import { MarketExplorer } from "../../../components/trading/market-explorer";
import { state, fixtureNow } from "./market-controls-state";
createRoot(document.getElementById("root")!).render(
  <main
    data-surface="forum"
    aria-label="Invented market-control fixture"
    className="forum-app-shell"
    style={{ height: "100dvh", overflow: "hidden" }}
  >
    <MarketExplorer
      selected=""
      onSelect={(choice) => state.selected.push(choice)}
      now={fixtureNow}
    />
  </main>,
);
