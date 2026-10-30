import { describe, expect, test } from "vitest";
import {
  NEWS_MAX_AGE_MS,
  newsFeedTtl,
  newsInterval,
  newsPriority,
} from "./forum-breaking-news";

const now = Date.UTC(2026, 9, 29, 18);
const story = {
  title: "Solana launches a new integration",
  summary: "The mainnet deployment is available.",
  url: "https://solana.com/news/integration",
  publishedAt: now - 60_000,
};
describe("breaking Solana news policy", () => {
  test("requires freshness, Solana relevance and an actual development", () => {
    expect(newsPriority(story, now)).toBe("urgent");
    expect(newsPriority({ ...story, publishedAt: undefined }, now)).toBeNull();
    expect(
      newsPriority({ ...story, publishedAt: now - NEWS_MAX_AGE_MS - 1 }, now),
    ).toBeNull();
    expect(
      newsPriority({ ...story, publishedAt: now + 6 * 60_000 }, now),
    ).toBeNull();
    expect(
      newsPriority(
        {
          ...story,
          title: "Ethereum launches a product",
          summary: "A release",
        },
        now,
      ),
    ).toBeNull();
    expect(
      newsPriority(
        { ...story, title: "Solana price goes up", summary: "Bullish vibes" },
        now,
      ),
    ).toBeNull();
  });
  test("a fresh search result, recap or spoofed host cannot earn first-party urgency", () => {
    for (const url of [
      "https://example.com/news",
      "https://solana.com.evil.com/news",
      "https://blog.colosseum.com/codex/",
    ])
      expect(newsPriority({ ...story, url }, now)).toBe("priority");
    expect(
      newsPriority({ ...story, publishedAt: now - 2 * 3600_000 }, now),
    ).toBe("priority");
    expect(
      newsPriority({ ...story, publishedAt: now - 4 * 3600_000 }, now),
    ).toBe("routine");
  });
  test("an owner-verified original project host can earn urgency", () => {
    expect(
      newsPriority(
        {
          ...story,
          url: "https://project.org/announcement",
          verifiedPrimary: true,
        },
        now,
      ),
    ).toBe("urgent");
  });
  test("bounds free polling and publishing intervals", () => {
    expect(newsFeedTtl("https://status.solana.com/history.rss")).toBe(
      5 * 60_000,
    );
    expect(newsFeedTtl("https://www.bing.com/news/search?q=Solana")).toBe(
      15 * 60_000,
    );
    expect(newsInterval("urgent")).toBe(30 * 60_000);
    expect(newsInterval("priority")).toBe(60 * 60_000);
  });
  test("general mainnet or funding guidance does not become breaking news", () => {
    for (const title of [
      "Solana mainnet account guide",
      "Solana funding options explained",
    ])
      expect(
        newsPriority(
          {
            ...story,
            title,
            summary: "Documentation for Solana mainnet accounts.",
          },
          now,
        ),
      ).toBeNull();
    expect(
      newsPriority(
        {
          ...story,
          title: "Solana project announces $20 million funding",
          summary: "The seed round is closed.",
        },
        now,
      ),
    ).toBe("urgent");
  });
});
