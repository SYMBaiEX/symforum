/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
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
