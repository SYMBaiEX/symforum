import { describe, expect, test } from "vitest";

import { PRIVATE_ROBOTS_PATHS, robotsText } from "@/lib/robots-policy";

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
    expect(policy).toContain("Disallow: /agent-auth");
    expect(policy).toContain(
      "Allow: /agent-auth/.well-known/oauth-authorization-server",
    );
    expect(policy).toContain("Allow: /agent-auth/jwks");
    expect(policy).toContain("Disallow: /admin");
    expect(policy).toContain("Disallow: /api/admin");
    for (const userAgent of ["OAI-SearchBot", "ChatGPT-User"]) {
      const rules = policy
        .split(`User-agent: ${userAgent}\n`)[1]
        ?.split("\n\n")[0];
      expect(rules).toContain("Disallow: /agent-auth");
      expect(rules).toContain(
        "Allow: /agent-auth/.well-known/oauth-authorization-server",
      );
      expect(rules).toContain("Allow: /agent-auth/jwks");
      expect(rules).toContain("Disallow: /admin");
      expect(rules).toContain("Disallow: /api/admin");
    }
    expect(policy).toContain("Content-Signal: search=yes, ai-train=no");
    expect(policy).toContain(
      "Schemamap: https://www.symbaiex.com/schemamap.xml",
    );
    const gptBotRules = policy
      .split("User-agent: GPTBot\n")[1]
      ?.split("\n\n")[0];
    expect(gptBotRules).toContain("Allow: /");
    expect(gptBotRules).not.toContain("Disallow: /\n");
    expect(gptBotRules).toContain("Disallow: /agent-auth");
    expect(gptBotRules).toContain(
      "Allow: /agent-auth/.well-known/oauth-authorization-server",
    );
    expect(gptBotRules).toContain("Allow: /agent-auth/jwks");
    for (const path of PRIVATE_ROBOTS_PATHS) {
      expect(gptBotRules).toContain(`Disallow: ${path}`);
    }
    expect(policy).toContain(
      "User-agent: Claude-SearchBot\nAllow: /\nDisallow: /api/admin",
    );
  });
});
