import { describe, expect, test } from "vitest";

import { metadata as aiReadableResearchMetadata } from "@/app/research/ai-readable-web/page";
import { metadata as contactMetadata } from "@/app/contact/page";
import { metadata as researchMetadata } from "@/app/research/page";

describe("public discovery surfaces", () => {
  test("social preview metadata includes a crawlable image and alt text", () => {
    const pages = [
      contactMetadata,
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
    }
  });
});
