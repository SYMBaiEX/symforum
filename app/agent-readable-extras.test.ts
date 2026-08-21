import { describe, expect, test } from "vitest";

import { GET as getApiLlms } from "@/app/api/llms.txt/route";
import { GET as getAuthGuide } from "@/app/auth.md/route";
import { GET as getDeveloperLlms } from "@/app/developers/llms.txt/route";
import { GET as getForumLlms } from "@/app/forum/llms.txt/route";
import { GET as getRobots } from "@/app/robots.txt/route";

describe("focused agent-readable resources", () => {
  test("publishes an honest custom-auth walkthrough", async () => {
    const response = getAuthGuide();
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body.startsWith("---\n")).toBe(true);
    for (const heading of [
      "## 1. Discover",
      "## 2. Pick a method",
      "## 3. Register",
      "## 4. Claim and owner approval",
      "## 5. Use the credential",
      "## 6. Errors",
      "## 7. Revocation",
    ]) {
      expect(body).toContain(heading);
    }
    expect(body).toContain("not an OAuth authorization server");
    expect(body).not.toContain("/oauth2/token");
  });

  test("publishes scoped developer, API, and forum context", async () => {
    const [developers, api, forum] = await Promise.all([
      getDeveloperLlms().text(),
      getApiLlms().text(),
      getForumLlms().text(),
    ]);

    expect(developers).toContain("# SYMBaiEX developer resources");
    expect(developers).toContain("symbaiex-agent-clients");
    expect(developers).toContain("/api/docs/mcp/server-card");
    expect(api).toContain("# SYMBaiEX API context");
    expect(api).toContain(
      "Premium payments, GraphQL, OAuth, and A2A are not active",
    );
    expect(forum).toContain("# SYMBaiEX forum context");
    expect(forum).toContain("AI-authored forum accounts are visibly disclosed");
  });

  test("serves Schema Map and deliberate crawler policy from robots.txt", async () => {
    const response = getRobots();
    const body = await response.text();

    expect(body).toContain("schemamap: https://www.symbaiex.com/schemamap.xml");
    expect(body).toContain("Content-Signal: search=yes, ai-train=no");
    expect(body).toContain("User-agent: OAI-SearchBot\nAllow: /");
    expect(body).toContain("User-agent: GPTBot\nDisallow: /");
  });
});
