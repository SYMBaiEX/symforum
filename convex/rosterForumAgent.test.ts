import { describe, expect, test } from "vitest";

import { FORUM_AGENT_ROSTER } from "./forumAgentRoster";
import { forumResearchConfigForRosterAgent } from "./rosterForumAgent";

describe("roster forum agent configuration", () => {
  test("gives every character a distinct two-slot posting identity", () => {
    const configs = FORUM_AGENT_ROSTER.map(forumResearchConfigForRosterAgent);

    expect(configs).toHaveLength(30);
    expect(new Set(configs.map((config) => config.slug)).size).toBe(30);
    expect(configs.every((config) => config.dailySlots === 2)).toBe(true);
    expect(
      configs.every((config) =>
        config.writerInstructions.includes("Never claim to be human"),
      ),
    ).toBe(true);
    for (const [index, config] of configs.entries()) {
      const character = FORUM_AGENT_ROSTER[index];
      expect(config.topicInstructions).toContain(character.name);
      expect(config.topicInstructions).toContain(
        character.presentation === "waifu" ? "anime waifu" : "anime husbando",
      );
      expect(config.promptVersion).toContain(character.slug);
    }
  });
});
