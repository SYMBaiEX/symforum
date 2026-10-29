import { installation } from "../../../lib/installation";
import { installationWebOrigins } from "../../../lib/installation-config";

import { FORUM_SITE_URL } from "../../../lib/site-urls";
import {
  useSyncExternalStore,
  forwardRef,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from "react";
import { forumHost } from "./host";
let route = "/forum";
const listeners = new Set<() => void>();
export const subscribeRoute = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getRoute = () => route;
export function internalForumHref(href: string) {
  if (href.startsWith("#")) return `${route.split("#")[0]}${href}`;
  const url = new URL(href, FORUM_SITE_URL);
  if (
    !installationWebOrigins(installation).includes(url.origin)
  )
    return null;
  if (
    url.origin !== installation.sites.forum &&
    !url.pathname.startsWith("/forum") &&
    !url.pathname.startsWith("/signin")
  )
    return null;
  return `${url.pathname.startsWith("/forum") || url.pathname.startsWith("/signin") ? url.pathname : "/forum" + (url.pathname === "/" ? "" : url.pathname)}${url.search}${url.hash}`;
}
export function navigate(href: string, replace = false) {
  const internal = internalForumHref(href);
  if (!internal) {
    void forumHost.openLink(href);
    return;
  }
  if (internal === route) return;
  route = internal;
  const state = { forumRoute: route };
  if (replace) window.history.replaceState(state, "");
  else window.history.pushState(state, "");
  for (const listener of listeners) listener();
  window.dispatchEvent(new Event("forum:reading-navigation"));
  if (!route.includes("#")) window.scrollTo({ top: 0, behavior: "instant" });
}
window.addEventListener("popstate", (event) => {
  const value = event.state?.forumRoute;
  if (typeof value === "string") {
    route = value;
    for (const listener of listeners) listener();
  }
});
window.addEventListener("forum:host-route", (event) =>
  navigate((event as CustomEvent<string>).detail),
);
export function usePathname() {
  return useSyncExternalStore(subscribeRoute, getRoute, getRoute).split(
    /[?#]/,
  )[0];
}
export function useSearchParams() {
  const value = useSyncExternalStore(subscribeRoute, getRoute, getRoute);
  return new URL(value, FORUM_SITE_URL).searchParams;
}
export function useRouter() {
  return {
    push: navigate,
    replace: (href: string) => navigate(href, true),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.dispatchEvent(new Event("forum:host-refresh")),
    prefetch: () => {},
  };
}
export const notFound = () => {
  throw new Error("This forum page could not be found.");
};
export const redirect = (href: string) => {
  navigate(href);
  return null;
};
export const Link = forwardRef<
  HTMLAnchorElement,
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string | { pathname?: string; query?: Record<string, string> };
    prefetch?: boolean;
    replace?: boolean;
  }
>(function PluginLink(
  { href, prefetch: _prefetch, replace, onClick, ...props },
  ref,
) {
  const url =
    typeof href === "string"
      ? href
      : `${href.pathname ?? "/forum"}${href.query ? "?" + new URLSearchParams(href.query) : ""}`;
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    navigate(url, replace);
  };
  return <a {...props} href={url} ref={ref} onClick={click} />;
});
export default Link;
