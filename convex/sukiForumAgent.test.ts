// @vitest-environment node

import { describe, expect, test } from "vitest";

import { FORUM_THREAD_BODY_MAX_LENGTH } from "./forumLimits";
import {
  finalizeForumBody,
  imageRelevanceScore,
  parseFeedXml,
} from "./sukiForumAgent";

describe("Suki forum research helpers", () => {
  test("parses RSS candidates, canonicalizes URLs, and keeps source imagery", () => {
    const candidates = parseFeedXml(
      `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
        <channel>
          <item>
            <title>Useful &amp; verifiable release notes</title>
            <link>https://example.com/release?utm_source=feed&amp;version=4</link>
            <description><![CDATA[<p>A practical summary with evidence.</p>]]></description>
            <pubDate>Tue, 28 Jul 2026 12:00:00 GMT</pubDate>
            <media:content url="https://cdn.example.com/release.png" type="image/png" />
          </item>
        </channel>
      </rss>`,
      {
        boardSlugs: ["ai-frameworks"],
        feedUrl: "https://example.com/feed.xml",
        sourceName: "Example Releases",
      },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      boardSlugs: ["ai-frameworks"],
      imageUrl: "https://cdn.example.com/release.png",
      sourceName: "Example Releases",
      summary: "A practical summary with evidence.",
      title: "Useful & verifiable release notes",
      url: "https://example.com/release?version=4",
    });
    expect(candidates[0]?.sourceKey).toMatch(/^[0-9a-f]{16}$/);
  });

  test("removes unverified links and images while preserving the verified source block", () => {
    const body = finalizeForumBody(
      `[url=https://unverified.example/download]mystery download[/url]
[img]https://unverified.example/image.png[/img]

${"A useful field note. ".repeat(800)}`,
      [
        {
          articleDescription: "Primary evidence",
          articleText: "Primary evidence",
          articleTitle: "Primary research",
          boardSlugs: ["research-papers"],
          id: "candidate-1",
          imageCredit: "Example Research",
          publishedAt: Date.now(),
          sourceFeedUrl: "https://example.com/feed.xml",
          sourceKey: "source-1",
          sourceName: "Example Research",
          summary: "Primary evidence",
          title: "Primary research",
          url: "https://example.com/research",
        },
      ],
    );

    expect(body.length).toBeGreaterThan(11_950);
    expect(body.length).toBeLessThanOrEqual(FORUM_THREAD_BODY_MAX_LENGTH);
    expect(body).not.toContain("unverified.example");
    expect(body).toContain("mystery download");
    expect(body).toContain("[b]Sources and further reading[/b]");
    expect(body).toContain(
      "[url=https://example.com/research]Primary research[/url] — Example Research",
    );
    expect(body.endsWith("[/list]")).toBe(true);
  });

  test("rejects generic artwork and prefers relevant editorial imagery", () => {
    const base = {
      articleDescription: "A practical release with migration details",
      articleText: "Release migration details",
      articleTitle: "Framework 4 migration guide",
      boardSlugs: ["ai-frameworks"],
      id: "candidate-1",
      imageCredit: "Example Research",
      sourceFeedUrl: "https://example.com/feed.xml",
      sourceKey: "source-1",
      sourceName: "Example Research",
      summary: "Migration details",
      title: "Framework 4 migration guide",
      url: "https://example.com/research",
    };
    expect(
      imageRelevanceScore({
        ...base,
        imageUrl: "https://example.com/assets/logo.png",
      }),
    ).toBe(0);
    expect(
      imageRelevanceScore({
        ...base,
        imageAlt: "Framework 4 migration architecture",
        imageHeight: 630,
        imageUrl: "https://example.com/framework-4-migration.png",
        imageWidth: 1200,
      }),
    ).toBeGreaterThanOrEqual(55);
  });
});
