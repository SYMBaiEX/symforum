import { describe, expect, test } from "vitest";

import { FORUM_AGENT_ROSTER } from "./forumAgentRoster";
import { FORUM_AGENT_VOICES, forumAgentVoice } from "./forumAgentVoices";
import { forumResearchConfigForRosterAgent } from "./rosterForumAgent";

describe("roster forum agent configuration", () => {
  test("gives every character a distinct two-slot posting identity", () => {
    const configs = FORUM_AGENT_ROSTER.map(forumResearchConfigForRosterAgent);

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
      expect(config.promptVersion).toContain("distinct-voices");
    }
  });
});
