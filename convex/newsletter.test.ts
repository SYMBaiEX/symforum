/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { trustedNewsletterSiteUrl } from "./newsletterModel";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

describe("newsletter email link origin", () => {
  test("uses the configured newsletter origin instead of a caller-controlled origin", () => {
    const trusted = trustedNewsletterSiteUrl(
      "https://news.symbaiex.com/path-that-must-not-be-in-links",
      "https://symbaiex.com",
      "https://attacker.example/confirmation-or-manage-or-welcome",
    );

    // subscribe, requestViewerSubscription, and confirm all pass their legacy
    // caller value here before scheduling confirmation/manage/welcome email.
    expect(trusted).toBe("https://news.symbaiex.com");
    expect(trusted).not.toBe("https://attacker.example");
  });

  test("falls back only through trusted environment values", () => {
    expect(
      trustedNewsletterSiteUrl("not a URL", "https://symbaiex.com/ignored"),
    ).toBe("https://symbaiex.com");
    expect(trustedNewsletterSiteUrl(undefined, "javascript:alert(1)")).toBe(
      "https://symbaiex.com",
    );
  });

  test("never schedules confirmation, manage, or welcome links to a caller origin", async () => {
    const t = setup();
    const tokenHash = (value: string) => value.repeat(64).slice(0, 64);

    await t.mutation(api.newsletter.subscribe, {
      email: "pending@example.com",
      token: "confirmation-token",
      tokenHash: tokenHash("a"),
      siteUrl: "https://attacker.example/confirmation",
    });
    const confirmedId = await t.run(async (ctx) =>
      await ctx.db.insert("newsletterSubscribers", {
        email: "confirmed@example.com",
        emailNormalized: "confirmed@example.com",
        status: "confirmed",
        source: "test",
        dailyOptIn: true,
        weeklyOptIn: true,
        tokenHash: tokenHash("b"),
        resendSyncStatus: "idle",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.mutation(api.newsletter.subscribe, {
      email: "confirmed@example.com",
      token: "manage-token",
      tokenHash: tokenHash("c"),
      siteUrl: "https://attacker.example/manage",
    });
    const welcomeId = await t.run(async (ctx) =>
      await ctx.db.insert("newsletterSubscribers", {
        email: "welcome@example.com",
        emailNormalized: "welcome@example.com",
        status: "pending",
        source: "test",
        dailyOptIn: true,
        weeklyOptIn: true,
        tokenHash: tokenHash("d"),
        resendSyncStatus: "idle",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.mutation(api.newsletter.confirm, {
      tokenHash: tokenHash("d"),
      siteUrl: "https://attacker.example/welcome",
    });

    const scheduled = await t.run(async (ctx) =>
      await ctx.db.system.query("_scheduled_functions").collect(),
    );
    const emailJobs = scheduled.filter((job) =>
      [
        "newsletterEmails:sendConfirmationEmail",
        "newsletterEmails:sendManageSubscriptionEmail",
        "newsletterEmails:sendWelcomeEmail",
      ].includes(job.name),
    );
    expect(emailJobs).toHaveLength(3);
    expect(emailJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "newsletterEmails:sendConfirmationEmail",
          args: [expect.objectContaining({ siteUrl: "https://symbaiex.com" })],
        }),
        expect.objectContaining({
          name: "newsletterEmails:sendManageSubscriptionEmail",
          args: [
            expect.objectContaining({
              subscriberId: confirmedId,
              siteUrl: "https://symbaiex.com",
            }),
          ],
        }),
        expect.objectContaining({
          name: "newsletterEmails:sendWelcomeEmail",
          args: [
            expect.objectContaining({
              subscriberId: welcomeId,
              siteUrl: "https://symbaiex.com",
            }),
          ],
        }),
      ]),
    );
    expect(JSON.stringify(emailJobs)).not.toContain("attacker.example");
  });
});
