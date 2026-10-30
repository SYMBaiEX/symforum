// Public invented UI records only. No production transport or wallet exists.
import { createRoot } from "react-dom/client";
import { ForumTerminal } from "../../../components/trading/forum-terminal";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { ResearchPurchase } from "../../../components/trading/research-purchase";
import { SYMF_TOKEN } from "../../../lib/symf-token";
import { CommunityHub } from "../../../components/community/community-hub";
import { ThemeProvider } from "next-themes";

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
        className="forum-app-shell min-h-screen bg-background p-4 text-foreground"
      >
        {location.search.includes("community") ? (
          <CommunityHub />
        ) : location.search.includes("research") ? (
          <ResearchPurchase mint={SYMF_TOKEN.mint} />
        ) : (
          <ForumTerminal enabled />
        )}
      </div>
    </ThemeProvider>
  </ForumRuntimeContext.Provider>,
);
