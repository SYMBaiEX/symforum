import { describe, expect, test } from "vitest";
import {
  serializeJsonLd,
  siteStructuredData,
  forumCollectionStructuredData,
} from "@/lib/seo";

describe("serializeJsonLd", () => {
  test("escapes script-breaking characters", () => {
    const serialized = serializeJsonLd({
      description: "</script><script>alert(1)</script> & more",
    });

    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(serialized).toContain("\\u0026");
  });

  test("keeps the site graph canonical and omits retired search actions", () => {
    const graph = siteStructuredData()["@graph"];
    const website = graph.find((entry) => entry["@type"] === "WebSite");
    expect(website?.["@id"]).toBe("https://www.symbaiex.com#website");
    expect(website).not.toHaveProperty("potentialAction");
  });

  test("builds forum collection metadata with canonical breadcrumbs", () => {
    const data = forumCollectionStructuredData(
      "Forum help",
      "Public help documents.",
      "/help",
    );
    expect(data[0]).toMatchObject({
      "@type": "CollectionPage",
      url: "https://forum.symbaiex.com/help",
    });
    expect(data[1]).toMatchObject({ "@type": "BreadcrumbList" });
  });
});
