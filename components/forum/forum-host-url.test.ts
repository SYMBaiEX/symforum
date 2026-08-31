import { describe, expect, test } from "vitest";

import {
  canonicalForumHref,
  isForumHostname,
  primarySiteHrefForForumHost,
  primarySiteHrefForPath,
  shouldUseForumShell,
} from "./forum-host-url";

describe("forum host URL helpers", () => {
  test("builds canonical forum-host permalinks from app-router paths", () => {
    expect(canonicalForumHref("/forum/ai/thread-slug?postPage=2#post-21")).toBe(
      "https://forum.symbaiex.com/ai/thread-slug?postPage=2#post-21",
    );
    expect(canonicalForumHref("/forum")).toBe("https://forum.symbaiex.com/");
  });

  test("recognizes only the configured forum hosts", () => {
    expect(isForumHostname("forum.symbaiex.com")).toBe(true);
    expect(isForumHostname("forum.localhost")).toBe(true);
    expect(isForumHostname("forum.evil.test")).toBe(false);
  });

  test("rewrites primary-site links off the production forum host", () => {
    expect(
      primarySiteHrefForForumHost("/about", {
        hostname: "forum.symbaiex.com",
        port: "",
        protocol: "https:",
      }),
    ).toBe("https://www.symbaiex.com/about");
  });

  test("builds primary-site nav hrefs from an absolute primary host", () => {
    expect(primarySiteHrefForPath("https://www.symbaiex.com/", "/news")).toBe(
      "https://www.symbaiex.com/news",
    );
    expect(primarySiteHrefForPath("/", "/news")).toBe("/news");
    expect(
      primarySiteHrefForPath("https://www.symbaiex.com/", "//cdn.test"),
    ).toBe("//cdn.test");
  });

  test("preserves forum, site-owned, external, and arbitrary-host links", () => {
    const forumLocation = {
      hostname: "forum.symbaiex.com",
      port: "",
      protocol: "https:",
    };
    expect(primarySiteHrefForForumHost("/forum/search", forumLocation)).toBe(
      "/forum/search",
    );
    expect(primarySiteHrefForForumHost("/signin", forumLocation)).toBe(
      "/signin",
    );
    expect(primarySiteHrefForForumHost("/signup", forumLocation)).toBe(
      "/signup",
    );
    expect(
      primarySiteHrefForForumHost("/signup?mode=signUp", forumLocation),
    ).toBe("/signup?mode=signUp");
    expect(primarySiteHrefForForumHost("/login", forumLocation)).toBe("/login");
    expect(
      primarySiteHrefForForumHost("https://example.com", forumLocation),
    ).toBe("https://example.com");
    expect(primarySiteHrefForForumHost("//example.com", forumLocation)).toBe(
      "//example.com",
    );
    expect(
      primarySiteHrefForForumHost("/about", {
        hostname: "forum.evil.test",
        port: "",
        protocol: "https:",
      }),
    ).toBe("/about");
  });

  test("rewrites primary-site links from local forum hosts", () => {
    expect(
      primarySiteHrefForForumHost("/about", {
        hostname: "forum.localhost",
        port: "3000",
        protocol: "http:",
      }),
    ).toBe("http://localhost:3000/about");
  });

  test("rewrites audited primary routes and contracts off the forum host", () => {
    const forumLocation = {
      hostname: "forum.symbaiex.com",
      port: "",
      protocol: "https:",
    };
    for (const pathname of [
      "/pricing",
      "/pricing.md",
      "/agent",
      "/agent/signup",
      "/terms",
      "/research",
      "/auth.md",
      "/agents.md",
    ]) {
      expect(primarySiteHrefForForumHost(pathname, forumLocation)).toBe(
        `https://www.symbaiex.com${pathname}`,
      );
    }
  });

  test("uses forum shell for forum routes and clean forum-host paths", () => {
    expect(shouldUseForumShell({ forumHost: false, pathname: "/forum" })).toBe(
      true,
    );
    expect(
      shouldUseForumShell({ forumHost: false, pathname: "/forum/search" }),
    ).toBe(true);
    expect(shouldUseForumShell({ forumHost: true, pathname: "/search" })).toBe(
      true,
    );
    expect(shouldUseForumShell({ forumHost: true, pathname: "/" })).toBe(true);
  });

  test("keeps site-owned paths in the regular shell on the forum host", () => {
    for (const pathname of [
      "/admin",
      "/api/health",
      "/profile",
      "/signin",
      "/u/austin",
    ]) {
      expect(shouldUseForumShell({ forumHost: true, pathname })).toBe(false);
    }
    expect(shouldUseForumShell({ forumHost: false, pathname: "/about" })).toBe(
      false,
    );
  });
});
