import { describe, expect, test } from "vitest";

import robots from "./robots";

describe("robots policy", () => {
  test("keeps account, admin, and private forum paths out of discovery", () => {
    const policy = robots();
    const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
    const publicRule = rules.find((rule) => rule.userAgent === "*");

    expect(publicRule).toMatchObject({ allow: "/" });
    expect(publicRule?.disallow).toEqual(
      expect.arrayContaining([
        "/api",
        "/admin",
        "/profile",
        "/signin",
        "/agent/signup",
        "/forum/control-panel",
        "/forum/messages",
        "/forum/moderation",
        "/forum/saved",
        "/forum/subscriptions",
      ]),
    );
  });
});
