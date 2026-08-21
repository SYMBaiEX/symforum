import { describe, expect, test } from "vitest";

import { GET as getAgentSkills } from "@/app/.well-known/agent-skills/route";
import { GET as getAiCatalog } from "@/app/.well-known/ai-catalog.json/route";
import { GET as getApiCatalog } from "@/app/.well-known/api-catalog/route";
import { GET as getMcpCard } from "@/app/.well-known/mcp/server-card.json/route";
import { GET as getSecurityTxt } from "@/app/.well-known/security.txt/route";
import { GET as getAgentsMarkdown } from "@/app/agents.md/route";
import { GET as getSkillsMarkdown } from "@/app/skills.sh/route";
import { PUBLIC_AGENT_SKILLS } from "@/lib/agent-discovery";

describe("agent discovery surfaces", () => {
  test("publishes a cross-protocol AI catalog", async () => {
    const response = getAiCatalog();
    const catalog = await response.json();

    expect(response.headers.get("content-type")).toContain(
      "application/ai-catalog+json",
    );
    expect(catalog.specVersion).toBe("1.0");
    expect(catalog.host.identifier).toBe("symbaiex.com");
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://www.symbaiex.com/api/agent/openapi.json",
        }),
        expect.objectContaining({
          url: "https://www.symbaiex.com/api/agent/mcp/server-card",
        }),
      ]),
    );
  });

  test("publishes an RFC 9727 linkset with the public API contracts", async () => {
    const response = getApiCatalog();
    const catalog = await response.json();

    expect(response.headers.get("content-type")).toContain(
      "application/linkset+json",
    );
    expect(response.headers.get("content-type")).toContain("rfc9727");
    expect(catalog.linkset[0]["service-desc"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: "https://www.symbaiex.com/api/agent/openapi.json",
        }),
        expect.objectContaining({
          href: "https://www.symbaiex.com/api/agent/asyncapi.json",
        }),
      ]),
    );
  });

  test("publishes an authenticated MCP server card without fake OAuth", async () => {
    const response = getMcpCard();
    const card = await response.json();

    expect(response.headers.get("content-type")).toContain(
      "application/mcp-server-card+json",
    );
    expect(card.$schema).toBe(
      "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    );
    expect(card.description.length).toBeLessThanOrEqual(100);
    expect(card.remotes[0]).toMatchObject({
      type: "streamable-http",
      url: "https://www.symbaiex.com/api/agent/mcp",
      supportedProtocolVersions: ["2026-07-28", "2025-03-26"],
      headers: [
        expect.objectContaining({
          name: "Authorization",
          isRequired: true,
          isSecret: true,
        }),
      ],
    });
    expect(JSON.stringify(card)).not.toContain("oauth2");
    expect(card).not.toHaveProperty("tools");
    expect(card).not.toHaveProperty("capabilities");
  });

  test("publishes installable skills with task-selection guidance", async () => {
    const response = getAgentSkills();
    const index = await response.json();

    expect(index.skills).toHaveLength(PUBLIC_AGENT_SKILLS.length);
    expect(index.skills).toHaveLength(5);
    for (const skill of index.skills) {
      expect(skill.description).toMatch(/Use (for|when)/);
      expect(skill.url).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/SYMBaiEX\/symbaiex\/main\/\.agents\/skills\//,
      );
    }

    const installGuide = await getSkillsMarkdown().text();
    expect(installGuide).toContain(
      "bunx skills add SYMBaiEX/symbaiex --skill symbaiex-agent-enrollment",
    );
    expect(installGuide).toContain(
      "bunx skills add SYMBaiEX/symbaiex --skill '*'",
    );
  });

  test("publishes usage boundaries and a stable security contact", async () => {
    const agentsResponse = getAgentsMarkdown();
    const agents = await agentsResponse.text();
    const securityResponse = getSecurityTxt();
    const security = await securityResponse.text();

    expect(agents).toContain("## When to use SYMBaiEX");
    expect(agents).toContain(
      "Do not use SYMBaiEX as a general web search engine",
    );
    expect(security).toContain("Contact: mailto:austin@symbaiex.com");
    expect(security).toContain(
      "Canonical: https://www.symbaiex.com/.well-known/security.txt",
    );
  });
});
