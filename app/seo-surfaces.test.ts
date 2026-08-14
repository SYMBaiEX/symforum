import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
      "app/about/page.tsx",
      "app/agent/page.tsx",
      "app/ai-policy/page.tsx",
      "app/blog/page.tsx",
      "app/news/page.tsx",
      "app/newsletter/page.tsx",
      "app/portfolio/page.tsx",
    ];

    for (const route of routes) {
      const source = readFileSync(resolve(process.cwd(), route), "utf8");
      expect(source).toMatch(/openGraph:\s*\{/);
      expect(source).toMatch(/twitter:\s*\{/);
      expect(source).toMatch(/url:\s*[`\"'][^`\"']*opengraph-image/);
      expect(source).toMatch(/alt:\s*[`\"']/);
    }
  });

  test("archive routes expose one server-rendered H1", () => {
    const blogSource = readFileSync(
      resolve(process.cwd(), "app/blog/page.tsx"),
      "utf8",
    );
    const newsSource = readFileSync(
      resolve(process.cwd(), "app/news/page.tsx"),
      "utf8",
    );
    const newsletterSource = readFileSync(
      resolve(process.cwd(), "app/newsletter/page.tsx"),
      "utf8",
    );

    expect(blogSource).toMatch(/headingLevel="h1"/);
    expect(newsSource).toMatch(/headingLevel="h1"/);
    expect(newsletterSource).toMatch(/<h1[^>]*>Newsletter<\/h1>/);
  });

  test("interactive forum routes keep a server-rendered H1 while data loads", () => {
    const routes = [
      "app/forum/[categorySlug]/page.tsx",
      "app/forum/[categorySlug]/[threadSlug]/page.tsx",
      "app/forum/announcements/page.tsx",
      "app/forum/online/page.tsx",
      "app/forum/calendar/page.tsx",
      "app/forum/help/page.tsx",
    ];

    for (const route of routes) {
      expect(readFileSync(resolve(process.cwd(), route), "utf8")).toMatch(
        /<h1\b/,
      );
    }
  });

  test("the no-script Markdown mirror does not add a second H1", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/no-script-fallback.tsx"),
      "utf8",
    );
    expect(source).toMatch(/headingLevelOffset=\{1\}/);
  });
});
