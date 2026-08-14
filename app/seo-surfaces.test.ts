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
});
