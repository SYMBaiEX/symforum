import { isForumSubdomainHost } from "@/lib/forum-subdomain-routing";

const FORUM_SITE_ROUTE_PREFIXES = [
  "/admin",
  "/api",
  "/profile",
  "/signin",
  "/u",
];

export function isForumHostname(hostname: string | undefined | null) {
  return isForumSubdomainHost(hostname);
}

export function isForumSubdomainSitePath(pathname: string | undefined | null) {
  if (!pathname) {
    return false;
  }
  return FORUM_SITE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function shouldLeaveForumHostForHref(href: string) {
  return (
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !href.startsWith("/forum") &&
    !isForumSubdomainSitePath(href)
  );
}

export function shouldUseForumShell({
  forumHost,
  pathname,
}: {
  forumHost: boolean;
  pathname: string | null | undefined;
}) {
  if (pathname === "/forum" || pathname?.startsWith("/forum/")) {
    return true;
  }
  if (!forumHost) {
    return false;
  }
  return !isForumSubdomainSitePath(pathname);
}

export function primarySiteHrefForForumHost(
  href: string,
  location: Pick<Location, "hostname" | "port" | "protocol">,
) {
  if (
    !shouldLeaveForumHostForHref(href) ||
    !isForumHostname(location.hostname)
  ) {
    return href;
  }

  const hostname = location.hostname.slice("forum.".length);
  const port = location.port ? `:${location.port}` : "";
  return `${location.protocol}//${hostname}${port}${href}`;
}
