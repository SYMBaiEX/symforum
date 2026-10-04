import { createRoot } from "react-dom/client";
import {
  Component,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { ForumSiteShell } from "../forum-site-shell";
import { ForumRuntimeContext } from "../forum-runtime-context";
import { ForumLoading, ForumStatusBox } from "../forum-primitives";
import { ForumPageHeader } from "../forum-layout-primitives";
import ForumLayout from "@/app/forum/layout";
import ForumError from "@/app/forum/error";
import ForumNotFound from "@/app/forum/not-found";
import { matchForumRoute } from "@/lib/forum-native-routing";
import { routes } from "./routes.generated";
import { forumHost, record } from "./host";
import {
  getRoute,
  navigate,
  subscribeRoute,
  internalForumHref,
} from "./router";
import { invalidateQueries } from "./data";

class PageBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <ForumError
        error={this.state.error}
        reset={() => {
          invalidateQueries();
          this.setState({ error: null });
        }}
      />
    ) : (
      this.props.children
    );
  }
}
function PluginConnection() {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const check = async () => {
    setChecking(true);
    try {
      await forumHost.refreshStatus();
      if (record(forumHost.status.actingAs).userId) navigate("/forum", true);
      else
        setMessage(
          "Connect SYMBaiEX Forum in your ChatGPT plugin settings, then check again.",
        );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not check the connection.",
      );
    } finally {
      setChecking(false);
    }
  };
  return (
    <section className="page-frame page-frame-dense">
      <ForumPageHeader
        title="Connect to join in"
        description="Browse freely. Connect your forum profile to post, save discussions and message members."
      />
      <ForumStatusBox
        title="Your forum profile, inside ChatGPT"
        body={
          message ||
          "Open ChatGPT settings → Plugins → SYMBaiEX Forum → Connect. Choose your profile and permissions."
        }
        action={
          <button
            disabled={checking}
            onClick={() => void check()}
            className="focus-ring min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            {checking ? "Checking…" : "Check connection"}
          </button>
        }
      />
    </section>
  );
}
function CurrentPage() {
  const fullRoute = useSyncExternalStore(subscribeRoute, getRoute, getRoute);
  const url = fullRoute.split("#")[0];
  const [page, setPage] = useState<{
    url: string;
    content: ReactNode;
    error?: Error;
  }>();
  useEffect(() => {
    let cancelled = false;
    const parsed = new URL(url, "https://forum.symbaiex.com");
    const match = matchForumRoute(routes, parsed.pathname);
    if (parsed.pathname === "/signin") {
      setPage({ url, content: <PluginConnection /> });
      return;
    }
    if (!match) {
      setPage({ url, content: <ForumNotFound /> });
      return;
    }
    const params = Promise.resolve(match.params);
    const searchParams = Promise.resolve(
      Object.fromEntries(parsed.searchParams),
    );
    // Route modules are the same server view factories Next.js uses. No React hooks live in these modules.
    const render = match.route.render as (props: {
      params: Promise<Record<string, string | string[]>>;
      searchParams: Promise<Record<string, string>>;
    }) => ReactNode | Promise<ReactNode>;
    Promise.resolve()
      .then(() => render({ params, searchParams }))
      .then(
        (content) => {
          if (!cancelled) setPage({ url, content });
        },
        (error) => {
          if (!cancelled)
            setPage({
              url,
              content: null,
              error: error instanceof Error ? error : new Error(String(error)),
            });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [url]);
  useEffect(() => {
    if (page?.url === url) {
      const hash = new URL(fullRoute, "https://forum.symbaiex.com").hash;
      if (hash)
        document
          .getElementById(decodeURIComponent(hash.slice(1)))
          ?.scrollIntoView();
    }
  }, [page, url, fullRoute]);
  if (page?.url !== url)
    return (
      <section className="page-frame page-frame-dense">
        <ForumLoading label="Loading this page" variant="threads" />
      </section>
    );
  if (page.error) throw page.error;
  return page.content;
}
function HostThemeSync() {
  const { resolvedTheme, setTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme === "dark" || resolvedTheme === "light")
      document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);
  useEffect(() => {
    const sync = (event: Event) =>
      setTheme((event as CustomEvent<string>).detail);
    window.addEventListener("forum:host-theme", sync);
    return () => window.removeEventListener("forum:host-theme", sync);
  }, [setTheme]);
  return null;
}
function App() {
  const footerRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const route = useSyncExternalStore(subscribeRoute, getRoute, getRoute);
  useEffect(() => {
    const stop = forumHost.subscribe(() => setRevision((value) => value + 1));
    void forumHost.connect().then(
      () => setReady(true),
      (error) =>
        setError(
          error instanceof Error
            ? error.message
            : "The host could not connect.",
        ),
    );
    const listener = () => {
      if (document.visibilityState === "visible")
        void forumHost.refreshStatus().catch(() => {});
    };
    document.addEventListener("visibilitychange", listener);
    const polling = setInterval(() => {
      if (document.visibilityState === "visible")
        void forumHost
          .refreshStatus()
          .then(invalidateQueries)
          .catch(() => {});
    }, 30_000);
    const resized = new ResizeObserver(() =>
      forumHost.notify("ui/notifications/size-changed", {
        width: document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight,
      }),
    );
    resized.observe(document.body);
    return () => {
      clearInterval(polling);
      stop();
      document.removeEventListener("visibilitychange", listener);
      resized.disconnect();
      forumHost.destroy();
    };
  }, []);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const anchor = (event.target as Element)?.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (href.startsWith("blob:") || href.startsWith("data:")) return;
      event.preventDefault();
      if (
        !anchor.hasAttribute("data-forum-owner-control") &&
        internalForumHref(href)
      )
        navigate(href);
      else void forumHost.openLink(href);
    };
    const submit = (event: SubmitEvent) => {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement))
        return;
      const form = event.target;
      if (form.method.toLowerCase() !== "get") return;
      const href = form.getAttribute("action") ?? route;
      if (!internalForumHref(href)) return;
      event.preventDefault();
      const query = new URLSearchParams();
      for (const [key, value] of new FormData(form))
        if (typeof value === "string") query.set(key, value);
      navigate(href.split("?")[0] + "?" + query);
    };
    document.addEventListener("click", click);
    document.addEventListener("submit", submit);
    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("submit", submit);
    };
  }, [route]);
  const status = forumHost.status;
  const actingAs = record(status.actingAs);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <HostThemeSync />
      <ForumRuntimeContext.Provider
        value={{
          host: "plugin",
          routeHash: new URL(route, "https://forum.symbaiex.com").hash,
          actingAs: actingAs.userId
            ? (actingAs as {
                userId: string;
                username: string;
                isAgent: boolean;
              })
            : null,
          executionMode:
            status.executionMode === "review" ? "review" : "direct",
          capabilities: Array.isArray(status.capabilities)
            ? status.capabilities
            : [],
          uploadFiles: (files) => forumHost.uploadFiles(files),
        }}
      >
        <div
          data-native-forum-runtime="2.2.0"
          data-connection-revision={revision}
        >
          <ForumSiteShell
            footerRef={footerRef}
            forumHost={false}
            primarySiteHref="https://www.symbaiex.com"
          >
            <ForumLayout>
              {error ? (
                <section className="page-frame page-frame-dense">
                  <ForumStatusBox title="Connection unavailable" body={error} />
                </section>
              ) : ready ? (
                <PageBoundary
                  key={route.split("#")[0] + String(status.connectionId)}
                >
                  <CurrentPage />
                </PageBoundary>
              ) : (
                <section className="page-frame page-frame-dense">
                  <ForumLoading label="Connecting to SYMBaiEX Forum" />
                </section>
              )}
            </ForumLayout>
          </ForumSiteShell>
        </div>
      </ForumRuntimeContext.Provider>
    </ThemeProvider>
  );
}
class HostBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="page-frame page-frame-dense">
        <ForumPageHeader title="Reconnect to the forum" />
        <ForumStatusBox
          title="The connection could not continue"
          body="Reload this view to check your current connection and permissions. Saved drafts remain on this device."
          action={
            <button
              className="focus-ring min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Reload forum
            </button>
          }
        />
      </section>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("forum-native-app")!).render(
  <HostBoundary>
    <App />
  </HostBoundary>,
);
