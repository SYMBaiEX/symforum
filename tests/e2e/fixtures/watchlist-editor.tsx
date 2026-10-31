import { createRoot } from "react-dom/client";
import { WatchlistPanel } from "../../../components/trading/watchlist-panel";
import { editor, fixtureMint } from "./watchlist-editor-state";

createRoot(document.getElementById("root")!).render(
  <main
    data-surface="forum"
    className="forum-app-shell bg-background p-4 text-foreground"
  >
    <WatchlistPanel
      selected={{
        mint: fixtureMint,
        symbol: "SOL",
        name: "Invented fixture token",
      }}
      onSelect={(token) => editor.selected.push(token)}
    />
  </main>,
);
