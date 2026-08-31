import {
  isForumSubdomainHost,
  isForumSubdomainSiteRoute,
} from "@/lib/forum-subdomain-routing";

const FORUM_PRODUCTION_HOSTNAME = "forum.symbaiex.com";
const FORUM_PRODUCTION_ORIGIN = `https://${FORUM_PRODUCTION_HOSTNAME}`;
const PRIMARY_PRODUCTION_HOSTNAME = "www.symbaiex.com";
export function isForumHostname(hostname: string | undefined | null) {
  return isForumSubdomainHost(hostname);
}

export function isForumSubdomainSitePath(pathname: string | undefined | null) {
  return pathname
    ? isForumSubdomainSiteRoute(pathname.split(/[?#]/, 1)[0] ?? pathname)
    : false;
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

export function canonicalForumHref(href: string) {
  const cleanHref =
    href === "/forum"
      ? "/"
      : href.startsWith("/forum/")
        ? href.slice("/forum".length)
        : href;
  return new URL(cleanHref, FORUM_PRODUCTION_ORIGIN).toString();
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

  const hostname = primaryHostnameForForumHostname(location.hostname);
  const port =
    location.hostname === FORUM_PRODUCTION_HOSTNAME || !location.port
      ? ""
      : `:${location.port}`;
  return `${location.protocol}//${hostname}${port}${href}`;
}

export function primarySiteHrefForPath(primarySiteHref: string, href: string) {
  if (!href.startsWith("/") || href.startsWith("//")) {
    return href;
  }
  if (!/^https?:\/\//i.test(primarySiteHref)) {
    return href;
  }
  return new URL(href, primarySiteHref).toString();
}

function primaryHostnameForForumHostname(hostname: string) {
  if (hostname === FORUM_PRODUCTION_HOSTNAME) {
    return PRIMARY_PRODUCTION_HOSTNAME;
  }
  return hostname.slice("forum.".length);
}
