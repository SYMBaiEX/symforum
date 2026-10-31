import { createRoot } from "react-dom/client";
import { WatchlistPanel } from "../../../components/trading/watchlist-panel";
import { ForumTerminal } from "../../../components/trading/forum-terminal";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { fixture } from "./watchlist-alert-inbox-state";
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider
    value={{ host: params.has("native") ? "plugin" : "website" }}
  >
    <main
      data-surface="forum"
      className="forum-app-shell bg-background p-3 text-foreground"
    >
      {params.has("integration") ? (
        <ForumTerminal enabled />
      ) : (
        <WatchlistPanel
          selected={{
            mint: "So11111111111111111111111111111111111111112",
            symbol: "SOL",
            name: "Fixture selected token",
          }}
          onSelect={(token) => fixture.selected.push(token)}
        />
      )}
    </main>
  </ForumRuntimeContext.Provider>,
);
