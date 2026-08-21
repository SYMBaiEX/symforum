// @vitest-environment node

import { describe, expect, test } from "vitest";

import { FORUM_THREAD_BODY_MAX_LENGTH } from "./forumLimits";
import {
  contentFormatGuidance,
  evaluateForumDraft,
  finalizeForumBody,
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

describe("Suki forum research helpers", () => {
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

  test("checks factual numbers against the claim's cited source", () => {
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
    const body = `${"Checkpoint recovery changes how teams resume interrupted synchronization work. ".repeat(45)}\n\n[steps=Recovery check]\n1|Verify|Inspect the checkpoint\n[/steps]\n\n${discussionQuestion}`;
    const result = evaluateForumDraft({
      draft: {
        title: "Checkpoint recovery changes the sync failure playbook",
        body,
        poll: null,
        imageCandidateId: null,
        claims: [
          {
            claim: "Version 9.9 adds checkpoint recovery to sync jobs.",
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
      },
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

    expect(result.groundingScore).toBeLessThan(100);
    expect(result.feedback.join(" ")).toContain(
      "source-a but that source does not contain: 9.9",
    );
    expect(result.blockingIssues).not.toContain(
      "The post must end with exactly one focused question",
    );
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

  test("repairs lower-capability model table cells, closing question, and supported claim ledger gaps", () => {
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
    expect(repaired.body).toMatch(
      /Where would checkpoint recovery remove operational pain\?$/,
    );
    expect(repaired.body).not.toContain(
      "Real typing speed is the part most hobby modems get wrong.",
    );
    expect(repaired.discussionQuestion).toBe(
      "Where would checkpoint recovery remove operational pain?",
    );
    expect(repaired.claims).toContainEqual(
      expect.objectContaining({
        claim:
          "Version 2.4 adds checkpoint recovery to interrupted synchronization jobs.",
        sourceCandidateId: "source-a",
        kind: "fact",
      }),
    );
    expect(repaired.originalValue).toEqual([
      "Verify the checkpoint before resuming interrupted work.",
      "Choose a bounded recovery decision under ambiguous saved state.",
    ]);
  });

  test("removes extra questions and replaces an incomplete evidence block deterministically", () => {
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

    expect(repaired.body).not.toContain("Should every team enable it");
    expect(repaired.body).not.toContain("[decision=Adoption]");
    expect(repaired.body).toContain("[table]");
    expect(repaired.body).toContain("[tr][th]Evidence[/th]");
    expect(repaired.body).toMatch(/What would you verify first\?$/);
    expect(repaired.body.match(/\?/g)).toHaveLength(1);
    expect(validateForumAgentMarkup(repaired.body).valid).toBe(true);
  });

  test("gives each editorial format a concrete argument architecture", () => {
    expect(contentFormatGuidance("comparison")).toContain(
      "Declare decision criteria first",
    );
    expect(contentFormatGuidance("guide")).toContain("verification step");
    expect(contentFormatGuidance("guide")).toContain(
      "hard acceptance range 650-1300 plain words",
    );
    expect(contentFormatGuidance("guide")).toContain(
      "Draft toward 725-1300 words",
    );
    expect(contentFormatGuidance("deep-dive")).toContain("counterpoint");
    expect(structuredBlockContract("guide")).toContain("[steps=Action plan]");
    expect(structuredBlockContract("comparison")).toContain(
      "[decision=Decision frame]",
    );
    expect(structuredBlockContract("brief")).toContain("[table]");
    expect(forumWriterMaxOutputTokens("draft", false)).toBe(4_800);
    expect(forumWriterMaxOutputTokens("revision", false)).toBe(5_500);
    expect(forumWriterMaxOutputTokens("revision", true)).toBe(2_800);
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
});
