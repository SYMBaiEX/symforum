// @vitest-environment node

import { describe, expect, test } from "vitest";

import { OPENROUTER_GENERATION_MODELS } from "../lib/ai-models";
import { NEWSLETTER_MODEL_IDS, scoreEditorialPackage } from "./newsletterAgent";

function long(value: string, length: number) {
  return `${value} ${"specific evidence and practical consequence ".repeat(20)}`.slice(
    0,
    length,
  );
}

function story(hnItemId: number, fact: string) {
  return {
    hnItemId,
    summary: long(`${fact} is the reported change.`, 180),
    whyItMatters: long(
      `This changes the decision for operators working with source ${hnItemId}.`,
      150,
    ),
    takeaways: [
      long("Verify the documented behavior before changing production.", 80),
      long("Watch the source-specific failure mode during rollout.", 80),
    ],
    signalScore: 80,
  };
}

function dailyDraft() {
  const stories = [
    story(1, "12 models"),
    story(2, "Version 2.4"),
    story(3, "8%"),
  ];
  return {
    subject: "Checkpoint recovery changes three deployment decisions",
    headline: "Checkpoint recovery changes three deployment decisions",
    dek: long(
      "Three source-specific changes alter verification and rollout work.",
      120,
    ),
    thesis: long(
      "The useful common thread is narrower than an industry shift: each source changes a different verification decision.",
      180,
    ),
    lead: long(
      "Start with the recovery boundary, then compare the versioned migration and measured rate in their own contexts.",
      240,
    ),
    heroHnItemId: 1,
    stories,
    chart: {
      title: "Editorial implementation signal",
      subtitle:
        "Belle's editorial score for implementation relevance, not a measured benchmark.",
      items: stories.map((item) => ({
        hnItemId: item.hnItemId,
        label: `Source ${item.hnItemId}`,
        value: 80,
        note: "A source-specific editorial comparison for implementation planning.",
      })),
    },
    practicalMoves: [
      long("Verify checkpoint behavior in a bounded staging job.", 70),
      long("Separate the version migration from recovery behavior.", 70),
      long("Record the observed rate before changing a threshold.", 70),
    ],
    whatToWatch: [
      long("Watch for source updates to the recovery contract.", 65),
      long("Watch for a revised measurement methodology.", 65),
    ],
    discussionQuestion: long(
      "Which of these source-specific verification steps would change your rollout plan?",
      90,
    ),
  };
}

const sources = [
  {
    hnItemId: 1,
    host: "one.example",
    sourceText: "The test covers 12 models and checkpoint recovery.",
  },
  {
    hnItemId: 2,
    host: "two.example",
    sourceText: "Version 2.4 documents a migration boundary.",
  },
  {
    hnItemId: 3,
    host: "three.example",
    sourceText: "The observed rate was 8% in this sample.",
  },
];

describe("Belle editorial scoring", () => {
  test("uses the proven free-first route with a DeepSeek fallback", () => {
    expect(NEWSLETTER_MODEL_IDS).toEqual(OPENROUTER_GENERATION_MODELS);
  });

  test("blocks a number that is absent from its story's own source", () => {
    const draft = dailyDraft();
    draft.stories[0].summary = long("40 models is the reported change.", 180);
    const quality = scoreEditorialPackage({
      draft,
      edition: "daily-signal",
      recent: { headlines: [], theses: [], storyIds: [] },
      sources,
    });

    expect(quality.blockingIssues.join(" ")).toContain("40 models");
    expect(quality.sourceCoverage).toBeLessThan(100);
  });

  test("blocks a recycled headline or thesis even with fresh source IDs", () => {
    const draft = dailyDraft();
    const quality = scoreEditorialPackage({
      draft,
      edition: "daily-signal",
      recent: {
        headlines: [draft.headline],
        theses: [],
        storyIds: [],
      },
      sources,
    });

    expect(quality.blockingIssues.join(" ")).toContain(
      "repeats a recent editorial frame",
    );
    expect(quality.originality).toBeLessThan(100);
  });

  test("blocks process scaffolding and canned model prose", () => {
    const draft = dailyDraft();
    draft.subject = "Debug: Checkpoint recovery changes deployment decisions";
    draft.lead = long(
      "In today's fast-paced world, this game-changer deserves attention.",
      240,
    );
    const quality = scoreEditorialPackage({
      draft,
      edition: "daily-signal",
      recent: { headlines: [], theses: [], storyIds: [] },
      sources,
    });

    expect(quality.blockingIssues.join(" ")).toContain("Remove process labels");
    expect(quality.blockingIssues.join(" ")).toContain("canned AI-editorial");
  });
});
