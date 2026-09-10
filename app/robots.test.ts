import { describe, expect, test } from "vitest";

import { robotsText } from "@/lib/robots-policy";

describe("robots policy", () => {
  test("keeps account, admin, and private forum paths out of discovery", () => {
    const policy = robotsText();

    expect(policy).toContain("User-agent: *\nAllow: /");
    for (const path of [
      "/api/admin",
      "/api/agent/auth",
      "/admin",
      "/profile",
      "/forum/control-panel",
      "/forum/messages",
      "/forum/moderation",
      "/forum/saved",
      "/forum/subscriptions",
    ]) {
      expect(policy).toContain(`Disallow: ${path}`);
    }
    expect(policy).not.toContain("Disallow: /signin");
    expect(policy).not.toContain("Disallow: /agent/signup");
    expect(policy).toContain("Content-Signal: search=yes, ai-train=no");
    expect(policy).toContain(
      "Schemamap: https://www.symbaiex.com/schemamap.xml",
    );
    expect(policy).toContain("User-agent: GPTBot\nDisallow: /");
  });
});
