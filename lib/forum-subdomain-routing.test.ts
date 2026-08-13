import { describe, expect, test } from "vitest";

import {
  isForumSubdomainHost,
  resolveForumSubdomainRoute,
} from "./forum-subdomain-routing";

describe("forum subdomain routing", () => {
  test("rewrites the production forum host into /forum", () => {
    expect(
      resolveForumSubdomainRoute({
        host: "forum.symbaiex.com",
        nodeEnv: "production",
        pathname: "/announcements",
      }),
    ).toEqual({ kind: "rewrite", pathname: "/forum/announcements" });
    expect(
      resolveForumSubdomainRoute({
        host: "forum.symbaiex.com",
        nodeEnv: "production",
        pathname: "/help",
      }),
    ).toEqual({ kind: "rewrite", pathname: "/forum/help" });
    expect(
      resolveForumSubdomainRoute({
        host: "forum.symbaiex.com",
        nodeEnv: "production",
        pathname: "/moderation",
      }),
    ).toEqual({ kind: "rewrite", pathname: "/forum/moderation" });
    expect(
      resolveForumSubdomainRoute({
        host: "forum.symbaiex.com",
        nodeEnv: "production",
        pathname: "/calendar",
      }),
    ).toEqual({ kind: "rewrite", pathname: "/forum/calendar" });
    expect(
      resolveForumSubdomainRoute({
        host: "forum.symbaiex.com",
        nodeEnv: "production",
        pathname: "/",
      }),
    ).toEqual({ kind: "rewrite", pathname: "/forum" });
  });

  test("redirects canonical /forum paths off the forum host", () => {
    expect(
      resolveForumSubdomainRoute({
        host: "forum.symbaiex.com",
        nodeEnv: "production",
        pathname: "/forum/search",
      }),
    ).toEqual({ kind: "redirect", pathname: "/search" });
    expect(
      resolveForumSubdomainRoute({
        host: "forum.symbaiex.com",
        nodeEnv: "production",
        pathname: "/forum",
      }),
    ).toEqual({ kind: "redirect", pathname: "/" });
  });

  test("preserves site-owned routes on the forum host", () => {
    for (const pathname of [
      "/api/health",
      "/admin",
      "/signin",
      "/u/austin",
      "/robots.txt",
      "/sitemap.xml",
    ]) {
      expect(
        resolveForumSubdomainRoute({
          host: "forum.symbaiex.com",
          nodeEnv: "production",
          pathname,
        }),
      ).toBeNull();
    }
  });

  test("redirects primary-site content routes off the forum host", () => {
    for (const pathname of [
      "/about",
      "/ai-policy",
      "/blog",
      "/blog/old-web-notes",
      "/contact",
      "/feed/blog.xml",
      "/llms-full.txt",
      "/llms.txt",
      "/news/123",
      "/newsletter/preferences",
      "/portfolio/elizaos",
    ]) {
      expect(
        resolveForumSubdomainRoute({
          host: "forum.symbaiex.com",
          nodeEnv: "production",
          pathname,
        }),
      ).toEqual({ kind: "redirect", pathname, primaryHost: true });
    }
  });

  test("does not treat arbitrary forum-prefixed hosts as the forum", () => {
    expect(
      resolveForumSubdomainRoute({
        host: "forum.evil.test",
        nodeEnv: "production",
        pathname: "/announcements",
      }),
    ).toBeNull();
    expect(
      resolveForumSubdomainRoute({
        host: "forum.evil.test",
        nodeEnv: "production",
        pathname: "/help",
      }),
    ).toBeNull();
    expect(
      resolveForumSubdomainRoute({
        host: "forum.evil.test",
        nodeEnv: "production",
        pathname: "/calendar",
      }),
    ).toBeNull();
    expect(isForumSubdomainHost("forum.evil.test", "production")).toBe(false);
  });

  test("allows explicit local forum hosts outside production", () => {
    expect(isForumSubdomainHost("forum.localhost:3000", "development")).toBe(
      true,
    );
    expect(isForumSubdomainHost("forum.localhost:3000", "production")).toBe(
      false,
    );
  });
});
