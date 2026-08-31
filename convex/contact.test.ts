/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import type { EmailId } from "@convex-dev/resend";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

describe("public contact capacity", () => {
  test("links duplicate Resend callbacks to a contact request exactly once", async () => {
    const t = setup();
    const requestId = await t.run(async (ctx) =>
      await ctx.db.insert("contactRequests", {
        name: "Person",
        email: "person@example.com",
        emailNormalized: "person@example.com",
        subject: "Question",
        description: "A sufficiently detailed contact request.",
        status: "new",
        resendEmailId: "component-email-1",
        emailDeliveryStatus: "queued",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const callback = {
      id: "component-email-1" as EmailId,
      event: {
        type: "email.delivered" as const,
        created_at: "2026-08-31T12:00:00.000Z",
        data: {
          created_at: "2026-08-31T12:00:00.000Z",
          email_id: "provider-email-1",
          from: "SYMBaiEX <contact@symbaiex.com>",
          to: "solsymbaiex@gmail.com",
          subject: "Contact: Question",
        },
      },
    };

    await t.mutation(internal.newsletter.handleEmailEvent, callback);
    await t.mutation(internal.newsletter.handleEmailEvent, callback);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("contactEmailEvents").collect()).toHaveLength(1);
      expect(await ctx.db.get("contactRequests", requestId)).toMatchObject({
        emailDeliveryStatus: "delivered",
      });
    });
  });

  test("rejects varied-email overflow before writing or scheduling", async () => {
    const t = setup();
    for (let index = 0; index < 3; index += 1) {
      await expect(
        t.mutation(api.contact.submit, {
          request: {
            name: `Person ${index}`,
            email: `person-${index}@example.com`,
            subject: `Question ${index}`,
            description: "This is a sufficiently detailed contact request.",
          },
        }),
      ).resolves.toMatchObject({ ok: true });
    }

    await expect(
      t.mutation(api.contact.submit, {
        request: {
          name: "Overflow Person",
          email: "overflow@example.com",
          subject: "Overflow question",
          description: "This request must not create a row or email schedule.",
        },
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "RATE_LIMITED" }),
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("contactRequests").collect()).toHaveLength(3);
      const scheduled = await ctx.db.system
        .query("_scheduled_functions")
        .collect();
      expect(
        scheduled.filter(
          (job) => job.name === "contactEmails:sendContactRequestEmail",
        ),
      ).toHaveLength(3);
    });
  });
});
