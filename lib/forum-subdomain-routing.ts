import { installation } from "./installation";
const FORUM_PRODUCTION_HOST = new URL(installation.sites.forum).hostname;
const FORUM_LOCAL_HOSTS = new Set([
  "forum.localhost",
  "forum.127.0.0.1",
  "forum.localtest.me",
]);
const FORUM_SUBDOMAIN_SITE_PREFIXES = [
  "/admin",
  "/api",
  "/profile",
  "/login",
  "/register",
  "/signin",
  "/signup",
  "/u",
  // Metadata endpoints are served without a host redirect; redirecting them
  // causes crawler loops and this app has no separate forum metadata handler.
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
];
const FORUM_SUBDOMAIN_PRIMARY_SITE_PREFIXES = [
  "/about",
  "/agent",
  "/agents.md",
  "/ai-policy",
  "/ask",
  "/auth.md",
  "/blog",
  "/contact",
  "/developer",
  "/developers",
  "/docs",
  "/feed",
  "/feeds",
  "/llms-full.txt",
  "/llms.txt",
  "/mcp",
  "/mcp.json",
  "/news",
  "/newsletter",
  "/portfolio",
  "/pricing",
  "/pricing.md",
  "/privacy",
  "/sandbox",
  "/schemamap.xml",
  "/skills.sh",
  "/terms",
];

export type ForumSubdomainRoute =
  | { kind: "redirect"; pathname: string; primaryHost?: boolean }
  | { kind: "rewrite"; pathname: string };
type RuntimeEnvironment = string | undefined;

export function resolveForumSubdomainRoute({
  host,
  nodeEnv = process.env.NODE_ENV,
  pathname,
}: {
  host: string | null | undefined;
  nodeEnv?: RuntimeEnvironment;
  pathname: string;
}): ForumSubdomainRoute | null {
  if (!isForumSubdomainHost(host, nodeEnv)) {
    return null;
  }

  if (pathname === "/forum" || pathname.startsWith("/forum/")) {
    return {
      kind: "redirect",
      pathname: pathname === "/forum" ? "/" : pathname.slice("/forum".length),
    };
  }

  // The forum advertises a documentation MCP surface. Keep its canonical
  // product MCP on the primary host while giving forum-scoped discovery a
  // small, read-only toolset instead of duplicating all evidence operations.
  if (pathname === "/mcp") {
    return { kind: "rewrite", pathname: "/api/docs/mcp" };
  }

  if (isForumSubdomainSiteRoute(pathname)) {
    return null;
  }

  if (isForumSubdomainPrimarySiteRoute(pathname)) {
    return {
      kind: "redirect",
      pathname,
      primaryHost: true,
    };
  }

  // /research is the public forum board, including its thread permalinks.
  // Primary-site research links must use the primary origin explicitly;
  // redirecting this board also redirects Next's RSC prefetch across origins.
  return {
    kind: "rewrite",
    pathname: pathname === "/" ? "/forum" : `/forum${pathname}`,
  };
}

export function isForumSubdomainHost(
  host: string | null | undefined,
  nodeEnv: RuntimeEnvironment = process.env.NODE_ENV,
) {
  const normalized = host?.split(":")[0]?.toLowerCase();
  if (normalized === FORUM_PRODUCTION_HOST) {
    return true;
  }
  if (nodeEnv !== "production" && normalized !== undefined) {
    return FORUM_LOCAL_HOSTS.has(normalized);
  }
  return false;
}

export function isForumSubdomainSiteRoute(pathname: string) {
  return FORUM_SUBDOMAIN_SITE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isForumSubdomainPrimarySiteRoute(pathname: string) {
  return FORUM_SUBDOMAIN_PRIMARY_SITE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
