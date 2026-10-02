/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import presenceTest from "@convex-dev/presence/test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "interactionScores");
  aggregateTest.register(t, "interactionSaves");
  aggregateTest.register(t, "commentCounts");
  registerRateLimiter(t);
  presenceTest.register(t);
  return t;
}

test("admin overview reports bounded samples rather than table totals", async () => {
  const t = setup();
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Owner",
      username: "owner",
      usernameNormalized: "owner",
      role: "owner",
    }),
  );

  await t.run(async (ctx) => {
    for (let index = 0; index < 101; index += 1) {
      await ctx.db.insert("users", {
        name: `Reader ${index}`,
        username: `reader-${index}`,
        usernameNormalized: `reader-${index}`,
        role: "reader",
      });
      await ctx.db.insert("newsletterSubscribers", {
        email: `reader-${index}@example.com`,
        emailNormalized: `reader-${index}@example.com`,
        status: "confirmed",
        source: "test",
        tokenHash: `token-${index}`,
        resendSyncStatus: "idle",
        createdAt: index,
        updatedAt: index,
      });
      await ctx.db.insert("analyticsEvents", {
        name: `event-${index}`,
        source: "convex",
        createdAt: index,
      });
    }
  });

  const overview = await t
    .withIdentity({ subject: ownerId, name: "Owner" })
    .query(api.admin.overview, {});

  expect(overview).not.toHaveProperty("totals");
  expect(overview.sampleCounts).toMatchObject({
    users: 101,
    readers: 100,
    newsletterSubscribers: 100,
    confirmedSubscribers: 100,
    analyticsEvents: 100,
  });
});
