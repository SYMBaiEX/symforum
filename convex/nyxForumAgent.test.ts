/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";
import { NYX_PROFILE, NYX_ROUTING_METADATA } from "./nyxProfile";
import { NYX_RESEARCH_CONFIG } from "./nyxForumAgent";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

describe("NyX research agent", () => {
  test("exposes an explicit synthetic profile and bounded research route", () => {
    expect(NYX_PROFILE).toMatchObject({
      slug: "nyx",
      name: "NyX",
      title: "AI Agent · Research Synthesist",
      location: "The Research Lab",
      dailySlots: 1,
      dailyPostTarget: 1,
      enabled: true,
      routeFeature: "research",
    });
    expect(NYX_PROFILE.bio).toContain("AI agent");
    expect(NYX_PROFILE.bio).toContain("not a human identity");
    expect(NYX_RESEARCH_CONFIG.routeFeature).toBe("research");
    expect(NYX_RESEARCH_CONFIG.forcedCategorySlug).toBe("research");
    expect(NYX_RESEARCH_CONFIG.topicInstructions).toContain(
      "clearly disclosed AI agent",
    );
    expect(NYX_RESEARCH_CONFIG.writerInstructions).toContain(
      "Never present yourself as a human",
    );
    expect(NYX_ROUTING_METADATA).toMatchObject({
      agent: "nyx",
      feature: "research",
      model: NYX_PROFILE.model,
      provider: "openrouter",
    });
  });

  test("creates an enabled AI forum identity without exposing credentials", async () => {
    const t = setup();
    const ensured = await t.mutation(
      internal.forum.ensureNyxForumInfrastructure,
      {},
    );
    expect(ensured).toMatchObject({
      agentSlug: "nyx",
      enabled: true,
      model: NYX_PROFILE.model,
    });

    const stored = await t.run(async (ctx) => {
      const user = await ctx.db.get("users", ensured.agentUserId);
      const profile = await ctx.db
        .query("forumUserProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", ensured.agentUserId))
        .unique();
      const agent = await ctx.db
        .query("forumAgents")
        .withIndex("by_slug", (q) => q.eq("slug", "nyx"))
        .unique();
      return { user, profile, agent };
    });
    expect(stored.user).toMatchObject({
      name: "NyX",
      isAgent: true,
      agentSlug: "nyx",
    });
    expect(stored.profile).toMatchObject({
      customTitle: "AI Agent · Research Synthesist",
      location: "The Research Lab",
    });
    expect(stored.agent).toMatchObject({
      slug: "nyx",
      enabled: true,
      dailyPostTarget: 1,
      model: NYX_PROFILE.model,
    });
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toMatch(
      /(?:api[_-]?key|client[_-]?secret|private[_-]?(?:key|token))/i,
    );

    const publicAgents = await t.query(
      api.forumAgentRoster.listPublicAgents,
      {},
    );
    expect(publicAgents).toContainEqual(
      expect.objectContaining({
        slug: "nyx",
        name: "NyX",
        title: "AI Agent · Research Synthesist",
        location: "The Research Lab",
        dailyPostTarget: 1,
      }),
    );
  });
});
