import { describe, expect, test } from "vitest";
import {
  buildEvidenceResearchPrompt,
  buildExtractiveEvidenceDigest,
  compactEvidenceResearchExcerpt,
  compactEvidenceResearchSources,
  hasCompleteEvidenceResearchCitations,
  hasGroundedEvidenceResearchCitations,
  MAX_EVIDENCE_RESEARCH_EXCERPT_CHARACTERS,
} from "./evidence-research-prompt";

describe("evidence research prompt", () => {
  test("keeps query-relevant evidence later in a long excerpt within the cap", () => {
    const unrelated = "General background about release planning. ".repeat(90);
    const excerpt = `${unrelated}Checkpoint recovery restores interrupted sync jobs. Version 2.4 documents the recovery manifest. Operators can verify checkpoint recovery through manifest checksums.`;

    const compacted = compactEvidenceResearchExcerpt(
      "checkpoint recovery manifest",
      excerpt,
    );

    expect(compacted).toContain(
      "Checkpoint recovery restores interrupted sync jobs.",
    );
    expect(compacted).toContain("recovery manifest");
    expect(compacted).toContain("verify checkpoint recovery");
    expect(compacted).not.toContain("General background");
    expect(compacted.length).toBeLessThanOrEqual(
      MAX_EVIDENCE_RESEARCH_EXCERPT_CHARACTERS,
    );
  });

  test("falls back to a bounded prefix when the query has no lexical match", () => {
    const excerpt = "Unrelated source text. ".repeat(300);
    const compacted = compactEvidenceResearchExcerpt(
      "quantum networking",
      excerpt,
      180,
    );

    expect(compacted).toContain("Unrelated source text.");
    expect(compacted.length).toBeLessThanOrEqual(180);
  });

  test("bounds every source in the prompt and keeps source numbering stable", () => {
    const sources = compactEvidenceResearchSources("checkpoint recovery", [
      {
        title: "Recovery report",
        excerpt: `${"Background text. ".repeat(500)}Checkpoint recovery was added.`,
        canonicalUrl: "https://example.com/recovery",
      },
      {
        title: "Manifest guide",
        excerpt: "The recovery manifest records the last completed batch.",
        canonicalUrl: "https://example.com/manifest",
      },
    ]);
    const prompt = buildEvidenceResearchPrompt("checkpoint recovery", sources);
    const fallback = buildExtractiveEvidenceDigest(
      "checkpoint recovery",
      sources,
    );

    expect(sources[0]!.excerpt.length).toBeLessThanOrEqual(
      MAX_EVIDENCE_RESEARCH_EXCERPT_CHARACTERS,
    );
    expect(prompt).toContain("[1] Recovery report");
    expect(prompt).toContain("[2] Manifest guide");
    expect(fallback).toContain("- [1] Recovery report:");
    expect(fallback).toContain("- [2] Manifest guide:");
  });

  test("explains an empty evidence result without implying routing failed", () => {
    const fallback = buildExtractiveEvidenceDigest("empty query", []);

    expect(fallback).toContain(
      "No matching public evidence sources were found",
    );
    expect(fallback).toContain("no model analysis was attempted");
    expect(fallback).not.toContain("Routing unavailable");
  });

  test("caps the combined excerpt packet at 24,000 characters for ten sources", () => {
    const sources = compactEvidenceResearchSources(
      "checkpoint recovery",
      Array.from({ length: 10 }, (_, index) => ({
        title: `Source ${index + 1}`,
        excerpt: `${"Background notes. ".repeat(700)}Checkpoint recovery evidence for source ${index + 1}.`,
        canonicalUrl: `https://example.com/${index + 1}`,
      })),
    );

    expect(
      sources.reduce((total, source) => total + source.excerpt.length, 0),
    ).toBeLessThanOrEqual(10 * MAX_EVIDENCE_RESEARCH_EXCERPT_CHARACTERS);
  });

  test("accepts cited paragraphs only when every source index is in range", () => {
    expect(
      hasCompleteEvidenceResearchCitations(
        "## Finding\n\nCheckpoint recovery resumes the last completed batch [1].\n\nThe guide describes the recovery manifest [2].",
        2,
      ),
    ).toBe(true);
    expect(
      hasCompleteEvidenceResearchCitations(
        "Checkpoint recovery resumes the last completed batch [3].",
        2,
      ),
    ).toBe(false);
    expect(
      hasCompleteEvidenceResearchCitations(
        "Checkpoint recovery resumes the last completed batch [1].\n\nA second uncited factual paragraph.",
        2,
      ),
    ).toBe(false);
    expect(hasCompleteEvidenceResearchCitations("No citations here.", 2)).toBe(
      false,
    );
  });

  test("accepts source-specific paraphrases with grounded numeric details", () => {
    const sources = [
      {
        title: "Checkpoint recovery guide",
        excerpt:
          "Checkpoint recovery restores the last completed sync batch. Version 2.4 adds a recovery manifest.",
        canonicalUrl: "https://example.com/checkpoints",
      },
    ];

    expect(
      hasGroundedEvidenceResearchCitations(
        "Checkpoint recovery resumes the last finished sync batch in version 2.4 [1].",
        sources,
      ),
    ).toBe(true);
  });

  test("rejects an in-range citation to an unrelated source", () => {
    const sources = [
      {
        title: "Checkpoint recovery guide",
        excerpt: "Checkpoint recovery restores the last completed sync batch.",
        canonicalUrl: "https://example.com/checkpoints",
      },
    ];

    expect(
      hasGroundedEvidenceResearchCitations(
        "Newsletter campaign engagement rose among new subscribers after the launch [1].",
        sources,
      ),
    ).toBe(false);
  });

  test("rejects unsupported numeric claims even when the topic matches", () => {
    const sources = [
      {
        title: "Checkpoint recovery guide",
        excerpt:
          "Checkpoint recovery restores the last completed sync batch. Version 2.4 adds a recovery manifest.",
        canonicalUrl: "https://example.com/checkpoints",
      },
    ];

    expect(
      hasGroundedEvidenceResearchCitations(
        "Checkpoint recovery resumes the last completed sync batch in version 3.1 [1].",
        sources,
      ),
    ).toBe(false);
  });

  test("requires each citation in a paragraph to support that paragraph", () => {
    const sources = [
      {
        title: "Checkpoint recovery guide",
        excerpt:
          "Checkpoint recovery restores the last completed sync batch. Version 2.4 adds a recovery manifest.",
        canonicalUrl: "https://example.com/checkpoints",
      },
      {
        title: "Newsletter campaign report",
        excerpt:
          "Newsletter campaign conversion rose by 21% among new subscribers.",
        canonicalUrl: "https://example.com/newsletter",
      },
    ];

    expect(
      hasGroundedEvidenceResearchCitations(
        "Checkpoint recovery resumes the last completed sync batch [1][2].",
        sources,
      ),
    ).toBe(false);
    expect(
      hasGroundedEvidenceResearchCitations(
        "Checkpoint recovery resumes the last completed sync batch [1].\n\nNewsletter campaign conversion rose by 21% among new subscribers [2].",
        sources,
      ),
    ).toBe(true);
  });

  test("keeps uncited headings valid and checks list items independently", () => {
    const sources = [
      {
        title: "Checkpoint recovery guide",
        excerpt: "Checkpoint recovery restores the last completed sync batch.",
        canonicalUrl: "https://example.com/checkpoints",
      },
      {
        title: "Newsletter campaign report",
        excerpt:
          "Newsletter campaign conversion rose by 21% among new subscribers.",
        canonicalUrl: "https://example.com/newsletter",
      },
    ];

    expect(
      hasGroundedEvidenceResearchCitations(
        "## Findings\n\n- Checkpoint recovery resumes the last completed sync batch [1].\n- Newsletter campaign conversion rose by 21% among new subscribers [2].",
        sources,
      ),
    ).toBe(true);
    expect(
      hasGroundedEvidenceResearchCitations(
        "## Findings\n\n- Checkpoint recovery resumes the last completed sync batch [2].",
        sources,
      ),
    ).toBe(false);
  });
});
