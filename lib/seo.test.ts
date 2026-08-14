import { describe, expect, test } from "vitest";
import {
  compactSeoTitle,
  serializeJsonLd,
  siteStructuredData,
  forumCollectionStructuredData,
} from "@/lib/seo";

describe("compactSeoTitle", () => {
  test("keeps dynamic titles within the title-tag budget", () => {
    const title = compactSeoTitle(
      "From Hollerith's holes to agentic threads: a day about how we encode trust and memory",
      "SYMBaiEX forum",
    );

    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toMatch(/\| SYMBaiEX forum$/);
    expect(title).toContain("From Hollerith's holes");
  });

  test("normalizes short titles without changing their words", () => {
    expect(
      compactSeoTitle("  About   Austin Hamilton ", "Austin Hamilton"),
    ).toBe("About Austin Hamilton | Austin Hamilton");
  });
});

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
