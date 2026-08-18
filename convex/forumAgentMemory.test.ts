/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

describe("forum agent memory backfill", () => {
  test("does not re-index completed backfills invoked by the daily cron", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("forumAgentMaintenanceState", {
        key: "forum-agent-memory-backfill",
        completedAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
      });
    });

    await expect(
      t.action(internal.forumAgentMemory.backfillForumMemory, {}),
    ).resolves.toEqual({ indexed: 0, done: true });
  });
});
