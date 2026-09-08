// @vitest-environment node

import { describe, expect, test } from "vitest";

import {
  buildDigestBody,
  clipGeneratedProse,
  normalizeGeneratedHeadline,
} from "./belleForumAgent";
import { FORUM_THREAD_BODY_MAX_LENGTH } from "./forumLimits";

describe("Belle Hacker News digest", () => {
  test("renders a dated visual briefing with direct SYMBaiEX and source links", () => {
    const story = {
      hnItemId: 42,
      rank: 1,
      title: "A small systems tool changes how teams inspect production",
      url: "https://example.com/systems-tool",
      score: 240,
      descendants: 81,
    };
    const body = buildDigestBody({
      closing:
        "The larger shift is toward tools that make operational context legible to more people without hiding the underlying evidence.",
      date: "2026-07-28",
      opening:
        "Today's strongest thread is not a single launch. It is the steady move toward systems that help more people reason about production together.",
      requestedBriefs: [
        {
          hnItemId: 42,
          summary:
            "The project packages a focused inspection workflow around existing system signals and documents the boundaries of that approach.",
          analysis:
            "The useful part is less the interface than the pressure it puts on teams to make operational evidence readable and discussable.",
        },
      ],
      stories: [story],
    });

    expect(body).toContain("[chart=Today's Hacker News signal map]");
    expect(body).toContain(
      "[url=https://www.symbaiex.com/news/42]Read on SYMBaiEX News[/url]",
    );
    expect(body).toContain(
      "[url=https://example.com/systems-tool]Direct source[/url]",
    );
    expect(body).toContain(
      "[url=https://news.ycombinator.com/item?id=42]Hacker News discussion[/url]",
    );
    expect(body).toContain(
      "[url=https://www.symbaiex.com/news]Open the complete SYMBaiEX News desk[/url]",
    );
    expect(body).not.toContain("\nAnalysis:");
    expect(body.length).toBeLessThanOrEqual(FORUM_THREAD_BODY_MAX_LENGTH);
  });

  test("preserves the ending and links in a digest longer than the old cutoff", () => {
    const stories = Array.from({ length: 12 }, (_, index) => ({
      hnItemId: index + 1,
      rank: index + 1,
      title: `Story ${index + 1}: a substantial systems development with consequences`,
      url: `https://example.com/story-${index + 1}`,
      score: 300 - index * 10,
      descendants: 90 - index,
    }));
    const body = buildDigestBody({
      closing:
        "BELLE-CLOSING-SENTINEL The connective lesson is that durable technical progress depends on evidence people can inspect together.",
      date: "2026-07-29",
      opening:
        "This edition follows a common tension across the day's reporting. ".repeat(
          18,
        ),
      requestedBriefs: stories.map((story) => ({
        hnItemId: story.hnItemId,
        summary:
          `Summary ${story.hnItemId}. ` +
          "The reporting provides concrete context, scope, and constraints that readers need before drawing a conclusion. ".repeat(
            7,
          ),
        analysis:
          `Analysis ${story.hnItemId}. ` +
          "The practical implication is worth separating from the headline because teams will experience the tradeoffs differently. ".repeat(
            6,
          ),
      })),
      stories,
    });

    expect(body.length).toBeGreaterThan(11_900);
    expect(body.length).toBeLessThanOrEqual(FORUM_THREAD_BODY_MAX_LENGTH);
    expect(body).toContain("BELLE-CLOSING-SENTINEL");
    expect(body).toContain(
      "[url=https://www.symbaiex.com/news/12]Read on SYMBaiEX News[/url]",
    );
    expect(body).toContain(
      "What story here feels most consequential a month from now",
    );
  });

  test("clips generated prose at sentence boundaries and rejects dangling copy", () => {
    expect(
      clipGeneratedProse(
        "A complete first sentence. A second sentence that is too long to fit.",
        28,
        "summary",
      ),
    ).toBe("A complete first sentence.");
    expect(() =>
      clipGeneratedProse("A sentence without an ending", 80, "opening"),
    ).toThrow(/dangling sentence/);
    expect(() =>
      clipGeneratedProse(
        "An overlong first sentence that cannot fit safely.",
        12,
        "closing",
      ),
    ).toThrow(/cannot be clipped safely/);
    expect(() => normalizeGeneratedHeadline("A trailing headline:")).toThrow(
      /malformed or dangling/,
    );
  });
});
