import {
  isForumSubdomainSitePath,
  primarySiteHrefForForumHost,
  primarySiteHrefForPath,
  shouldLeaveForumHostForHref,
} from "@/components/forum/forum-host-url";
import { forumHrefForPathname } from "@/components/forum/forum-refs";

type HeaderNavLocation = Pick<Location, "hostname" | "port" | "protocol">;

export function resolveHeaderNavHref({
  forumHost,
  href,
  location,
  pathname,
  primarySiteHref,
}: {
  forumHost: boolean;
  href: string;
  location?: HeaderNavLocation;
  pathname: string | null;
  primarySiteHref?: string;
}) {
  if (forumHost) {
    if (shouldLeaveForumHostForHref(href)) {
      if (location) {
        return primarySiteHrefForForumHost(href, location);
      }
      if (primarySiteHref) {
        return primarySiteHrefForPath(primarySiteHref, href);
      }
    }
    return forumHrefForPathname(href, pathname);
  }
  return href;
}

export function resolveHeaderNavActive({
  forumHost,
  href,
  pathname,
}: {
  forumHost: boolean;
  href: string;
  pathname: string;
}) {
  if (!forumHost) {
    return isHeaderRouteActive(pathname, href);
  }
  if (href === "/forum") {
    return !isForumSubdomainSitePath(pathname);
  }
  if (shouldLeaveForumHostForHref(href)) {
    return false;
  }
  return isHeaderRouteActive(pathname, href);
}

export function isHeaderRouteActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isExternalHeaderHref(href: string) {
  return /^https?:\/\//i.test(href);
}

export function shouldUseHeaderDocumentNavigation({
  forumHost,
  href,
  resolvedHref,
}: {
  forumHost: boolean;
  href: string;
  resolvedHref: string;
}) {
  return (
    isExternalHeaderHref(resolvedHref) ||
    (forumHost && shouldLeaveForumHostForHref(href))
  );
}
