import { createRoot } from "react-dom/client";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { SymfProjectDiscussions } from "../../../components/community/symf-project-discussions";
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle(
  "dark",
  params.get("theme") === "dark",
);
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <main
      className="forum-app-shell"
      data-surface="forum"
      style={{ padding: 16, maxWidth: 1200, margin: "auto" }}
    >
      <div className="forum-surface">
        <SymfProjectDiscussions />
      </div>
    </main>
  </SurfaceScope.Provider>,
);
