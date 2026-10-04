import { describe, expect, test } from "vitest";

import { GET as getApiLlms } from "@/app/api/llms.txt/route";
import { GET as getAuthGuide } from "@/app/auth.md/route";
import { GET as getDeveloperLlms } from "@/app/developers/llms.txt/route";
import { GET as getForumLlms } from "@/app/forum/llms.txt/route";
import { GET as getSiteLlms } from "@/app/llms.txt/route";
import { GET as getRobots } from "@/app/robots.txt/route";
import {
  DOCS_MCP_SERVER_CARD,
  MCP_ALIAS_SERVER_CARD,
  MCP_SERVER_CARD,
  SKILLS_SH_LISTING_URL,
} from "@/lib/agent-discovery";

describe("focused agent-readable resources", () => {
  test("publishes an honest custom-auth walkthrough", async () => {
    const response = getAuthGuide();
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body.startsWith("# SYMBaiEX agent authentication\n")).toBe(true);
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
    expect(body).toContain("WorkOS Connect is a separate managed OAuth issuer");
    expect(body).toContain(
      "First-party service_auth is not enabled in this deployment",
    );
    expect(body).toContain("`owner_enrollment_url`");
    expect(body).toContain("`owner_approval_url`");
    expect(body).toContain("`owner_revocation_url`");
    expect(body).not.toContain("/oauth2/token");
  });

  test("publishes scoped developer, API, and forum context", async () => {
    const [developers, api, forum, site] = await Promise.all([
      getDeveloperLlms().text(),
      getApiLlms().text(),
      getForumLlms().text(),
      getSiteLlms().text(),
    ]);

    expect(developers).toContain("# SYMBaiEX developer resources");
    expect(developers).toContain("symbaiex-agent-clients");
    expect(developers).toContain("@symbaiex/agent-sdk@0.1.0");
    expect(developers).toContain("@symbaiex/agent-cli@0.1.0");
    expect(developers).toContain("/.well-known/mcp");
    expect(developers).toContain("https://www.symbaiex.com/developers/webmcp");
    expect(developers).toContain("/api/docs/mcp/server-card");
    expect(developers).toContain("/api/sandbox/openapi.json");
    expect(developers).toContain("/developers/forum-plugin");
    expect(developers).toContain(SKILLS_SH_LISTING_URL);
    expect(site).toContain(SKILLS_SH_LISTING_URL);
    for (const registryUrl of [
      DOCS_MCP_SERVER_CARD._meta["com.symbaiex/registry"].url,
      MCP_SERVER_CARD._meta["com.symbaiex/registry"].url,
    ]) {
      expect(developers).toContain(registryUrl);
      expect(site).toContain(registryUrl);
    }
    expect(site).toContain("/developers/forum-plugin");
    expect(site).toContain("/.well-known/mcp");
    expect(site).toContain("/mcp/server-card");
    expect(MCP_ALIAS_SERVER_CARD.remotes[0].url).toBe(
      MCP_ALIAS_SERVER_CARD.serverUrl,
    );
    expect(site).toContain("https://www.symbaiex.com/developers/webmcp");
    expect(api).toContain("# SYMBaiEX API context");
    expect(api).toContain("/.well-known/mcp");
    expect(api).toContain("/developers/webmcp");
    expect(api).toContain("Premium payments and GraphQL are not active");
    expect(api).toContain("read-only A2A documentation agent");
    expect(api).toContain("deterministic synthetic fixtures");
    expect(api).toContain("/api/sandbox/openapi.json");
    expect(forum).toContain("# SYMBaiEX forum context");
    expect(forum).toContain("AI-authored forum accounts are visibly disclosed");
  });

  test("serves deliberate crawler policy and NLWeb Schema Map discovery", async () => {
    const response = getRobots();
    const body = await response.text();

    expect(body).toContain("Schemamap: https://www.symbaiex.com/schemamap.xml");
    expect(body).toContain("Content-Signal: search=yes, ai-train=no");
    expect(body).toContain("User-agent: OAI-SearchBot\nAllow: /");
    expect(body).toContain("User-agent: GPTBot\nDisallow: /\n");
    expect(body).not.toContain("User-agent: GPTBot\nAllow: /");
  });
});
