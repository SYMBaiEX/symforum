import { describe, expect, test } from "vitest";
import { evaluateBelleDigestGrounding } from "./belle-digest-quality";

describe("Belle digest source grounding", () => {
  test("accepts one source-grounded brief for every selected story", () => {
    expect(
      evaluateBelleDigestGrounding({
        expectedStoryIds: [41, 42],
        briefs: [
          {
            hnItemId: 41,
            summary:
              "The release adds deterministic provenance and records source metadata.",
            analysis:
              "That gives operators a direct way to trace each published claim.",
          },
          {
            hnItemId: 42,
            summary:
              "The benchmark compares two storage modes across three workloads.",
            analysis:
              "The difference matters most when operators need to predict memory pressure.",
          },
        ],
        sources: [
          {
            hnItemId: 41,
            sourceText:
              "The release adds deterministic provenance and records source metadata for every published claim.",
          },
          {
            hnItemId: 42,
            sourceText:
              "The benchmark compares two storage modes across three workloads and reports memory pressure.",
          },
        ],
      }),
    ).toMatchObject({ passed: true, expectedStoryCount: 2, briefCount: 2 });
  });

  test("blocks duplicate, missing, and unselected story briefs", () => {
    const result = evaluateBelleDigestGrounding({
      expectedStoryIds: [41, 42],
      briefs: [
        { hnItemId: 41, summary: "First story", analysis: "Its implication." },
        { hnItemId: 41, summary: "Repeated story", analysis: "More copy." },
        { hnItemId: 99, summary: "Unknown story", analysis: "More copy." },
      ],
      sources: [{ hnItemId: 41, sourceText: "First story source." }],
    });

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate_brief",
        "missing_brief",
        "unexpected_brief",
      ]),
    );
  });

  test("checks each brief only against its own source", () => {
    const result = evaluateBelleDigestGrounding({
      expectedStoryIds: [41, 42],
      briefs: [
        {
          hnItemId: 41,
          summary: "The model accepts a 256000 token context.",
          analysis: "That could reduce prompt compaction.",
        },
        {
          hnItemId: 42,
          summary: "The model accepts a 256000 token context.",
          analysis: "That could reduce prompt compaction.",
        },
      ],
      sources: [
        {
          hnItemId: 41,
          sourceText: "The model accepts a 128000 token context.",
        },
        {
          hnItemId: 42,
          sourceText: "The model accepts a 256000 token context.",
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual({
      code: "unsupported_verifiable_token",
      hnItemId: 41,
      tokens: ["256000 token"],
    });
  });

  test("treats a missing source extract as a blocking grounding issue", () => {
    const result = evaluateBelleDigestGrounding({
      expectedStoryIds: [41],
      briefs: [
        { hnItemId: 41, summary: "A summary.", analysis: "An analysis." },
      ],
      sources: [],
    });

    expect(result).toMatchObject({
      passed: false,
      issues: [{ code: "missing_source", hnItemId: 41 }],
    });
  });

  test("checks the shared opening and closing against the complete source packet", () => {
    const result = evaluateBelleDigestGrounding({
      expectedStoryIds: [41],
      briefs: [
        { hnItemId: 41, summary: "A summary.", analysis: "An analysis." },
      ],
      sources: [{ hnItemId: 41, sourceText: "A report without a benchmark." }],
      editorialText: [
        { field: "opening", text: "The benchmark improved throughput by 37%." },
      ],
    });

    expect(result.issues).toContainEqual({
      code: "unsupported_editorial_token",
      field: "opening",
      tokens: ["37%"],
    });
  });
});
