// @vitest-environment node

import { describe, expect, test } from "vitest";

import {
  BELLE_DIGEST_RETRY_ARGUMENT_BUDGET_BYTES,
  buildDigestBody,
  boundBelleDigestToRetrievedEvidence,
  belleDigestRetryArguments,
  canReuseDailyDigestStories,
  clipGeneratedProse,
  normalizeGeneratedHeadline,
} from "./belleForumAgent";
import { FORUM_THREAD_BODY_MAX_LENGTH } from "./forumLimits";
import type { ReusableDailyDigestStory } from "./newsDigestTypes";
import type { ArticleSnapshot } from "./sukiForumAgent";

describe("Belle Hacker News digest", () => {
  test("reuses successful bounded article snapshots across a retry", () => {
    const story: ReusableDailyDigestStory = {
      hnItemId: 42,
      snapshotDate: "2026-10-03",
      rank: 1,
      title: "A research update",
      summary: "A concise source summary with enough context for the digest.",
    };
    const fetchedSnapshot: ArticleSnapshot = {
      id: "hn-42-0",
      sourceKey: "hn-42",
      sourceName: "Example",
      sourceFeedUrl: "https://example.com/feed",
      title: "A research update",
      url: "https://example.com/research-update",
      summary: story.summary,
      boardSlugs: ["news-hacker-news"],
      articleTitle: "A research update",
      articleDescription: "A longer description of the research update.",
      articleText: "Fetched source evidence.",
      imageCredit: "Example",
      sourceFetchSucceeded: true,
    };
    const failedSnapshot = {
      ...fetchedSnapshot,
      id: "hn-43-1",
      sourceKey: "hn-43",
      url: "https://example.com/temporarily-unavailable",
      sourceFetchSucceeded: false,
    };

    const retry = belleDigestRetryArguments({
      snapshotDate: "2026-10-03",
      attempt: 1,
      reusableDigestStories: [story],
      reusableDigestSnapshotCompletedAt: 1_800_000_000_000,
      reusableArticleSnapshots: [fetchedSnapshot, failedSnapshot],
    });

    expect(retry).toMatchObject({
      snapshotDate: "2026-10-03",
      attempt: 1,
      reusableDigestStories: [story],
      reusableDigestSnapshotCompletedAt: 1_800_000_000_000,
      reusableArticleSnapshots: [fetchedSnapshot],
    });
  });

  test("caps retry reuse payload while keeping later small successful snapshots", () => {
    const snapshot: ArticleSnapshot = {
      id: "hn-42-0",
      sourceKey: "hn-42",
      sourceName: "Example",
      sourceFeedUrl: "https://example.com/feed",
      title: "A research update",
      url: "https://example.com/research-update",
      summary: "A concise source summary.",
      boardSlugs: ["news-hacker-news"],
      articleTitle: "A research update",
      articleDescription: "A source description.",
      articleText: "Fetched source evidence.",
      imageCredit: "Example",
      sourceFetchSucceeded: true,
    };
    const tooLarge = {
      ...snapshot,
      articleText: "x".repeat(BELLE_DIGEST_RETRY_ARGUMENT_BUDGET_BYTES + 1),
    };

    const retry = belleDigestRetryArguments({
      snapshotDate: "2026-10-03",
      attempt: 1,
      reusableArticleSnapshots: [tooLarge, snapshot],
    });

    expect(retry.reusableArticleSnapshots).toEqual([snapshot]);
    expect(
      new TextEncoder().encode(JSON.stringify(retry)).byteLength,
    ).toBeLessThanOrEqual(BELLE_DIGEST_RETRY_ARGUMENT_BUDGET_BYTES);
  });

  test("keeps the maximum weekly source packet under the retry budget", () => {
    const articleText = "🚀".repeat(6_000);
    const snapshots: ArticleSnapshot[] = Array.from(
      { length: 28 },
      (_, index) => ({
        id: `hn-${index + 1}-0`,
        sourceKey: `hn-${index + 1}`,
        sourceName: "Example research publication",
        sourceFeedUrl: "https://example.com/feed",
        title: `Research update ${index + 1}`,
        url: `https://example.com/research-update-${index + 1}`,
        summary: "A concise source summary.",
        boardSlugs: ["news-hacker-news"],
        articleTitle: `Research update ${index + 1}`,
        articleDescription: "A source description.",
        articleText,
        imageCredit: "Example",
        sourceFetchSucceeded: true,
      }),
    );

    const retry = belleDigestRetryArguments({
      snapshotDate: "2026-10-03",
      attempt: 1,
      reusableArticleSnapshots: snapshots,
    });

    expect(retry.reusableArticleSnapshots).toHaveLength(28);
    expect(
      new TextEncoder().encode(JSON.stringify(retry)).byteLength,
    ).toBeLessThanOrEqual(BELLE_DIGEST_RETRY_ARGUMENT_BUDGET_BYTES);
  });

  test("reuses only the exact ranked stories from the unchanged snapshot", () => {
    const stories: ReusableDailyDigestStory[] = Array.from(
      { length: 12 },
      (_, index) => ({
        hnItemId: index + 1,
        snapshotDate: "2026-10-02",
        rank: index + 1,
        title: `Story ${index + 1}`,
        summary: `Source summary ${index + 1}`,
      }),
    );
    const snapshot = {
      stories,
      snapshotDate: "2026-10-02",
      snapshotStoryCount: 18,
      snapshotCompletedAt: 1_800_000_000_000,
      expectedCompletedAt: 1_800_000_000_000,
    };

    expect(canReuseDailyDigestStories(snapshot)).toBe(true);
    expect(
      canReuseDailyDigestStories({
        ...snapshot,
        snapshotCompletedAt: snapshot.snapshotCompletedAt + 1,
      }),
    ).toBe(false);
    expect(
      canReuseDailyDigestStories({
        ...snapshot,
        stories: stories.slice(1),
      }),
    ).toBe(false);
    expect(
      canReuseDailyDigestStories({
        ...snapshot,
        stories: stories.map((story, index) =>
          index === 4 ? { ...story, snapshotDate: "2026-10-01" } : story,
        ),
      }),
    ).toBe(false);
  });

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

    expect(body).not.toContain("[chart=");
    expect(body).not.toContain("Belle's read");
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

    expect(body.length).toBeLessThan(11_900);
    expect(body).toContain("[spoiler=More from today's desk]");
    expect(body.length).toBeLessThanOrEqual(FORUM_THREAD_BODY_MAX_LENGTH);
    expect(body).toContain("BELLE-CLOSING-SENTINEL");
    expect(body).toContain(
      "[url=https://www.symbaiex.com/news/12]Read on SYMBaiEX News[/url]",
    );
    expect(body).not.toContain("What story here feels most consequential");
  });

  test("preserves schema-valid long sentences in collapsed digest stories", () => {
    const summary =
      "The project documents how operators can recover interrupted synchronization jobs using existing checkpoint records while preserving the original ordering guarantees and making the recovery boundary visible to teams that need to inspect the evidence before deciding whether the change fits their deployment.";
    expect(summary.length).toBeGreaterThan(260);
    expect(summary.length).toBeLessThanOrEqual(450);
    const stories = Array.from({ length: 12 }, (_, index) => ({
      hnItemId: index + 1,
      rank: index + 1,
      title: `Systems update ${index + 1}`,
    }));
    const body = buildDigestBody({
      date: "2026-10-07",
      opening: "Today's desk covers twelve systems updates.",
      closing: "",
      stories,
      requestedBriefs: stories.map((story) => ({
        hnItemId: story.hnItemId,
        summary,
        analysis: "",
      })),
    });
    expect(body.split(summary)).toHaveLength(13);
    expect(body).toContain("[spoiler=More from today's desk]");
    expect(body).toContain("news/12");
    expect(body.length).toBeLessThanOrEqual(FORUM_THREAD_BODY_MAX_LENGTH);
  });

  test("unretrieved articles stay labeled links and cannot retain inferred claims", () => {
    const failed: ArticleSnapshot = {
      id: "hn-42",
      sourceKey: "hn-42",
      sourceName: "HN",
      sourceFeedUrl: "https://news.ycombinator.com",
      title: "A linked headline",
      url: "https://example.com/article",
      summary: "Feed metadata",
      boardSlugs: ["news-hacker-news"],
      articleTitle: "A linked headline",
      articleDescription: "Feed metadata",
      articleText: "Feed metadata",
      imageCredit: "HN",
      sourceFetchSucceeded: false,
    };
    const bound = boundBelleDigestToRetrievedEvidence(
      {
        headline: "A linked headline",
        opening: "Here are linked headlines.",
        closing: "",
        briefs: [
          {
            hnItemId: 42,
            summary: "The source guarantees a faster model.",
            analysis: "The new system saves money.",
          },
        ],
        claims: [
          {
            claim: "The source guarantees a faster model.",
            sourceCandidateId: "hn-42",
            confidence: "high",
            kind: "fact",
          },
        ],
      },
      [failed],
    );
    expect(bound.claims).toEqual([]);
    expect(bound.briefs[0]?.analysis).toBe("");
    expect(bound.briefs[0]?.summary).toContain("unverified headline");
    const body = buildDigestBody({
      date: "2026-10-07",
      opening: bound.opening,
      closing: "",
      requestedBriefs: bound.briefs,
      stories: [
        {
          hnItemId: 42,
          rank: 1,
          title: failed.title,
          url: failed.url,
          sourceUnavailable: true,
        },
      ],
    });
    expect(body).toContain("Headline only");
    expect(body).toContain("https://example.com/article");
    expect(body).not.toMatch(/guarantees|saves money/);
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

  test("never clips a decimal, version, or honorific into a fake sentence", () => {
    for (const body of [
      "Release 2.7 supports a narrowly scoped API with documented prerequisites.",
      "The measured cost was 2.7 dollars in this bounded fixture.",
      "Dr. Rivera published a narrowly scoped update with prerequisites.",
    ]) {
      expect(() => clipGeneratedProse(body, 12, "summary")).toThrow(
        /cannot be clipped safely/,
      );
      expect(
        clipGeneratedProse(`A complete sentence. ${body}`, 33, "summary"),
      ).toBe("A complete sentence.");
    }
  });
});
