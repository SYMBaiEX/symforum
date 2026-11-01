import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { ForumSiteShell } from "../../../components/forum/forum-site-shell";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { ForumFeedList } from "../../../components/forum/forum-feed-list";
import { CommunityHub } from "../../../components/community/community-hub";
import { TerminalPage } from "../../../components/trading/terminal-page";
import "./forum-density-state";
import { useForumShellContext } from "../../../components/forum/forum-shell-context";

const parameters = new URLSearchParams(location.search);
const flow = parameters.get("flow") ?? "feed";
const surface = (parameters.get("surface") ?? "forum") as
  "forum" | "blog" | "news" | "newsletter";
function DensityFixtureControl() {
  const { setDensity } = useForumShellContext();
  useEffect(() => {
    const update = (event: Event) =>
      setDensity(
        (event as CustomEvent<string>).detail === "compact"
          ? "compact"
          : "comfortable",
      );
    window.addEventListener("density-fixture:set", update);
    return () => window.removeEventListener("density-fixture:set", update);
  }, [setDensity]);
  return null;
}
function Content() {
  return (
    <>
      {surface !== "forum" ? (
        <p>Unchanged publication surface</p>
      ) : flow === "community" ? (
        <CommunityHub compact={parameters.has("embed")} />
      ) : flow === "terminal" ? (
        <TerminalPage enabled />
      ) : (
        <ForumFeedList sort="active" communityOnly={false} />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <ForumRuntimeContext.Provider
    value={{ host: parameters.has("native") ? "plugin" : "website" }}
  >
    <ForumSiteShell
      forumHost
      primarySiteHref="https://primary.example.test"
      surface={surface}
    >
      <DensityFixtureControl />
      <div className="forum-surface">
        <section
          className="page-frame page-frame-dense"
          data-forum-layout={flow === "terminal" ? "terminal" : undefined}
        >
          <Content />
        </section>
      </div>
    </ForumSiteShell>
  </ForumRuntimeContext.Provider>,
);
