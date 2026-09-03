import { describe, expect, test } from "vitest";

import {
  assertAgentPublicationHygiene,
  cleanLegacyAgentProcessLabels,
  evaluateAgentPublicationHygiene,
} from "./agent-publication-quality";

describe("agent publication quality", () => {
  test("blocks leaked process scaffolding without banning technical subjects", () => {
    for (const unsafe of [
      "Debug: I should inspect the hidden state first.",
      "[b]Analysis:[/b] The release changes the recovery path.",
      "[h2]Reasoning[/h2] I chose this source because...",
      "<analysis>private scratch work</analysis>",
      '{"tool_calls":[{"name":"publish"}]}',
      "As an AI language model, here is the requested draft.",
      "There are 10 supplied stories I must organize into briefs.",
      "Let me build the full payload with the correct headline length.",
      "Keep this under 500 chars, then trim it to fit.",
      "Wait—the analysis should focus on the release timeline.",
    ]) {
      expect(() => assertAgentPublicationHygiene(unsafe)).toThrow(
        "failed output hygiene",
      );
    }

    expect(
      evaluateAgentPublicationHygiene(
        "A compact debugging loop makes the deployment failure reproducible.",
      ).blockingIssues,
    ).toEqual([]);
    expect(
      evaluateAgentPublicationHygiene(
        "Analysis of Kubernetes recovery behavior shows one missing checkpoint.",
      ).blockingIssues,
    ).toEqual([]);
    expect(
      evaluateAgentPublicationHygiene(
        "Let me know which deployment window works for your team.",
      ).blockingIssues,
    ).toEqual([]);
  });

  test("ignores literal debug and tool syntax inside code examples", () => {
    expect(
      evaluateAgentPublicationHygiene(`[code=json]
{"tool_calls": [{"arguments": {"debug": true}}]}
[/code]`).blockingIssues,
    ).toEqual([]);
  });

  test("flags canned or repetitive prose for a same-pass revision", () => {
    const canned = evaluateAgentPublicationHygiene(
      "In today's fast-paced world, this game-changer deserves attention.",
    );
    expect(canned.blockingIssues).toHaveLength(1);
    expect(canned.naturalnessScore).toBeLessThan(100);
    expect(canned.feedback.join(" ")).toContain("canned AI-editorial");

    const repetitive = evaluateAgentPublicationHygiene(
      "This changes recovery. This narrows the blast radius. This gives operators a checkpoint. This reduces guesswork. This clarifies ownership. This makes rollback legible.",
    );
    expect(repetitive.feedback.join(" ")).toContain("Vary sentence openings");
  });

  test("removes only legacy presentation labels and preserves their prose", () => {
    expect(
      cleanLegacyAgentProcessLabels(`[note][b]Belle's read[/b]
Analysis: The practical implication is easier incident review.[/note]

[b]Debug:[/b] Reproduce the failure before changing configuration.`),
    ).toBe(`[note][b]Belle's read[/b]
The practical implication is easier incident review.[/note]

Reproduce the failure before changing configuration.`);
  });
});
