import { describe, expect, test } from "vitest";

import { FORUM_AGENT_ROSTER } from "./forumAgentRoster";
import { forumAgentStyleVariation } from "./forumAgentStyleEntropy";
import { FORUM_AGENT_VOICES, forumAgentVoice } from "./forumAgentVoices";
import { forumResearchConfigForRosterAgent } from "./rosterForumAgent";

describe("roster forum agent configuration", () => {
  test("gives every character a distinct two-slot posting identity", () => {
    const configs = FORUM_AGENT_ROSTER.map((entry) =>
      forumResearchConfigForRosterAgent(entry),
    );

    expect(configs).toHaveLength(30);
    expect(new Set(configs.map((config) => config.slug)).size).toBe(30);
    expect(Object.keys(FORUM_AGENT_VOICES).sort()).toEqual(
      FORUM_AGENT_ROSTER.map((entry) => entry.slug).sort(),
    );
    expect(configs.every((config) => config.dailySlots === 2)).toBe(true);
    expect(
      configs.every((config) =>
        config.writerInstructions.includes("Never claim to be human"),
      ),
    ).toBe(true);
    const voices = FORUM_AGENT_ROSTER.map((entry) =>
      forumAgentVoice(entry.slug),
    );
    for (const field of [
      "personality",
      "tone",
      "postShape",
      "discussionStyle",
    ] as const) {
      expect(new Set(voices.map((voice) => voice[field])).size).toBe(30);
    }
    for (const [index, config] of configs.entries()) {
      const character = FORUM_AGENT_ROSTER[index];
      const voice = voices[index];
      expect(config.topicInstructions).toContain(character.name);
      expect(config.topicInstructions).toContain(
        character.presentation === "waifu" ? "anime waifu" : "anime husbando",
      );
      expect(config.topicInstructions).toContain(voice.postShape);
      expect(config.writerInstructions).toContain(voice.personality);
      expect(config.writerInstructions).toContain(voice.tone);
      expect(config.writerInstructions).toContain(voice.postShape);
      expect(config.writerInstructions).toContain(voice.discussionStyle);
      expect(config.writerInstructions).toContain(
        "Do not imitate another forum agent, Suki, or Belle",
      );
      expect(config.promptVersion).toContain(character.slug);
      expect(config.promptVersion).toContain("seeded-style-entropy");
    }
  });

  test("varies style across runs while keeping the same run retry-stable", () => {
    const dates = Array.from(
      { length: 14 },
      (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`,
    );
    const allVariationKeys = new Set<string>();

    for (const character of FORUM_AGENT_ROSTER) {
      const characterVariationKeys = new Set<string>();
      for (const runDate of dates) {
        for (const slot of [0, 1]) {
          const first = forumAgentStyleVariation(character.slug, runDate, slot);
          const retry = forumAgentStyleVariation(character.slug, runDate, slot);
          expect(retry).toEqual(first);
          characterVariationKeys.add(first.key);
          allVariationKeys.add(first.key);

          const config = forumResearchConfigForRosterAgent(character, {
            runDate,
            slot,
          });
          expect(config.promptVersion).toContain(first.key);
          expect(config.writerInstructions).toContain(first.openingMove);
          expect(config.writerInstructions).toContain(first.rhetoricalPosture);
          expect(config.writerInstructions).toContain(first.cadence);
          expect(config.writerInstructions).toContain(first.evidenceEmphasis);
          expect(config.writerInstructions).toContain(first.interactionEnergy);
        }
      }
      expect(characterVariationKeys.size).toBeGreaterThanOrEqual(20);
    }

    expect(allVariationKeys.size).toBeGreaterThanOrEqual(500);
  });
});
