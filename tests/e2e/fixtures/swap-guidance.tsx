import { createRoot } from "react-dom/client";
import { TokenSwap } from "../../../components/swap/token-swap";
createRoot(document.getElementById("root")!).render(
  <main data-surface="forum" className="forum-app-shell">
    <TokenSwap />
  </main>,
);
