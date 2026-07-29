// @vitest-environment node

import { describe, expect, test } from "vitest";

import { buildDigestBody } from "./belleForumAgent";

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
    expect(body.length).toBeLessThanOrEqual(11_900);
  });
});
