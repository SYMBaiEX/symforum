// @vitest-environment node
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ForumPageHeader } from "@/components/forum/forum-layout-primitives";
import { metadata as aiReadableResearchMetadata } from "@/app/research/ai-readable-web/page";
import { metadata as editorialTrustResearchMetadata } from "@/app/research/editorial-trust-and-contracts/page";
import { metadata as contactMetadata } from "@/app/contact/page";
import { metadata as researchMetadata } from "@/app/research/page";

describe("public discovery surfaces", () => {
  test("social preview metadata includes a crawlable image and alt text", () => {
    const pages = [
      contactMetadata,
      editorialTrustResearchMetadata,
      researchMetadata,
      aiReadableResearchMetadata,
    ];

    for (const page of pages) {
      const openGraphImages = page.openGraph?.images;
      const openGraphImage = Array.isArray(openGraphImages)
        ? openGraphImages[0]
        : openGraphImages;
      expect(openGraphImage).toBeDefined();
      const openGraphDescriptor =
        typeof openGraphImage === "object" && openGraphImage !== null
          ? (openGraphImage as unknown as { alt?: string; url?: string })
          : null;
      expect(openGraphDescriptor?.alt?.trim().length ?? 0).toBeGreaterThan(0);
      expect(openGraphDescriptor?.url).toBeDefined();

      const twitterImages = page.twitter?.images;
      expect(twitterImages).toBeDefined();
      const twitterImage = Array.isArray(twitterImages)
        ? twitterImages[0]
        : twitterImages;
      expect(
        typeof twitterImage === "string" || typeof twitterImage === "object",
      ).toBe(true);
      const twitterDescriptor =
        typeof twitterImage === "object" && twitterImage !== null
          ? (twitterImage as { alt?: string; url?: string })
          : null;
      if (twitterDescriptor) {
        expect(twitterDescriptor.url).toBeDefined();
        expect(twitterDescriptor?.alt?.trim().length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  test("static public route metadata declares social image descriptors", () => {
    const routes = [
      "apps/platform/app/about/page.tsx",
      "apps/platform/app/agent/page.tsx",
      "apps/platform/app/ai-policy/page.tsx",
      "apps/blog/app/blog/page.tsx",
      "apps/news/app/news/page.tsx",
      "apps/newsletter/app/newsletter/page.tsx",
      "apps/platform/app/portfolio/page.tsx",
    ];

    for (const route of routes) {
      const source = readFileSync(resolve(process.cwd(), route), "utf8");
      expect(source).toMatch(/openGraph:\s*\{/);
      expect(source).toMatch(/twitter:\s*\{/);
      const openGraphStart = source.indexOf("openGraph:");
      const twitterStart = source.indexOf("twitter:", openGraphStart);
      const openGraphSource = source.slice(openGraphStart, twitterStart);
      expect(openGraphSource).toMatch(/url:\s*[`\"'][^`\"']*opengraph-image/);
      expect(openGraphSource).toMatch(/alt:\s*[`\"']/);
    }
  });

  test("archive routes expose one server-rendered H1", () => {
    const blogSource = readFileSync(
      resolve(process.cwd(), "components/blog-archive.tsx"),
      "utf8",
    );
    const newsSource = readFileSync(
      resolve(process.cwd(), "apps/news/app/news/page.tsx"),
      "utf8",
    );
    const newsletterSource = readFileSync(
      resolve(process.cwd(), "apps/newsletter/app/newsletter/page.tsx"),
      "utf8",
    );

    expect(blogSource.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(newsSource.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(newsletterSource).toMatch(/<h1[^>]*>Newsletter<\/h1>/);
  });

  test("the server-rendered blog archive owns post rows, not the client filter", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "apps/blog/app/blog/page.tsx"),
      "utf8",
    );
    const archiveSource = readFileSync(
      resolve(process.cwd(), "components/blog-archive.tsx"),
      "utf8",
    );
    const blogSource = readFileSync(
      resolve(process.cwd(), "components/blog-post-filter.tsx"),
      "utf8",
    );

    expect(routeSource).toContain("<BlogArchive");
    expect(archiveSource).not.toMatch(/^\s*["']use client["']/);
    expect(archiveSource).toMatch(/archivePosts\.map\(\(post\) => \(/);
    expect(archiveSource).toMatch(/function ArchiveEntry\(/);
    expect(blogSource).not.toMatch(/ArchiveEntry|BlogPostSummary\[\]/);
    expect(blogSource).not.toMatch(/<ArchiveEntry\b/);
  });

  test("the home banner keeps stable responsive URLs without preloading its decorative sprite", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/home-banner.tsx"),
      "utf8",
    );

    expect(source).toMatch(/home-banner-dark-750\.webp 750w/);
    expect(source).toMatch(/fetchPriority="high"/);
    expect(source).not.toMatch(/signal-moth-optimized\.webp/);
    expect(source).not.toMatch(/from "next\/image"/);
  });

  test("interactive forum routes keep a server-rendered H1 while data loads", () => {
    const routes = [
      "apps/forum/app/forum/announcements/page.tsx",
      "apps/forum/app/forum/online/page.tsx",
      "apps/forum/app/forum/calendar/page.tsx",
      "apps/forum/app/forum/help/page.tsx",
    ];

    for (const route of routes) {
      const source = readFileSync(resolve(process.cwd(), route), "utf8");
      expect(source.match(/<ForumPageHeader\b/g)).toHaveLength(1);
      expect(source).not.toMatch(/<h1\b/);
      expect(source).toMatch(
        /enabled=\{Boolean\(process\.env\.NEXT_PUBLIC_CONVEX_URL\)\}/,
      );
    }
  });

  test.each([
    ["apps/forum/app/forum/[categorySlug]/page.tsx", "categoryName"],
    ["apps/forum/app/forum/[categorySlug]/[threadSlug]/page.tsx", "title"],
  ])(
    "%s delegates its only page heading to the shared forum header",
    (route, titleVariable) => {
      const source = readFileSync(resolve(process.cwd(), route), "utf8");
      expect(source.match(/<ForumPageHeader\b/g)).toHaveLength(1);
      expect(source).toContain(`title={${titleVariable}}`);
      expect(source).not.toMatch(/<h1\b/);
      expect(source).toContain("showHeading={false}");
    },
  );

  test("the shared forum header server-renders one titled H1 before client data loads", () => {
    const html = renderToStaticMarkup(
      createElement(ForumPageHeader, {
        title: "Research & discussion",
        view: "boards",
        nested: true,
      }),
    );
    expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Research &amp; discussion<\/h1>/);
    expect(html).toContain("forum-page-header");
  });
});
