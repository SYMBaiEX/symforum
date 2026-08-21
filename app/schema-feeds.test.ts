import { describe, expect, test } from "vitest";

import { GET as getSchemaFeed } from "@/app/feeds/schema.jsonl/route";
import { GET as getSchemaMap } from "@/app/schemamap.xml/route";

describe("schema feed discovery", () => {
  test("publishes a Schema Map with JSONL and RSS feeds", async () => {
    const response = getSchemaMap();
    const xml = await response.text();

    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain("http://schema.org/schemas/schemafeed/0.1");
    expect(xml).toContain("https://www.symbaiex.com/feeds/schema.jsonl");
    expect(xml).toContain("structuredData/schema.org");
    expect(xml).toContain("structuredData/rss");
  });

  test("serves one valid schema.org object per JSONL line", async () => {
    const response = getSchemaFeed();
    const lines = (await response.text()).trim().split("\n");

    expect(response.headers.get("content-type")).toContain(
      "application/x-jsonlines",
    );
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      const value = JSON.parse(line);
      expect(value["@context"]).toBe("https://schema.org");
      expect(value["@type"]).toBeTruthy();
      expect(value["@id"] ?? value.url).toBeTruthy();
    }
  });
});
