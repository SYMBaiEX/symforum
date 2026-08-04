/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

describe("dormant forum agent roster", () => {
  test("creates 30 tagged, visible, disabled forum agents idempotently", async () => {
    const t = setup();

    const first = await t.mutation(
      internal.forumAgentRoster.ensureDormantForumAgentRoster,
      {},
    );
    expect(first).toMatchObject({
      requested: 30,
      createdUsers: 30,
      createdProfiles: 30,
      createdAgents: 30,
    });
    expect(first.members).toHaveLength(30);

    const stored = await t.run(async (ctx) => {
      const users = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "reader"))
        .take(40);
      const profiles = await ctx.db.query("forumUserProfiles").take(40);
      const agents = await ctx.db.query("forumAgents").take(40);
      return { agents, profiles, users };
    });
    expect(stored.users).toHaveLength(30);
    expect(stored.users.every((user) => user.isAgent === true)).toBe(true);
    expect(
      stored.users.every((user) => user.forumTrustedAt !== undefined),
    ).toBe(true);
    expect(stored.profiles).toHaveLength(30);
    expect(
      stored.profiles.every((profile) =>
        profile.customTitle?.startsWith("AI Agent"),
      ),
    ).toBe(true);
    expect(stored.agents).toHaveLength(30);
    expect(stored.agents.every((agent) => agent.enabled === false)).toBe(true);
    expect(stored.agents.every((agent) => agent.model === "unassigned")).toBe(
      true,
    );
    expect(stored.agents.every((agent) => agent.dailyPostTarget === 0)).toBe(
      true,
    );

    const second = await t.mutation(
      internal.forumAgentRoster.ensureDormantForumAgentRoster,
      {},
    );
    expect(second).toMatchObject({
      requested: 30,
      createdUsers: 0,
      createdProfiles: 0,
      createdAgents: 0,
    });

    const roster = await t.query(
      internal.forumAgentRoster.readForumAgentRoster,
      {},
    );
    expect(roster).toMatchObject({ requested: 30, configured: 30, enabled: 0 });
  });

  test("does not take a username already owned by another member", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Existing Member",
        username: "maravenn",
        usernameNormalized: "maravenn",
        role: "reader",
        forumTrustedAt: Date.now(),
      });
    });

    const result = await t.mutation(
      internal.forumAgentRoster.ensureDormantForumAgentRoster,
      {},
    );
    expect(
      result.members.find((member) => member.agentSlug === "mara-venn"),
    ).toMatchObject({ username: "maravenn-agent" });
  });
});
