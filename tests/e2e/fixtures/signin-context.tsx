import { createRoot } from "react-dom/client";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumNavigation } from "../../../components/forum/forum-navigation";
import { ForumShellContextProvider } from "../../../components/forum/forum-shell-context";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import "./signin-context-state";
const native =
  new URLSearchParams(location.search).get("fixtureNative") === "1";
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <ForumRuntimeContext.Provider
      value={{ host: native ? "plugin" : "website", routeHash: "#post-native" }}
    >
      <ForumShellContextProvider primarySiteHref="https://www.symbaiex.com/">
        <main data-surface="forum" className="forum-app-shell">
          <ForumNavigation />
          <p className="pt-24">
            Local sign-in context fixture. No authentication requests are
            allowed.
          </p>
        </main>
      </ForumShellContextProvider>
    </ForumRuntimeContext.Provider>
  </SurfaceScope.Provider>,
);
