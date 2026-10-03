import { describe, expect, test } from "vitest";
import {
  compactSeoTitle,
  developerSoftwareStructuredData,
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
    expect(website).toMatchObject({
      "@id": "https://www.symbaiex.com#website",
      name: "Austin Hamilton (SYMBiEX)",
      alternateName: "SYMBaiEX",
    });
    expect(website).not.toHaveProperty("potentialAction");
    const organization = graph.find(
      (entry) => entry["@type"] === "Organization",
    );
    expect(organization).toMatchObject({
      name: "SYMBaiEX",
      alternateName: "SYMBiEX",
      contactPoint: { email: "austin@symbaiex.com" },
      address: { addressLocality: "Birmingham", addressRegion: "AL" },
    });
    const webApi = graph.find(
      (entry) =>
        Array.isArray(entry["@type"]) && entry["@type"].includes("WebAPI"),
    );
    expect(webApi).toMatchObject({
      "@type": ["Service", "WebAPI"],
      documentation: "https://www.symbaiex.com/api/agent/openapi.json",
    });
    expect(graph.some((entry) => entry["@type"] === "DataCatalog")).toBe(true);
    expect(
      graph.some((entry) => entry["@type"] === "SoftwareApplication"),
    ).toBe(false);
  });

  test("can include visible homepage SDK and CLI products in the site graph", () => {
    const graph = siteStructuredData({ includeHomeProducts: true })["@graph"];
    const applications = graph.filter(
      (entry) =>
        Array.isArray(entry["@type"]) &&
        entry["@type"].includes("SoftwareApplication"),
    );

    expect(applications).toEqual(developerSoftwareStructuredData());
    expect(applications.map((entry) => entry.name)).toEqual([
      "@symbaiex/agent-sdk",
      "@symbaiex/agent-cli",
    ]);
  });

  test("scopes installable client metadata to the developer surface", () => {
    const applications = developerSoftwareStructuredData();
    expect(applications).toEqual([
      expect.objectContaining({
        "@type": ["SoftwareApplication", "Product"],
        name: "@symbaiex/agent-sdk",
        applicationCategory: "DeveloperApplication",
        softwareVersion: "0.1.0",
        installUrl: "https://www.npmjs.com/package/@symbaiex/agent-sdk",
        codeRepository: "https://github.com/SYMBaiEX/symbaiex-agent-clients",
      }),
      expect.objectContaining({
        "@type": ["SoftwareApplication", "Product"],
        name: "@symbaiex/agent-cli",
        applicationCategory: "DeveloperApplication",
        softwareVersion: "0.1.0",
        installUrl: "https://www.npmjs.com/package/@symbaiex/agent-cli",
        codeRepository: "https://github.com/SYMBaiEX/symbaiex-agent-clients",
      }),
    ]);
    expect(JSON.stringify(applications)).not.toMatch(
      /AggregateRating|Review|Offer/,
    );
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
