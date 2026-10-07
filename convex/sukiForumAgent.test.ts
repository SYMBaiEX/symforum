// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { FORUM_THREAD_BODY_MAX_LENGTH } from "./forumLimits";
import {
  contentFormatGuidance,
  assertForumSemanticReviewApproved,
  collectResearchCandidates,
  evaluateForumDraft,
  finalizeForumBody,
  findRecentLexicalOverlap,
  fetchArticleSnapshots,
  forumDraftRevisionImproves,
  forumDraftPrompt,
  forumDraftPassesGate,
  forumRevisionEvidenceExcerpt,
  ForumEditorialQualityError,
  forumWriterMaxOutputTokens,
  imageRelevanceScore,
  isRetryableError,
  MAX_FORUM_EDITORIAL_REVISION_PASSES,
  parseFeedXml,
  rankResearchCandidatesForTopic,
  repairForumDraftForReview,
  structuredBlockContract,
} from "./sukiForumAgent";
import { ResearchQualityGateError } from "./researchQuality";
import { validateForumAgentMarkup } from "../lib/editorial-quality";
import {
  FORUM_EDITORIAL_CONTRACT,
  FORUM_EDITORIAL_REVIEW_CONTRACT,
} from "../lib/forum-posting-prompts";

describe("Suki forum research helpers", () => {
  test("reads the research-feed cache in one batch and fetches no fresh feeds", async () => {
    const cachedCandidate = (cacheKey: string) => ({
      id: cacheKey,
      sourceKey: cacheKey,
      sourceName: "Cached source",
      sourceFeedUrl: "https://example.com/feed.xml",
      title: `Cached story ${cacheKey}`,
      url: `https://example.com/${cacheKey}`,
      summary: "Cached evidence summary.",
      boardSlugs: ["research-papers"],
    });
    let readBatchSize = 0;
    const runQuery = vi.fn(
      async (_reference, args: { cacheKeys: string[] }) => {
        readBatchSize = args.cacheKeys.length;
        return args.cacheKeys.map((cacheKey) => ({
          cacheKey,
          payloadJson: JSON.stringify([cachedCandidate(cacheKey)]),
        }));
      },
    );
    const runMutation = vi.fn(async () => ({ written: 0 }));
    const context = { runQuery, runMutation } as unknown as Parameters<
      typeof collectResearchCandidates
    >[0];
    const fetchMock = vi.fn(async () => {
      throw new Error("Cached feeds should not trigger fetches");
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const candidates = await collectResearchCandidates(context);

      expect(candidates).toHaveLength(14);
      expect(runQuery).toHaveBeenCalledTimes(1);
      expect(readBatchSize).toBe(14);
      expect(runMutation).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("keeps refreshed feed data when its single batched cache write fails", async () => {
    const runQuery = vi.fn(async () => []);
    let writeBatchSize = 0;
    const runMutation = vi.fn(
      async (_reference, args: { entries: unknown[] }) => {
        writeBatchSize = args.entries.length;
        throw new Error("Cache unavailable");
      },
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = { runQuery, runMutation } as unknown as Parameters<
      typeof collectResearchCandidates
    >[0];
    const fetchMock = vi.fn(
      async () =>
        new Response(
          `<rss version="2.0"><channel><item><title>Shared release</title><link>https://example.com/release</link><description>Verified release detail.</description></item></channel></rss>`,
          { headers: { "content-type": "application/rss+xml; charset=utf-8" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const candidates = await collectResearchCandidates(context);

      expect(candidates).toHaveLength(1);
      expect(runQuery).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(14);
      expect(runMutation).toHaveBeenCalledTimes(1);
      expect(writeBatchSize).toBe(14);
      expect(warnSpy).toHaveBeenCalledWith(
        "Research feed cache batch write failed.",
      );
    } finally {
      vi.unstubAllGlobals();
      warnSpy.mockRestore();
    }
  });

  test("fetches a canonical article once and preserves each story identity", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          `<html><head><title>Shared article</title><meta name="description" content="Shared page context"></head><body><main>Verified article details.</main></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const snapshots = await fetchArticleSnapshots([
        {
          id: "hn-1",
          sourceKey: "story-1",
          sourceName: "First source",
          sourceFeedUrl: "https://news.ycombinator.com/",
          title: "First HN title",
          url: "https://example.com/story?utm_source=first",
          summary: "First HN summary",
          boardSlugs: ["research-papers"],
        },
        {
          id: "hn-2",
          sourceKey: "story-2",
          sourceName: "Second source",
          sourceFeedUrl: "https://news.ycombinator.com/",
          title: "Second HN title",
          url: "https://example.com/story?utm_source=second",
          summary: "Second HN summary",
          boardSlugs: ["ai-frameworks"],
        },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(snapshots).toMatchObject([
        {
          id: "hn-1",
          sourceKey: "story-1",
          sourceName: "First source",
          title: "First HN title",
          summary: "First HN summary",
          articleTitle: "Shared article",
          articleDescription: "Shared page context",
          articleText: "Verified article details.",
        },
        {
          id: "hn-2",
          sourceKey: "story-2",
          sourceName: "Second source",
          title: "Second HN title",
          summary: "Second HN summary",
          articleTitle: "Shared article",
          articleDescription: "Shared page context",
          articleText: "Verified article details.",
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("reuses article content across actions without reusing candidate identity", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          `<html><head><title>Shared article</title></head><body><main>Verified article details.</main></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const source = {
        sourceFeedUrl: "https://news.ycombinator.com/",
        boardSlugs: ["news-hacker-news"],
      };
      const first = await fetchArticleSnapshots([
        {
          ...source,
          id: "newsletter-42-0",
          sourceKey: "newsletter-hn-42",
          sourceName: "example.com",
          title: "Newsletter candidate title",
          url: "https://example.com/story?utm_source=newsletter",
          summary: "Newsletter fallback summary",
        },
      ]);
      const second = await fetchArticleSnapshots(
        [
          {
            ...source,
            id: "hn-42-0",
            sourceKey: "hn-42",
            sourceName: "example.com",
            title: "Forum candidate title",
            url: "https://example.com/story?utm_source=forum",
            summary: "Forum fallback summary",
          },
        ],
        first,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second[0]).toMatchObject({
        id: "hn-42-0",
        title: "Forum candidate title",
        summary: "Forum fallback summary",
        articleTitle: "Shared article",
        articleText: "Verified article details.",
        sourceFetchSucceeded: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("reuses an unavailable result without replacing candidate fallbacks", async () => {
    const fetchMock = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const shared = {
        sourceFeedUrl: "https://news.ycombinator.com/",
        boardSlugs: ["news-hacker-news"],
      };
      const first = await fetchArticleSnapshots([
        {
          ...shared,
          id: "newsletter-55-0",
          sourceKey: "newsletter-hn-55",
          sourceName: "example.com",
          title: "Newsletter title",
          url: "https://example.com/unavailable?utm_source=newsletter",
          summary: "Newsletter-specific source text",
        },
      ]);
      const second = await fetchArticleSnapshots(
        [
          {
            ...shared,
            id: "hn-55-0",
            sourceKey: "hn-55",
            sourceName: "example.com",
            title: "Forum title",
            url: "https://example.com/unavailable?utm_source=forum",
            summary: "Forum-specific source text",
          },
        ],
        first,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second[0]).toMatchObject({
        articleTitle: "Forum title",
        articleDescription: "Forum-specific source text",
        articleText: "Forum-specific source text",
        sourceFetchSucceeded: false,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("shares failed fetches but applies each candidate's own fallback", async () => {
    const fetchMock = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const snapshots = await fetchArticleSnapshots([
        {
          id: "hn-1",
          sourceKey: "story-1",
          sourceName: "First source",
          sourceFeedUrl: "https://news.ycombinator.com/",
          title: "First HN title",
          url: "https://example.com/story?utm_source=first",
          summary: "First fallback",
          boardSlugs: ["research-papers"],
        },
        {
          id: "hn-2",
          sourceKey: "story-2",
          sourceName: "Second source",
          sourceFeedUrl: "https://news.ycombinator.com/",
          title: "Second HN title",
          url: "https://example.com/story?utm_source=second",
          summary: "Second fallback",
          boardSlugs: ["ai-frameworks"],
        },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        snapshots.map((snapshot) => [
          snapshot.articleTitle,
          snapshot.articleDescription,
          snapshot.articleText,
          snapshot.imageCredit,
        ]),
      ).toEqual([
        ["First HN title", "First fallback", "First fallback", "First source"],
        [
          "Second HN title",
          "Second fallback",
          "Second fallback",
          "Second source",
        ],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("uses deterministic recent-title overlap before semantic retrieval", () => {
    const candidate = { title: "Open-source agents for research workflows" };
    const memberThread = {
      id: "member-thread",
      title: "Research workflows with open-source agents",
      ownedByAgent: false,
    };

    expect(findRecentLexicalOverlap([candidate], [memberThread])).toBe(
      memberThread,
    );
    expect(
      findRecentLexicalOverlap(
        [candidate],
        [{ ...memberThread, title: "A local compiler cache for TypeScript" }],
      ),
    ).toBeUndefined();
    expect(
      findRecentLexicalOverlap(
        [candidate],
        [{ ...memberThread, ownedByAgent: true }],
      ),
    ).toMatchObject({ ownedByAgent: true });
  });

  test("keeps revision evidence focused on source-linked claims", () => {
    const unrelated =
      "A long unrelated deployment history describes dashboards and general release process. ".repeat(
        12,
      );
    const sourceText = [
      unrelated,
      "Version 2.4 adds checkpoint recovery for interrupted synchronization jobs, reducing replay after restart.",
      "The recovery manifest records the latest completed batch and checksum for validation.",
    ].join(" ");

    const excerpt = forumRevisionEvidenceExcerpt(
      sourceText,
      [
        "Checkpoint recovery reduces replay after interruption in synchronization jobs.",
        "The recovery manifest records the latest completed batch and checksum.",
      ],
      300,
    );

    expect(excerpt).toContain("checkpoint recovery");
    expect(excerpt).toContain("recovery manifest");
    expect(excerpt).not.toContain("dashboards");
    expect(excerpt.length).toBeLessThanOrEqual(300);
  });

  test("finds claim evidence inside unusually long source paragraphs", () => {
    const sourceText = `${"background details without claim matches ".repeat(30)}checkpoint recovery restores interrupted synchronization jobs`;
    const excerpt = forumRevisionEvidenceExcerpt(
      sourceText,
      ["Checkpoint recovery restores interrupted synchronization jobs."],
      180,
    );

    expect(excerpt).toContain("checkpoint recovery");
    expect(excerpt.length).toBeLessThanOrEqual(180);
  });

  test("does not retry a deterministic research-quality hold", () => {
    expect(
      isRetryableError(new ResearchQualityGateError(["near_duplicate"])),
    ).toBe(false);
    expect(
      isRetryableError(new ForumEditorialQualityError("quality hold")),
    ).toBe(false);
    expect(isRetryableError(new Error("temporary network timeout"))).toBe(true);
  });

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

  test("does not duplicate a paraphrased closing question and excludes weak related links", () => {
    const body = finalizeForumBody(
      `[h2]Operational fit[/h2]
The SDK changes the shape of Java agent integration.

[decision=Pilot scope]
Sandbox|Pilot|Measure annotation processing behavior
Production|Wait|Verify blocking dependencies first
[/decision]

Where would your team pilot this first?`,
      [
        {
          articleDescription: "Java SDK release details",
          articleText: "The SDK uses annotation processing.",
          articleTitle: "Copilot SDK for Java",
          boardSlugs: ["ai-frameworks"],
          id: "candidate-1",
          imageCredit: "Example",
          sourceFeedUrl: "https://example.com/feed.xml",
          sourceKey: "source-1",
          sourceName: "Example",
          summary: "Java SDK release details",
          title: "Copilot SDK for Java",
          url: "https://example.com/java-sdk",
        },
      ],
      {
        discussionQuestion: "Where would your team pilot it first?",
        subjectTitle: "Copilot SDK Java production readiness",
        relatedThreads: [
          {
            categorySlug: "ai-frameworks",
            slug: "annotation-processor-failures",
            title: "Java Copilot SDK annotation processor failure modes",
          },
          {
            categorySlug: "projects-releases",
            slug: "enterprise-app-installation",
            title: "GitHub enterprise app installation permissions",
          },
        ],
      },
    );

    expect(body).not.toContain("[h3]Over to the board[/h3]");
    expect(body).toContain(
      "https://forum.symbaiex.com/ai-frameworks/annotation-processor-failures",
    );
    expect(body).not.toContain("enterprise-app-installation");
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

  test("checks body precision against its ledger claim's cited source", () => {
    const snapshots = [
      {
        articleDescription: "Release 2.4 adds checkpoint recovery.",
        articleText: "Version 2.4 adds checkpoint recovery to sync jobs.",
        articleTitle: "Checkpoint recovery release",
        boardSlugs: ["ai-frameworks"],
        id: "source-a",
        imageCredit: "Example",
        sourceFeedUrl: "https://example.com/feed.xml",
        sourceKey: "source-a",
        sourceName: "Example A",
        summary: "Checkpoint recovery",
        title: "Checkpoint recovery release",
        url: "https://example.com/a",
      },
      {
        articleDescription: "A separate product reached version 9.9.",
        articleText: "Version 9.9 is now available.",
        articleTitle: "Unrelated 9.9 release",
        boardSlugs: ["ai-frameworks"],
        id: "source-b",
        imageCredit: "Example",
        sourceFeedUrl: "https://example.com/feed.xml",
        sourceKey: "source-b",
        sourceName: "Example B",
        summary: "A different release",
        title: "Unrelated release",
        url: "https://example.com/b",
      },
    ];
    const discussionQuestion =
      "Where would checkpoint recovery remove the most operational pain for you?";
    const body = `${"Checkpoint recovery changes how teams resume interrupted synchronization work. ".repeat(45)}\n\nVersion 9.9 adds checkpoint recovery to sync jobs.\n\n[steps=Recovery check]\n1|Verify|Inspect the checkpoint\n[/steps]\n\n${discussionQuestion}`;
    const draft: Parameters<typeof repairForumDraftForReview>[0] = {
      title: "Checkpoint recovery changes the sync failure playbook",
      body,
      poll: null,
      imageCandidateId: null,
      claims: [
        {
          claim: "Version 2.4 adds checkpoint recovery to sync jobs.",
          sourceCandidateId: "source-a",
          confidence: "high",
          kind: "fact",
        },
        {
          claim:
            "Checkpoint recovery can reduce repeated synchronization work.",
          sourceCandidateId: "source-a",
          confidence: "medium",
          kind: "analysis",
        },
      ],
      originalValue: [
        "A verification step before resuming work",
        "A bounded way to reason about interrupted jobs",
      ],
      discussionQuestion,
    };
    const result = evaluateForumDraft({
      draft,
      selection: {
        angle: "How checkpoint recovery changes synchronization operations",
        candidateIds: ["source-a"],
        categorySlug: "ai-frameworks",
        postType: "news-analysis",
        prefixSlug: "news",
        includePoll: false,
        contentFormat: "field-note",
      },
      snapshots,
      recentThreadTitles: [],
    });

    expect(result.blockingIssues.join(" ")).toContain(
      "Ensure every consequential body claim has a ledger claim whose cited source supports its details",
    );
    expect(result.blockingIssues.join(" ")).toContain(
      "Version 9.9 adds checkpoint recovery to sync jobs",
    );
    expect(result.blockingIssues).not.toContain(
      "The post must end with exactly one focused question",
    );
    expect(repairForumDraftForReview(draft, snapshots).body).toContain(
      "Version 9.9 adds checkpoint recovery to sync jobs.",
    );
    const repairedResult = evaluateForumDraft({
      draft: repairForumDraftForReview(draft, snapshots),
      selection: { ...discoverySelection(), contentFormat: "field-note" },
      snapshots,
      recentThreadTitles: [],
    });
    expect(repairedResult.blockingIssues.join(" ")).toContain(
      "Version 9.9 adds checkpoint recovery to sync jobs",
    );
    expect(forumDraftPassesGate(repairedResult)).toBe(false);
  });

  test("holds malformed evidence blocks below the publishing threshold", () => {
    const discussionQuestion =
      "Where would checkpoint recovery remove operational pain for your team?";
    const body = `[h2]Recovery decision[/h3]
Version 2.4 adds checkpoint recovery to synchronization jobs.

Checkpoint verification reduces ambiguity after an interrupted run. ${"The operational playbook benefits from a deliberate pause before resuming work. ".repeat(35)}

[decision=Adoption]
Pilot|Adopt|Verify the checkpoint
[/decision]

${discussionQuestion}`;
    const result = evaluateForumDraft({
      draft: {
        title: "Checkpoint recovery needs a verification gate",
        body,
        poll: null,
        imageCandidateId: null,
        claims: [
          {
            claim:
              "Version 2.4 adds checkpoint recovery to synchronization jobs.",
            sourceCandidateId: "source-a",
            confidence: "high",
            kind: "fact",
          },
          {
            claim:
              "Checkpoint verification reduces ambiguity after an interrupted run.",
            sourceCandidateId: "source-a",
            confidence: "medium",
            kind: "analysis",
          },
        ],
        originalValue: [
          "Checkpoint verification after an interrupted run",
          "A deliberate pause before resuming work",
        ],
        discussionQuestion,
      },
      selection: {
        angle: "Checkpoint verification after interrupted synchronization",
        candidateIds: ["source-a"],
        categorySlug: "ai-frameworks",
        postType: "guide",
        prefixSlug: "guide",
        includePoll: false,
        contentFormat: "brief",
      },
      snapshots: [
        {
          articleDescription:
            "Version 2.4 adds checkpoint recovery to synchronization jobs.",
          articleText:
            "Version 2.4 adds checkpoint recovery to synchronization jobs after interrupted runs.",
          articleTitle: "Checkpoint recovery release",
          boardSlugs: ["ai-frameworks"],
          id: "source-a",
          imageCredit: "Example",
          sourceFeedUrl: "https://example.com/feed.xml",
          sourceKey: "source-a",
          sourceName: "Example",
          summary: "Checkpoint recovery",
          title: "Checkpoint recovery release",
          url: "https://example.com/a",
        },
      ],
      recentThreadTitles: [],
    });

    expect(result.qualityScore).toBeLessThan(78);
    expect(result.feedback.join(" ")).toContain("Balance every [h2]");
    expect(result.feedback.join(" ")).toContain(
      "[decision] needs at least 2 complete rows",
    );
  });

  test("keeps the better evaluated draft when a revision does not improve", () => {
    const evaluated = (
      qualityScore: number,
      blockingIssues: string[] = [],
    ) => ({
      qualityScore,
      groundingScore: qualityScore,
      noveltyScore: qualityScore,
      utilityScore: qualityScore,
      presentationScore: qualityScore,
      blockingIssues,
      feedback: [],
    });

    expect(
      forumDraftRevisionImproves(evaluated(78), evaluated(77, ["old blocker"])),
    ).toBe(true);
    expect(forumDraftRevisionImproves(evaluated(76), evaluated(77))).toBe(
      false,
    );
    expect(
      forumDraftRevisionImproves(
        evaluated(77, ["one blocker"]),
        evaluated(77, ["one blocker", "another blocker"]),
      ),
    ).toBe(true);
    expect(forumDraftRevisionImproves(evaluated(77), evaluated(77))).toBe(
      false,
    );
  });

  test("mechanically closes table cells without inserting questions, deleting prose, or fabricating a ledger", () => {
    const snapshots = [
      {
        articleDescription:
          "Version 2.4 adds checkpoint recovery to synchronization jobs.",
        articleText:
          "Version 2.4 adds checkpoint recovery to interrupted synchronization jobs.",
        articleTitle: "Checkpoint recovery release",
        boardSlugs: ["ai-frameworks"],
        id: "source-a",
        imageCredit: "Example",
        sourceFeedUrl: "https://example.com/feed.xml",
        sourceKey: "source-a",
        sourceName: "Example",
        summary: "Checkpoint recovery",
        title: "Checkpoint recovery release",
        url: "https://example.com/a",
      },
    ];
    const repaired = repairForumDraftForReview(
      {
        title: "Checkpoint recovery changes synchronization operations",
        body: `[h2]Recovery[/h2]
Version 2.4 adds checkpoint recovery to interrupted synchronization jobs.

Real typing speed is the part most hobby modems get wrong.

Verify the checkpoint before resuming interrupted work.

Choose a bounded recovery decision under ambiguous saved state.

[table]
[tr][th]Signal[th]Meaning[/tr]
[tr][td]Checkpoint[td]Resume interrupted synchronization jobs[/tr]
[/table]`,
        poll: null,
        imageCandidateId: null,
        claims: [],
        originalValue: [
          "A concrete checkpoint verification practice should happen immediately before every team restarts the entire interrupted workflow",
          "Choose a deliberately bounded operational decision whenever the persisted recovery state remains unclear to the team",
        ],
        discussionQuestion:
          "Where would checkpoint recovery remove operational pain",
      },
      snapshots,
    );

    expect(repaired.body).toContain("[tr][th]Signal[/th][th]Meaning[/th][/tr]");
    expect(repaired.body).toContain(
      "[tr][td]Checkpoint[/td][td]Resume interrupted synchronization jobs[/td][/tr]",
    );
    expect(repaired.body).not.toContain(
      "Where would checkpoint recovery remove operational pain",
    );
    expect(repaired.body).toContain(
      "Real typing speed is the part most hobby modems get wrong.",
    );
    expect(repaired.discussionQuestion).toBe(
      "Where would checkpoint recovery remove operational pain",
    );
    expect(repaired.claims).toEqual([]);
    expect(repaired.originalValue).toEqual([
      "A concrete checkpoint verification practice should happen immediately before every team restarts the entire interrupted workflow",
      "Choose a deliberately bounded operational decision whenever the persisted recovery state remains unclear to the team",
    ]);
  });

  test("preserves question context and malformed blocks for a full rewrite instead of synthesizing Signal rows", () => {
    const snapshots = [
      {
        articleDescription:
          "Checkpoint recovery helps synchronization jobs resume after interruptions.",
        articleText:
          "Checkpoint recovery helps synchronization jobs resume after interruptions. Teams verify the saved checkpoint before resuming work.",
        articleTitle: "Checkpoint recovery",
        boardSlugs: ["ai-frameworks"],
        id: "source-a",
        imageCredit: "Example",
        sourceFeedUrl: "https://example.com/feed.xml",
        sourceKey: "source-a",
        sourceName: "Example",
        summary: "Checkpoint recovery",
        title: "Checkpoint recovery",
        url: "https://example.com/a",
      },
    ];
    const repaired = repairForumDraftForReview(
      {
        title: "A safer checkpoint recovery workflow",
        body: `[h2]Recovery[/h2]
Checkpoint recovery helps synchronization jobs resume after interruptions.

Should every team enable it immediately?

Teams verify the saved checkpoint before resuming work.

[decision=Adoption]
Pilot|Adopt
[/decision]

What would you verify first?`,
        poll: null,
        imageCandidateId: null,
        claims: [
          {
            claim:
              "Checkpoint recovery helps synchronization jobs resume after interruptions.",
            sourceCandidateId: "source-a",
            confidence: "high",
            kind: "fact",
          },
          {
            claim: "Teams verify the saved checkpoint before resuming work.",
            sourceCandidateId: "source-a",
            confidence: "medium",
            kind: "analysis",
          },
        ],
        originalValue: [
          "Checkpoint recovery helps synchronization jobs resume after interruptions.",
          "Teams verify the saved checkpoint before resuming work.",
        ],
        discussionQuestion: "What would you verify first",
      },
      snapshots,
    );

    expect(repaired.body).toContain("Should every team enable it immediately?");
    expect(repaired.body).toContain(
      "[decision=Adoption]\nPilot|Adopt\n[/decision]",
    );
    expect(repaired.body).not.toContain("[table]");
    expect(repaired.body).not.toContain("Signal 1");
    expect(repaired.body).toMatch(/What would you verify first\?$/);
    expect(repaired.body.match(/\?/g)).toHaveLength(2);
    expect(validateForumAgentMarkup(repaired.body).valid).toBe(false);
    expect(
      validateForumAgentMarkup(repaired.body).feedback.join(" "),
    ).toContain("[decision] needs at least 2 complete rows");
  });

  test("gives each editorial format a concrete argument architecture", () => {
    expect(contentFormatGuidance("comparison")).toContain(
      "same evidenced criteria",
    );
    expect(contentFormatGuidance("guide")).toContain("verification");
    expect(contentFormatGuidance("guide")).toContain("180-900 plain words");
    expect(contentFormatGuidance("brief")).toContain("80-350 plain words");
    expect(contentFormatGuidance("discovery")).toContain("20-120 plain words");
    expect(contentFormatGuidance("deep-dive")).toContain("counterpoint");
    expect(contentFormatGuidance("guide")).toContain("Do not pad");
    expect(structuredBlockContract("guide").toLowerCase()).toContain(
      "optional",
    );
    expect(structuredBlockContract("comparison").toLowerCase()).toContain(
      "optional",
    );
    expect(structuredBlockContract("brief").toLowerCase()).toContain(
      "optional",
    );
    expect(forumWriterMaxOutputTokens("draft", false)).toBe(9_600);
    expect(forumWriterMaxOutputTokens("revision", false)).toBe(11_000);
    expect(forumWriterMaxOutputTokens("revision", true)).toBe(11_000);
    expect(MAX_FORUM_EDITORIAL_REVISION_PASSES).toBe(2);
  });

  test("shortlists topic evidence by desk fit and source diversity", () => {
    const base = {
      boardSlugs: ["ai-frameworks"],
      imageUrl: undefined,
      publishedAt: Date.now(),
      sourceFeedUrl: "https://example.com/feed.xml",
      summary: "A practical workflow for checkpoint recovery.",
      url: "https://example.com/article",
    };
    const ranked = rankResearchCandidatesForTopic({
      candidates: [
        {
          ...base,
          id: "fit",
          sourceKey: "fit",
          sourceName: "Example A",
          title: "Checkpoint recovery workflow",
        },
        {
          ...base,
          id: "generic",
          sourceKey: "generic",
          sourceName: "Example B",
          title: "A general culture roundup",
          summary: "A broad community roundup.",
        },
      ],
      deskDescription: "practical workflows and troubleshooting guides",
      recentBoardSlugs: ["ai-frameworks", "ai-frameworks"],
      editorialSignals: [],
    });
    expect(ranked[0]?.id).toBe("fit");
  });
  test("publishes a compact supported discovery without forced structure or questions", () => {
    const snapshots = [checkpointSnapshot()];
    const body =
      "Version 2.4 adds checkpoint recovery to interrupted synchronization jobs. Before adoption, compare a stopped job with the resumed job and inspect its saved checkpoint.";
    const draft = {
      title: "Checkpoint recovery is worth a stopped-job test",
      body,
      poll: null,
      imageCandidateId: null,
      claims: [
        {
          claim:
            "Version 2.4 adds checkpoint recovery to interrupted synchronization jobs.",
          sourceCandidateId: "source-a",
          confidence: "high" as const,
          kind: "fact" as const,
        },
      ],
      originalValue: [
        "Before adoption, compare a stopped job with the resumed job and inspect its saved checkpoint.",
      ],
      discussionQuestion: "",
    };
    const result = evaluateForumDraft({
      draft,
      selection: discoverySelection(),
      snapshots,
      recentThreadTitles: [],
    });
    expect(result.blockingIssues).toEqual([]);
    expect(forumDraftPassesGate(result)).toBe(true);
    const finalBody = finalizeForumBody(body, snapshots, {
      discussionQuestion: "",
      subjectTitle: draft.title,
    });
    expect(finalBody).toContain(body);
    expect(finalBody).toContain("Sources and further reading");
    expect(finalBody).not.toContain("Over to the board");
    expect(
      validateForumAgentMarkup(finalBody, { trustedSourceFooter: true }).valid,
    ).toBe(true);
  });

  test("admits declared source-bound inference to independent review without certifying capabilities", () => {
    const fact =
      "Version 2.4 adds checkpoint recovery to interrupted synchronization jobs.";
    const inference =
      "This suggests recovery can become an explicit checkpoint in your operational playbook.";
    const evaluate = (
      analysis: string,
      sourceId = "source-a",
      premiseKind: "fact" | "analysis" = "fact",
    ) =>
      evaluateForumDraft({
        draft: {
          title: "Checkpoint recovery deserves a deliberate operational check",
          body: `${fact} ${analysis}`,
          poll: null,
          imageCandidateId: null,
          discussionQuestion: "",
          claims: [
            {
              claim: fact,
              sourceCandidateId: "source-a",
              confidence: "high",
              kind: premiseKind,
            },
            {
              claim: analysis,
              sourceCandidateId: sourceId,
              confidence: "medium",
              kind: "analysis",
            },
          ],
          originalValue: [analysis],
        },
        selection: discoverySelection(),
        snapshots: [checkpointSnapshot()],
        recentThreadTitles: [],
      });
    expect(evaluate(inference).blockingIssues).toEqual([]);
    expect(
      evaluate(inference, "source-a", "analysis").blockingIssues.join(" "),
    ).toContain(inference);
    expect(
      evaluate(
        "Before adoption, keep the original checkpoint available for a stopped-job comparison.",
      ).blockingIssues,
    ).toEqual([]);
    expect(
      evaluate(inference, "missing-source").blockingIssues.join(" "),
    ).toContain("candidate ID");
    expect(
      evaluate(
        "This suggests version 9.9 can recover every job automatically.",
      ).blockingIssues.join(" "),
    ).toContain("unsupported");

    const fabricated =
      "This suggests the model can read private inboxes without authentication.";
    // Lexical triage cannot prove or disprove a nonnumeric capability. Even a
    // qualified analysis with a real cited premise must pass original-evidence review.
    expect(evaluate(fabricated).blockingIssues).toEqual([]);
    expect(() =>
      assertForumSemanticReviewApproved({
        approved: false,
        issues: [
          "The source does not support reading private inboxes without authentication.",
        ],
      }),
    ).toThrow(ForumEditorialQualityError);
    expect(() =>
      assertForumSemanticReviewApproved({
        approved: true,
        issues: ["Unsupported capability"],
      }),
    ).toThrow(ForumEditorialQualityError);
    expect(() =>
      assertForumSemanticReviewApproved({ approved: true, issues: [] }),
    ).not.toThrow();
  });

  test("rejects short factual claims omitted from the ledger or falsely labeled analysis", () => {
    const fact =
      "Version 2.4 adds checkpoint recovery to interrupted synchronization jobs.";
    const missing = "The model supports streaming.";
    const base = {
      title: "Checkpoint recovery needs a stopped-job comparison",
      body: `${fact} ${missing} Before adoption, compare a stopped job and inspect its saved checkpoint.`,
      poll: null,
      imageCandidateId: null,
      discussionQuestion: "",
      claims: [
        {
          claim: fact,
          sourceCandidateId: "source-a",
          confidence: "high" as const,
          kind: "fact" as const,
        },
      ],
      originalValue: [
        "Before adoption, compare a stopped job and inspect its saved checkpoint.",
      ],
    };
    for (const claims of [
      base.claims,
      [
        ...base.claims,
        {
          claim: missing,
          sourceCandidateId: "source-a",
          confidence: "medium" as const,
          kind: "analysis" as const,
        },
      ],
    ]) {
      const quality = evaluateForumDraft({
        draft: { ...base, claims },
        selection: discoverySelection(),
        snapshots: [checkpointSnapshot()],
        recentThreadTitles: [],
      });
      expect(quality.blockingIssues.join(" ")).toContain(missing);
    }
  });

  test("source and related-thread footers cannot conceal incomplete authored content", () => {
    const snapshots = [checkpointSnapshot()];
    for (const body of [
      "Install the supported SDK.\n5.",
      "[h2]Action plan[/h2]\n[h2]Failure modes[/h2]",
      "Inspect the checkpoint.\n[note][/note]",
      "Inspect the checkpoint. The fallback:",
      "The comparison table below shows which path to use.",
    ]) {
      const finalized = finalizeForumBody(body, snapshots, {
        subjectTitle: "Checkpoint recovery SDK",
        relatedThreads: [
          {
            categorySlug: "ai-frameworks",
            slug: "checkpoint-sdk",
            title: "Checkpoint recovery SDK setup",
          },
        ],
      });
      expect(finalized).toContain("Sources and further reading");
      expect(finalized).toContain("sourcecards=Related threads");
      expect(
        validateForumAgentMarkup(finalized, { trustedSourceFooter: true })
          .valid,
        body,
      ).toBe(false);
    }
  });

  test("rejects the audited PR metric/music mismatch even if the numerical ledger is empty", () => {
    const body =
      "Before trusting the PR metric, compare the review timing across two changes. Treat this as an investigation, rather than a feature announcement. The recording interview provides no software release details.";
    const result = evaluateForumDraft({
      draft: {
        title:
          "PR Review Timing: Baseline the New Stage Metric Before You Trust It",
        body,
        poll: null,
        imageCandidateId: null,
        claims: [],
        originalValue: [
          "Treat this as an investigation, rather than a feature announcement.",
        ],
        discussionQuestion: "",
      },
      selection: discoverySelection(),
      snapshots: [
        {
          ...checkpointSnapshot(),
          articleTitle: "Recording the Rolling Stones album",
          articleDescription: "A music producer interview",
          articleText:
            "The band recorded vocals, guitar and mixing sessions with the producer.",
          title: "Recording the Rolling Stones album",
        },
      ],
      recentThreadTitles: [],
    });
    expect(result.blockingIssues).toContain(
      "The cited sources discuss a different subject from the proposed post; choose relevant evidence or rewrite the topic",
    );
    expect(forumDraftPassesGate(result)).toBe(false);
  });

  test("accepts supported music-software crossovers instead of rejecting the board by stereotype", () => {
    const body =
      "Resolume music software adds local model inference for live visuals. Before a show, compare the staging output with your current setup and save the original preset.";
    const claim =
      "Resolume music software adds local model inference for live visuals.";
    const result = evaluateForumDraft({
      draft: {
        title: "Resolume music software adds local vision models",
        body,
        poll: null,
        imageCandidateId: null,
        claims: [
          {
            claim,
            sourceCandidateId: "source-a",
            confidence: "high",
            kind: "fact",
          },
        ],
        originalValue: [
          "Before a show, compare the staging output with your current setup and save the original preset.",
        ],
        discussionQuestion: "",
      },
      selection: { ...discoverySelection(), categorySlug: "music-production" },
      snapshots: [
        {
          ...checkpointSnapshot(),
          articleTitle: "Resolume music software release",
          articleDescription: claim,
          articleText: claim,
          title: "Resolume music software release",
          boardSlugs: ["music-production"],
        },
      ],
      recentThreadTitles: [],
      board: { slug: "music-production", name: "Music Production" },
    });
    expect(result.blockingIssues).toEqual([]);
    expect(forumDraftPassesGate(result)).toBe(true);
  });

  test("live initial and revision prompts include the same editorial contract used in evals", () => {
    const draft = {
      title: "Checkpoint recovery discovery",
      body: "A bounded discovery for the next stopped-job test.",
      poll: null,
      imageCandidateId: null,
      claims: [],
      originalValue: ["A bounded discovery for the next stopped-job test."],
      discussionQuestion: "",
    };
    const args: Parameters<typeof forumDraftPrompt>[0] = {
      category: {
        slug: "ai-frameworks",
        name: "AI Frameworks",
        description: "Tools and implementations",
      },
      selection: discoverySelection(),
      snapshots: [checkpointSnapshot()],
      config: {
        dailySlots: 1,
        name: "Test",
        promptVersion: "test",
        slug: "test",
        topicInstructions: "Select supported changes.",
        writerInstructions: "Write concise discoveries.",
        deskDescription: "Practical tooling",
      },
    };
    for (const prompt of [
      forumDraftPrompt(args),
      forumDraftPrompt({
        ...args,
        previousDraft: draft,
        revisionFeedback: ["Complete the missing fifth step"],
      }),
    ]) {
      expect(prompt).toContain(FORUM_EDITORIAL_CONTRACT);
      expect(prompt).toContain("20-120 plain words");
      expect(prompt).not.toContain(FORUM_EDITORIAL_REVIEW_CONTRACT);
      expect(prompt).not.toContain("function forumEditorialReviewPrompt");
      expect(prompt).not.toContain(
        "Every post must include one evidence-backed structured block",
      );
      expect(prompt).not.toContain("exactly one question");
    }
  });
});

function checkpointSnapshot(): Parameters<
  typeof evaluateForumDraft
>[0]["snapshots"][number] {
  return {
    articleDescription: "Version 2.4 adds checkpoint recovery.",
    articleText:
      "Version 2.4 adds checkpoint recovery to interrupted synchronization jobs.",
    articleTitle: "Checkpoint recovery release",
    boardSlugs: ["ai-frameworks"],
    id: "source-a",
    imageCredit: "Example",
    sourceFeedUrl: "https://example.com/feed.xml",
    sourceKey: "source-a",
    sourceName: "Example",
    summary: "Checkpoint recovery",
    title: "Checkpoint recovery release",
    url: "https://example.com/checkpoint",
  };
}
function discoverySelection(): Parameters<
  typeof evaluateForumDraft
>[0]["selection"] {
  return {
    angle: "Test checkpoint recovery before adopting the SDK",
    candidateIds: ["source-a"],
    categorySlug: "ai-frameworks",
    postType: "news-analysis",
    prefixSlug: "news",
    includePoll: false,
    contentFormat: "discovery",
  };
}
