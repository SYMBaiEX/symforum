import { describe, expect, it } from "vitest";
import {
  editorialWordCount,
  parseEditorialNewsletterPayload,
  type EditorialNewsletterPayload,
} from "./newsletterPayload";

function payload(): EditorialNewsletterPayload {
  return {
    kind: "editorial-newsletter",
    version: 2,
    edition: "daily-signal",
    runDate: "2026-07-30",
    snapshotDate: "2026-07-30",
    generatedAt: 1,
    siteUrl: "https://www.symbaiex.com",
    newsUrl: "https://www.symbaiex.com/news",
    archiveUrl: "https://www.symbaiex.com/newsletter/daily-signal-2026-07-30",
    author: {
      name: "Belle",
      role: "AI research editor",
      disclosure: "AI-assisted and source-linked.",
    },
    headline: "The infrastructure layer is becoming the product",
    dek: "Three source-led developments point to a practical shift.",
    thesis:
      "The most important changes are moving below the interface and into the operational layer.",
    lead: "Teams are discovering that reliability, deployment, and observability choices shape the product more directly than another surface feature.",
    stories: [
      {
        hnItemId: 1,
        title: "A primary source",
        host: "example.com",
        sourceUrl: "https://example.com/source",
        discussionUrl: "https://news.ycombinator.com/item?id=1",
        siteUrl: "https://www.symbaiex.com/news/a-primary-source-1",
        summary: "A factual summary grounded in the supplied source.",
        whyItMatters: "It changes a concrete engineering decision.",
        takeaways: ["Audit the dependency boundary.", "Test the failure path."],
        signalScore: 82,
      },
    ],
    chart: {
      title: "Relative editorial signal",
      subtitle: "Scores compare practical relevance across this source set.",
      metricLabel: "Belle editorial signal / 0–100",
      items: [
        { label: "Reliability", value: 82, note: "High operational impact." },
        { label: "Adoption", value: 71, note: "Moderate near-term pull." },
        { label: "Risk", value: 64, note: "Worth active monitoring." },
      ],
    },
    practicalMoves: ["Audit the boundary.", "Test the failure mode."],
    whatToWatch: ["Follow the implementation evidence.", "Watch adoption."],
    discussion: {
      question: "Where has infrastructure already become product work?",
    },
    methodology: "Selected from a bounded source packet.",
    quality: {
      score: 91,
      sourceCoverage: 100,
      sourceDiversity: 100,
      originality: 90,
      utility: 90,
      notes: [],
    },
  };
}

describe("editorial newsletter payload", () => {
  it("round-trips a valid source-linked edition", () => {
    const value = payload();
    expect(parseEditorialNewsletterPayload(JSON.stringify(value))).toEqual(
      value,
    );
  });

  it("rejects legacy or malformed JSON", () => {
    expect(
      parseEditorialNewsletterPayload(
        JSON.stringify({ kind: "daily-news", version: 1 }),
      ),
    ).toBeNull();
    expect(parseEditorialNewsletterPayload("{broken")).toBeNull();
  });

  it("counts editorial copy without counting URLs or schema keys", () => {
    expect(editorialWordCount(payload())).toBeGreaterThan(40);
  });
});
