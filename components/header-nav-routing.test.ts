import { describe, expect, test } from "vitest";

import {
  isExternalHeaderHref,
  isHeaderRouteActive,
  resolveHeaderNavActive,
  resolveHeaderNavHref,
  shouldUseHeaderDocumentNavigation,
} from "./header-nav-routing";

const localForumLocation = {
  hostname: "forum.localhost",
  port: "3000",
  protocol: "http:",
};

const productionForumLocation = {
  hostname: "forum.symbaiex.com",
  port: "",
  protocol: "https:",
};

describe("header nav routing", () => {
  test("rewrites primary-site links off the forum host while keeping forum links local", () => {
    expect(
      resolveHeaderNavHref({
        forumHost: true,
        href: "/about",
        pathname: "/admin",
        primarySiteHref: "https://www.symbaiex.com/",
      }),
    ).toBe("https://www.symbaiex.com/about");
    expect(
      resolveHeaderNavHref({
        forumHost: true,
        href: "/about",
        location: productionForumLocation,
        pathname: "/search",
      }),
    ).toBe("https://www.symbaiex.com/about");
    expect(
      resolveHeaderNavHref({
        forumHost: true,
        href: "/blog",
        location: localForumLocation,
        pathname: "/search",
      }),
    ).toBe("http://localhost:3000/blog");
    expect(
      resolveHeaderNavHref({
        forumHost: true,
        href: "/forum",
        location: productionForumLocation,
        pathname: "/search",
      }),
    ).toBe("/");
    expect(
      resolveHeaderNavHref({
        forumHost: true,
        href: "/forum/subscriptions",
        location: productionForumLocation,
        pathname: "/search",
      }),
    ).toBe("/subscriptions");
    expect(
      resolveHeaderNavHref({
        forumHost: true,
        href: "https://agent.symbaiex.com/admin",
        location: productionForumLocation,
        pathname: "/search",
      }),
    ).toBe("https://agent.symbaiex.com/admin");
  });

  test("keeps site-owned auth and profile links on the forum host", () => {
    for (const href of ["/admin", "/profile", "/signin", "/u/austin"]) {
      expect(
        resolveHeaderNavHref({
          forumHost: true,
          href,
          location: productionForumLocation,
          pathname: "/search",
        }),
      ).toBe(href);
    }
  });

  test("normal host links preserve standard forum route prefixes", () => {
    expect(
      resolveHeaderNavHref({
        forumHost: false,
        href: "/forum",
        pathname: "/blog",
      }),
    ).toBe("/forum");
    expect(
      resolveHeaderNavHref({
        forumHost: false,
        href: "/forum/search",
        pathname: "/forum",
      }),
    ).toBe("/forum/search");
  });

  test("forum host active state treats clean forum paths as the forum section", () => {
    expect(
      resolveHeaderNavActive({
        forumHost: true,
        href: "/forum",
        pathname: "/search",
      }),
    ).toBe(true);
    expect(
      resolveHeaderNavActive({
        forumHost: true,
        href: "/about",
        pathname: "/search",
      }),
    ).toBe(false);
    expect(
      resolveHeaderNavActive({
        forumHost: true,
        href: "/forum",
        pathname: "/admin",
      }),
    ).toBe(false);
    expect(
      resolveHeaderNavActive({
        forumHost: true,
        href: "/signin",
        pathname: "/signin",
      }),
    ).toBe(true);
  });

  test("normal host active state and external detection stay predictable", () => {
    expect(isHeaderRouteActive("/", "/")).toBe(true);
    expect(isHeaderRouteActive("/blog/launch", "/blog")).toBe(true);
    expect(isHeaderRouteActive("/blogroll", "/blog")).toBe(false);
    expect(isExternalHeaderHref("https://github.com/symbaiex")).toBe(true);
    expect(isExternalHeaderHref("/forum")).toBe(false);
  });

  test("forces document navigation when leaving the forum host", () => {
    expect(
      shouldUseHeaderDocumentNavigation({
        forumHost: true,
        href: "/blog",
        resolvedHref: "/blog",
      }),
    ).toBe(true);
    expect(
      shouldUseHeaderDocumentNavigation({
        forumHost: true,
        href: "/blog",
        resolvedHref: "https://www.symbaiex.com/blog",
      }),
    ).toBe(true);
    expect(
      shouldUseHeaderDocumentNavigation({
        forumHost: true,
        href: "/forum",
        resolvedHref: "/",
      }),
    ).toBe(false);
    expect(
      shouldUseHeaderDocumentNavigation({
        forumHost: false,
        href: "/blog",
        resolvedHref: "/blog",
      }),
    ).toBe(false);
  });
});
