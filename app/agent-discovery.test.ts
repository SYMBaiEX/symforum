import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GET as getAgentSkills } from "@/app/.well-known/agent-skills/route";
import { GET as getAgentSkillsV2 } from "@/app/.well-known/agent-skills/index.json/route";
import { GET as getAiCatalog } from "@/app/.well-known/ai-catalog.json/route";
import { GET as getApiCatalog } from "@/app/.well-known/api-catalog/route";
import { GET as getRootMcpCard } from "@/app/.well-known/mcp/route";
import {
  GET as getWellKnownMcp,
  POST as postWellKnownMcp,
} from "@/app/.well-known/mcp.json/route";
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
    expect(catalog.entries).toHaveLength(9);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://www.symbaiex.com/api/agent/openapi.json",
        }),
        expect.objectContaining({
          url: "https://www.symbaiex.com/api/agent/mcp/server-card",
        }),
        expect.objectContaining({
          url: "https://www.symbaiex.com/api/docs/mcp/server-card",
        }),
        expect.objectContaining({
          url: "https://www.symbaiex.com/.well-known/agent-card.json",
        }),
        expect.objectContaining({
          identifier: "urn:air:symbaiex.com:api:sandbox-v1",
          url: "https://www.symbaiex.com/api/sandbox",
          description: expect.stringContaining("Credential-free, read-only"),
          tags: expect.arrayContaining(["synthetic", "read-only"]),
        }),
        expect.objectContaining({
          identifier: "urn:air:symbaiex.com:api:sandbox-openapi-v1",
          type: "application/vnd.oai.openapi+json;version=3.1",
          url: "https://www.symbaiex.com/api/sandbox/openapi.json",
          tags: expect.arrayContaining(["sandbox", "openapi"]),
        }),
      ]),
    );
    expect(
      catalog.entries.every(
        (entry: { displayName?: string }) => entry.displayName,
      ),
    ).toBe(true);
    expect(
      catalog.entries.every(
        (entry: {
          trustManifest?: { identity?: string; trustSchema?: unknown };
        }) =>
          entry.trustManifest?.identity?.startsWith("https://symbaiex.com/") &&
          entry.trustManifest.trustSchema,
      ),
    ).toBe(true);
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
        expect.objectContaining({
          href: "https://www.symbaiex.com/api/sandbox/openapi.json",
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
      supportedProtocolVersions: ["2026-07-28", "2025-06-18", "2025-03-26"],
      headers: [
        expect.objectContaining({
          name: "Authorization",
          isRequired: false,
          isSecret: true,
        }),
      ],
    });
    expect(card.serverUrl).toBe("https://www.symbaiex.com/api/agent/mcp");
    expect(card.transport).toBe("streamable-http");
    expect(card.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "evidence_search" }),
        expect.objectContaining({ name: "evidence_verify_claim" }),
      ]),
    );
    expect(JSON.stringify(card)).not.toContain("oauth2");
    expect(JSON.stringify(card)).not.toContain("placeholder");
    expect(card).not.toHaveProperty("capabilities");
  });

  test("serves the product server card at the linked well-known MCP URL", async () => {
    const response = getRootMcpCard();
    const card = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/mcp-server-card+json",
    );
    expect(card.serverUrl).toBe("https://www.symbaiex.com/api/agent/mcp");
  });

  test("keeps the well-known GET card while accepting a public MCP handshake", async () => {
    const card = getWellKnownMcp();
    expect(card.status).toBe(200);
    expect(card.headers.get("content-type")).toContain(
      "application/mcp-server-card+json",
    );

    const handshake = await postWellKnownMcp(
      new Request("https://www.symbaiex.com/.well-known/mcp.json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "scanner",
          method: "initialize",
          params: { protocolVersion: "2025-03-26" },
        }),
      }),
    );
    expect(handshake.status).toBe(200);
    await expect(handshake.json()).resolves.toMatchObject({
      result: { serverInfo: { name: "symbaiex-evidence" } },
    });
  });

  test("publishes installable skills with task-selection guidance", async () => {
    const response = getAgentSkills();
    const index = await response.json();

    expect(index.skills).toHaveLength(PUBLIC_AGENT_SKILLS.length);
    expect(index.skills).toHaveLength(6);
    expect(index.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "symbaiex-docs-mcp",
          description: expect.stringContaining("read-only Documentation MCP"),
        }),
      ]),
    );
    expect(index.whenToUse).toContain("When to use SYMBaiEX");
    for (const skill of index.skills) {
      expect(skill.description).toMatch(/Use (for|when)/);
      expect(skill.url).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/SYMBaiEX\/skills\/master\/skills\//,
      );
    }

    const installGuide = await getSkillsMarkdown().text();
    expect(installGuide).toContain(
      "npx skills add symbaiex/skills --skill symbaiex-agent-enrollment",
    );
    expect(installGuide).toContain(
      "npx skills add symbaiex/skills --skill symbaiex-docs-mcp",
    );
    expect(installGuide).toContain(
      "npx skills add symbaiex/skills --skill '*'",
    );
    expect(installGuide).toContain(
      "bunx skills add symbaiex/skills --skill '*'",
    );
    expect(installGuide).toContain(
      "including general engineering and orchestration skills",
    );
    expect(installGuide).toContain("https://skills.sh/symbaiex/skills");
  });

  test("publishes the digest-bound Agent Skills discovery index", async () => {
    const response = getAgentSkillsV2();
    const index = await response.json();

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(index.$schema).toBe(
      "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    );
    expect(index.skills).toHaveLength(PUBLIC_AGENT_SKILLS.length);
    for (const skill of index.skills) {
      expect(skill.type).toBe("skill-md");
      expect(skill.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(skill.url).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/SYMBaiEX\/skills\/master\/skills\//,
      );
      const local = readFileSync(
        join(process.cwd(), ".agents", "skills", skill.name, "SKILL.md"),
      );
      expect(`sha256:${createHash("sha256").update(local).digest("hex")}`).toBe(
        skill.digest,
      );
    }
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
    expect(agents).toContain(
      "Human OAuth login is handled by WorkOS Connect only when the protected-resource metadata advertises it",
    );
    expect(agents).toContain(
      "https://www.symbaiex.com/.well-known/oauth-protected-resource",
    );
    expect(agents).toContain(
      "https://www.symbaiex.com/.well-known/symbaiex-agent-authentication",
    );
    expect(security).toContain("Contact: mailto:austin@symbaiex.com");
    expect(security).toContain(
      "Canonical: https://www.symbaiex.com/.well-known/security.txt",
    );
  });
});
