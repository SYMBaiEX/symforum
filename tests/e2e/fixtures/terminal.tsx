// Public invented UI records only. No production transport or wallet exists.
import { createRoot } from "react-dom/client";
import { ForumTerminal } from "../../../components/trading/forum-terminal";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";

createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider
    value={{ host: location.search.includes("plugin") ? "plugin" : "website" }}
  >
    <div
      data-surface="forum"
      className="forum-app-shell min-h-screen bg-background p-4 text-foreground"
    >
      <ForumTerminal enabled />
    </div>
  </ForumRuntimeContext.Provider>,
);
