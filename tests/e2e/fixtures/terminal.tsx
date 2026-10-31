// Public invented UI records only. No production transport or wallet exists.
import { createRoot } from "react-dom/client";
import { ForumTerminal } from "../../../components/trading/forum-terminal";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { ResearchPurchase } from "../../../components/trading/research-purchase";
import { SYMF_TOKEN } from "../../../lib/symf-token";
import { CommunityHub } from "../../../components/community/community-hub";
import { ThemeProvider } from "next-themes";
import { parseTerminalMint } from "../../../lib/terminal-selection";
import { TerminalBoundary } from "../../../components/trading/terminal-boundary";

const parameters = new URLSearchParams(location.search);
const selection = parseTerminalMint(parameters.getAll("mint"));
const initialMint = selection.status === "valid" ? selection.mint : undefined;
const utility = parameters.has("community") || parameters.has("research");
const frame = !utility && !parameters.has("bare");
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
  <ForumRuntimeContext.Provider
    value={{ host: location.search.includes("plugin") ? "plugin" : "website" }}
  >
    <ThemeProvider
      attribute="class"
      defaultTheme={location.search.includes("dark") ? "dark" : "light"}
      enableSystem={false}
    >
      <div
        data-surface="forum"
        className={`forum-app-shell min-h-screen bg-background text-foreground ${utility || !frame ? "p-4" : ""}`}
      >
        {location.search.includes("community") ? (
          <CommunityHub />
        ) : location.search.includes("research") ? (
          <ResearchPurchase mint={SYMF_TOKEN.mint} />
        ) : selection.status === "invalid" ? (
          <p role="alert">Invalid fixture mint intent.</p>
        ) : frame ? (
          <>
            <header
              aria-label="Forum header"
              className="fixed inset-x-0 top-0 z-50 h-14 bg-card"
            >
              SYMBaiEX Forum
            </header>
            <aside
              aria-hidden="true"
              className="forum-left-rail"
              style={{
                position: "fixed",
                insetBlock: 0,
                insetInlineStart: 0,
                pointerEvents: "none",
              }}
            />
            <main className="forum-main min-h-[calc(100dvh-6rem)] pt-[var(--site-header-offset)] outline-none">
              <div className="forum-surface">
                <section
                  className="page-frame page-frame-dense"
                  data-forum-layout="terminal"
                >
                  {parameters.has("shellcontrol") ? (
                    <h1>Ordinary forum page</h1>
                  ) : (
                    <ForumTerminal
                      enabled
                      initialMint={initialMint}
                      renderUtilities={utilities}
                    />
                  )}
                </section>
              </div>
            </main>
            <footer className="forum-footer px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6">
              Normal forum footer
            </footer>
            <nav
              aria-label="Forum navigation"
              className="forum-bottom-nav fixed inset-x-0 bottom-0 z-50 h-14 bg-card md:hidden"
            >
              <a href="/forum">Forum home</a>
            </nav>
          </>
        ) : (
          <ForumTerminal enabled initialMint={initialMint} />
        )}
      </div>
    </ThemeProvider>
  </ForumRuntimeContext.Provider>,
);
