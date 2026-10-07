// @vitest-environment node

import { describe, expect, test } from "vitest";
import { z } from "zod";

import {
  BELLE_DIGEST_RETRY_ARGUMENT_BUDGET_BYTES,
  belleErrorMessage,
  belleDigestOutputSchema,
  buildDigestBody,
  boundBelleDigestToRetrievedEvidence,
  belleDigestRetryArguments,
  canReuseDailyDigestStories,
  clipGeneratedProse,
  normalizeGeneratedHeadline,
  flattenBelleDigestOutput,
  validateBelleDigestClaimSources,
} from "./belleForumAgent";
import { FORUM_THREAD_BODY_MAX_LENGTH } from "./forumLimits";
import type { ReusableDailyDigestStory } from "./newsDigestTypes";
import type { ArticleSnapshot } from "./sukiForumAgent";
import { AgentPublicationQualityError } from "../lib/agent-publication-quality";

describe("Belle Hacker News digest", () => {
  test("model prose schema rejects unfinished copy and markup while allowing optional empty fields", () => {
    const schema = belleDigestOutputSchema([
      { id: "hn-1-0", sourceFetchSucceeded: true },
      { id: "hn-2-1", sourceFetchSucceeded: true },
    ]);
    const output = groupedDigestFixture();
    expect(schema.safeParse(output).success).toBe(true);
    const unfinished = "The article explains recovery but leaves the next step";
    for (const field of ["opening", "closing"] as const) {
      expect(schema.safeParse({ ...output, [field]: unfinished }).success).toBe(
        false,
      );
    }
    for (const field of ["summary", "analysis"] as const) {
      expect(
        schema.safeParse({
          ...output,
          briefs: output.briefs.map((brief, index) =>
            index === 0 ? { ...brief, [field]: unfinished } : brief,
          ),
        }).success,
      ).toBe(false);
    }
    for (const markup of [
      "[b]The source describes checkpoint recovery.[/b]",
      "<b>The source describes checkpoint recovery.</b>",
    ]) {
      expect(schema.safeParse({ ...output, opening: markup }).success).toBe(
        false,
      );
      expect(() => clipGeneratedProse(markup, 500, "opening")).toThrow(
        AgentPublicationQualityError,
      );
    }
    expect(schema.safeParse({ ...output, opening: "" }).success).toBe(false);
    expect(
      schema.safeParse({
        ...output,
        briefs: output.briefs.map((brief, index) =>
          index === 0 ? { ...brief, summary: "" } : brief,
        ),
      }).success,
    ).toBe(false);
    expect(clipGeneratedProse("", 350, "analysis")).toBe("");
    expect(clipGeneratedProse("", 500, "closing")).toBe("");
    const jsonSchema = z.toJSONSchema(schema);
    expect(jsonSchema.properties?.opening).toHaveProperty("pattern");
    expect(jsonSchema.properties?.closing).toHaveProperty("pattern");
  });

  test("schema and renderer preserve complete sentences ending in Unicode closing quotes", () => {
    const schema = belleDigestOutputSchema([
      { id: "hn-1-0", sourceFetchSucceeded: true },
      { id: "hn-2-1", sourceFetchSucceeded: true },
    ]);
    for (const prose of [
      "The release notes say: “Checkpoint recovery is now available.”",
      "The release notes say: ‘Checkpoint recovery is now available.’",
    ]) {
      const output = {
        ...groupedDigestFixture(),
        opening: prose,
        closing: prose,
        briefs: groupedDigestFixture().briefs.map((brief) => ({
          ...brief,
          summary: prose,
          analysis: prose,
        })),
      };
      expect(schema.safeParse(output).success).toBe(true);
      for (const field of [
        "opening",
        "summary",
        "analysis",
        "closing",
      ] as const) {
        expect(clipGeneratedProse(prose, 500, field)).toBe(prose);
        expect(() => clipGeneratedProse(prose, 25, field)).toThrow(
          /cannot be clipped safely/,
        );
      }
      const rendered = buildDigestBody({
        date: "2026-10-07",
        opening: prose,
        closing: prose,
        requestedBriefs: [output.briefs[0]],
        stories: [
          { hnItemId: 1, rank: 1, title: "Checkpoint recovery release" },
        ],
      });
      expect(rendered).toContain(prose);
      expect(rendered).not.toContain("…");
    }
  });

  test("model JSON schema requires a factual group for every retrieved source", () => {
    const sources = [
      { id: "hn-1-0", sourceFetchSucceeded: true },
      { id: "hn-2-1", sourceFetchSucceeded: true },
      { id: "hn-3-2", sourceFetchSucceeded: false },
    ];
    const schema = belleDigestOutputSchema(sources);
    const output = groupedDigestFixture();
    expect(schema.safeParse(output).success).toBe(true);
    const jsonSchema = z.toJSONSchema(schema);
    expect(jsonSchema.properties?.claimsBySource).toMatchObject({
      type: "object",
      required: ["hn-1-0", "hn-2-1"],
      additionalProperties: false,
    });
    expect(
      schema.safeParse({
        ...output,
        claimsBySource: { "hn-1-0": output.claimsBySource["hn-1-0"] },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...output,
        claimsBySource: { ...output.claimsBySource, "hn-2-1": [] },
      }).success,
    ).toBe(false);
    for (const invalidId of ["fabricated", "hn-3-2"]) {
      expect(
        schema.safeParse({
          ...output,
          claimsBySource: {
            ...output.claimsBySource,
            [invalidId]: output.claimsBySource["hn-1-0"],
          },
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...output,
          analysisClaims: [
            {
              ...output.claimsBySource["hn-1-0"][0],
              kind: "analysis",
              sourceCandidateId: invalidId,
            },
          ],
        }).success,
      ).toBe(false);
    }
    expect(
      schema.safeParse({
        ...output,
        claimsBySource: {
          ...output.claimsBySource,
          "hn-2-1": [
            { ...output.claimsBySource["hn-2-1"][0], kind: "analysis" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...output, claims: [] }).success).toBe(false);
    expect(() =>
      belleDigestOutputSchema([
        { id: "unavailable", sourceFetchSucceeded: false },
      ]),
    ).toThrow(AgentPublicationQualityError);
  });

  test("flattening injects exact factual source IDs and preserves all authored prose for evidence review", () => {
    const sources = [
      { id: "hn-1-0", sourceFetchSucceeded: true },
      { id: "hn-2-1", sourceFetchSucceeded: true },
    ];
    const output = {
      ...groupedDigestFixture(),
      analysisClaims: [
        {
          claim:
            "This suggests testing one stopped job before changing configuration.",
          sourceCandidateId: "hn-1-0",
          confidence: "medium" as const,
          kind: "analysis" as const,
        },
      ],
    };
    const flattened = flattenBelleDigestOutput(output, sources);
    expect(flattened.headline).toBe(output.headline);
    expect(flattened.opening).toBe(output.opening);
    expect(flattened.briefs).toEqual(output.briefs);
    expect(flattened.closing).toBe(output.closing);
    expect(flattened.claims).toEqual([
      { ...output.claimsBySource["hn-1-0"][0], sourceCandidateId: "hn-1-0" },
      { ...output.claimsBySource["hn-2-1"][0], sourceCandidateId: "hn-2-1" },
      ...output.analysisClaims,
    ]);
    expect(flattened).not.toHaveProperty("claimsBySource");
    expect(flattened).not.toHaveProperty("analysisClaims");
    // A redundant fabricated ID cannot override the group's source identity.
    expect(() =>
      flattenBelleDigestOutput(
        {
          ...output,
          claimsBySource: {
            ...output.claimsBySource,
            "hn-1-0": [
              {
                ...output.claimsBySource["hn-1-0"][0],
                sourceCandidateId: "fabricated",
              },
            ],
          },
        },
        sources,
      ),
    ).toThrow();
  });

  test("grouped evidence stays bounded to three facts per source and twelve analysis claims", () => {
    const sources = Array.from({ length: 12 }, (_, index) => ({
      id: `hn-${index + 1}-${index}`,
      sourceFetchSucceeded: true,
    }));
    const fact = groupedDigestFixture().claimsBySource["hn-1-0"][0];
    const output = {
      ...groupedDigestFixture(),
      claimsBySource: Object.fromEntries(
        sources.map(({ id }) => [id, [fact, fact, fact]]),
      ),
      analysisClaims: sources.map(({ id }) => ({
        ...fact,
        kind: "analysis" as const,
        sourceCandidateId: id,
      })),
    };
    expect(flattenBelleDigestOutput(output, sources).claims).toHaveLength(48);
    const schema = belleDigestOutputSchema(sources);
    expect(
      schema.safeParse({
        ...output,
        claimsBySource: {
          ...output.claimsBySource,
          "hn-1-0": [fact, fact, fact, fact],
        },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...output,
        analysisClaims: [...output.analysisClaims, output.analysisClaims[0]],
      }).success,
    ).toBe(false);
  });

  test("a single retrieved source structurally requires the existing two-fact minimum", () => {
    const sources = [{ id: "hn-1-0", sourceFetchSucceeded: true }];
    const fixture = groupedDigestFixture();
    const output = {
      ...fixture,
      claimsBySource: { "hn-1-0": fixture.claimsBySource["hn-1-0"] },
    };
    const schema = belleDigestOutputSchema(sources);
    expect(schema.safeParse(output).success).toBe(false);
    const secondFact = {
      ...fixture.claimsBySource["hn-1-0"][0],
      claim:
        "The article explains how stopped work resumes from the checkpoint.",
    };
    expect(
      flattenBelleDigestOutput(
        {
          ...output,
          claimsBySource: {
            "hn-1-0": [...output.claimsBySource["hn-1-0"], secondFact],
          },
        },
        sources,
      ).claims,
    ).toHaveLength(2);
  });

  test("requires exact source IDs and factual coverage for every retrieved brief", () => {
    const snapshots = [1, 2].map(
      (id) =>
        ({ id: `hn-${id}-0`, sourceFetchSucceeded: true }) as ArticleSnapshot,
    );
    const briefs = [1, 2].map((hnItemId) => ({
      hnItemId,
      summary: "The source describes a recovery checkpoint.",
      analysis: "",
    }));
    const claim = {
      claim: "The source describes a recovery checkpoint.",
      sourceCandidateId: "hn-1-0",
      confidence: "high" as const,
      kind: "fact" as const,
    };
    expect(() =>
      validateBelleDigestClaimSources(
        { briefs, claims: [{ ...claim, sourceCandidateId: "invented" }] },
        snapshots,
      ),
    ).toThrow(AgentPublicationQualityError);
    expect(() =>
      validateBelleDigestClaimSources({ briefs, claims: [claim] }, snapshots),
    ).toThrow("hn-2-0");
    expect(() =>
      validateBelleDigestClaimSources(
        { briefs, claims: [claim, { ...claim, sourceCandidateId: "hn-2-0" }] },
        snapshots,
      ),
    ).not.toThrow();
    expect(() =>
      validateBelleDigestClaimSources({ briefs, claims: [claim] }, [
        snapshots[0]!,
        { ...snapshots[1]!, sourceFetchSucceeded: false },
      ]),
    ).not.toThrow();
  });

  test("retains bounded quality rejection details only in operator diagnostics", () => {
    const error = new AgentPublicationQualityError(
      "Belle's digest failed deterministic source checks: unsupported_numeric_claim.",
    );
    expect(belleErrorMessage(error)).toBe(
      "Belle's draft did not meet public-copy quality rules.",
    );
    expect(belleErrorMessage(error, "operator")).toBe(error.message);
    expect(
      belleErrorMessage(
        new AgentPublicationQualityError(
          "[b]Unsupported claim.[/b] ".repeat(50),
        ),
        "operator",
      ),
    ).toHaveLength(500);
    expect(belleErrorMessage(new Error("Transport failed."), "operator")).toBe(
      belleErrorMessage(new Error("Transport failed.")),
    );
  });

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

function groupedDigestFixture() {
  const fact = {
    claim: "The retrieved article describes a recovery checkpoint.",
    confidence: "high" as const,
    kind: "fact" as const,
  };
  return {
    headline: "Checkpoint recovery and a bounded daily news desk",
    opening: "The source reports a recovery checkpoint for interrupted work.",
    briefs: Array.from({ length: 12 }, (_, index) => ({
      hnItemId: index + 1,
      summary: "The retrieved article describes a recovery checkpoint.",
      analysis: "",
    })),
    closing: "",
    claimsBySource: { "hn-1-0": [fact], "hn-2-1": [fact] },
    analysisClaims: [],
  };
}
