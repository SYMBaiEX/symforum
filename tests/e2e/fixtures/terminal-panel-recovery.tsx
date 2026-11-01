import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { ForumTerminal } from "../../../components/trading/forum-terminal";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { TerminalBoundary } from "../../../components/trading/terminal-boundary";
import {
  ResearchPurchase,
  CommunityHub,
} from "./terminal-panel-recovery-state";
const utilities = (mint: string, active: "research" | "community") => (
  <>
    <div hidden={active !== "research"}>
      <TerminalBoundary label="Research purchases">
        <ResearchPurchase mint={mint} />
      </TerminalBoundary>
    </div>
    <div hidden={active !== "community"}>
      <TerminalBoundary label="Community utilities">
        <CommunityHub mint={mint} compact />
      </TerminalBoundary>
    </div>
  </>
);
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <SurfaceScope.Provider value="forum">
      <ForumRuntimeContext.Provider value={{ host: "website" }}>
        <main
          data-surface="forum"
          className="forum-app-shell bg-background text-foreground"
        >
          <ForumTerminal enabled renderUtilities={utilities} />
        </main>
      </ForumRuntimeContext.Provider>
    </SurfaceScope.Provider>
  </ThemeProvider>,
);
