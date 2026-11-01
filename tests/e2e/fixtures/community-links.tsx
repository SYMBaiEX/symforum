import { createRoot } from "react-dom/client";
import { ForumSiteShell } from "../../../components/forum/forum-site-shell";
import { ForumStartHere } from "../../../components/forum/forum-start-here";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { PRIMARY_SITE_URL } from "../../../lib/site-urls";
const params = new URLSearchParams(location.search);
const surface = (params.get("surface") ?? "forum") as
  "forum" | "blog" | "news" | "newsletter";
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider
    value={{ host: params.has("native") ? "plugin" : "website" }}
  >
    <div className="forum-surface">
      <ForumSiteShell
        forumHost={!location.pathname.startsWith("/forum/")}
        primarySiteHref={PRIMARY_SITE_URL}
        surface={surface}
      >
        {surface === "forum" ? (
          <section className="page-frame page-frame-dense">
            <ForumStartHere />
          </section>
        ) : (
          <p>Unchanged publication surface</p>
        )}
      </ForumSiteShell>
    </div>
  </ForumRuntimeContext.Provider>,
);
