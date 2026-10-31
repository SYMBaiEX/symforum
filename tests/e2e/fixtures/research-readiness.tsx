import { createRoot } from "react-dom/client";
import { ResearchPurchase } from "../../../components/trading/research-purchase";
import { TerminalBoundary } from "../../../components/trading/terminal-boundary";
import { actions, reads, update } from "./research-readiness-state";
declare global {
  interface Window {
    researchReadinessFixture: {
      update: typeof update;
      actions: string[];
      reads: string[];
    };
  }
}
window.researchReadinessFixture = { update, actions, reads };
createRoot(document.getElementById("root")!).render(
  <main data-surface="forum" className="p-4">
    <TerminalBoundary label="Research">
      <ResearchPurchase mint="5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump" />
    </TerminalBoundary>
  </main>,
);
