import { createRoot } from "react-dom/client";
import { TerminalPage } from "../../../components/trading/terminal-page";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider value={{ host: "website" }}>
    <div data-surface="forum" className="forum-app-shell">
      <TerminalPage enabled />
    </div>
  </ForumRuntimeContext.Provider>,
);
