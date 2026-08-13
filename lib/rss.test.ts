import { describe, expect, test } from "vitest";
import { escapeXml, renderRssFeed } from "./rss";

describe("RSS rendering", () => {
  test("escapes XML-sensitive content and emits stable item metadata", () => {
    const xml = renderRssFeed({
      title: "A & B",
      url: "https://example.test/feed?a=1&b=2",
      description: "<safe> feed",
      items: [
        {
          title: "A <story> & \"quote\"",
          url: "https://example.test/story?a=1&b=2",
          description: "An author's note",
          publishedAt: "2026-08-13T12:00:00Z",
        },
      ],
    });

    expect(xml).toContain("<title>A &amp; B</title>");
    expect(xml).toContain("A &lt;story&gt; &amp; &quot;quote&quot;");
    expect(xml).toContain("<guid isPermaLink=\"true\">https://example.test/story?a=1&amp;b=2</guid>");
    expect(xml).toContain("<pubDate>Thu, 13 Aug 2026 12:00:00 GMT</pubDate>");
    expect(xml).not.toContain("<safe>");
  });

  test("leaves already-safe strings unchanged", () => {
    expect(escapeXml("plain text")).toBe("plain text");
  });
});
