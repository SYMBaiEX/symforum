// Public invented UI records only. No production transport or wallet exists.
import { createRoot } from "react-dom/client";
import { ForumTerminal } from "../../../components/trading/forum-terminal";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { ResearchPurchase } from "../../../components/trading/research-purchase";
import { SYMF_TOKEN } from "../../../lib/symf-token";
import { CommunityHub } from "../../../components/community/community-hub";
import { ThemeProvider } from "next-themes";
import { parseTerminalMint } from "../../../lib/terminal-selection";

const parameters = new URLSearchParams(location.search);
const selection = parseTerminalMint(parameters.getAll("mint"));
const initialMint = selection.status === "valid" ? selection.mint : undefined;
const utility = parameters.has("community") || parameters.has("research");
const frame = parameters.has("frame");

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
            <main className="forum-main">
              <div className="forum-surface">
                <section
                  className="page-frame page-frame-dense"
                  data-forum-layout="terminal"
                >
                  <ForumTerminal enabled initialMint={initialMint} />
                </section>
              </div>
            </main>
          </>
        ) : (
          <ForumTerminal enabled initialMint={initialMint} />
        )}
      </div>
    </ThemeProvider>
  </ForumRuntimeContext.Provider>,
);
