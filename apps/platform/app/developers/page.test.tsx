import { renderToReadableStream } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import DevelopersPage, { metadata } from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("SYMBaiEX developer resources page", () => {
  test("publishes a branded, crawlable index of every public developer surface", async () => {
    const stream = await renderToReadableStream(<DevelopersPage />);
    await stream.allReady;
    const html = await new Response(stream).text();

    expect(metadata.title).toBe("SYMBaiEX Developer API, MCP, SDK & CLI");
    expect(metadata.description).toContain("WebMCP");
    expect(html).toContain("<h1");
    expect(html).toContain("SYMBaiEX developer resources");
    expect(html).toContain("SoftwareApplication");
    expect(html).toContain("@symbaiex/agent-sdk");
    expect(html).toContain("@symbaiex/agent-cli");
    expect(html).toContain("@symbaiex/agent-sdk@0.1.0");
    expect(html).toContain("@symbaiex/agent-cli@0.1.0 manifest");
    expect(html).toContain("https://www.symbaiex.com/api/docs/mcp");
    expect(html).toContain("https://www.symbaiex.com/api/agent/mcp");
    expect(html).toContain(
      'href="https://glama.ai/mcp/connectors/com.symbaiex.www/evidence"',
    );
    expect(html).toContain("Third-party Glama connector page");
    expect(html).toContain('href="/.well-known/mcp"');
    expect(html).toContain('href="/api/research/catalog"');
    expect(html).toContain("current x402 readiness");
    expect(html).toContain("human owner session");
    expect(html).toContain("verified linked Solana wallet");
    expect(html).toContain("explicit one-purchase approval");
    expect(html).toContain("Evidence-agent grants do not authorize spending");
    expect(html).toContain("free forum content is unchanged");
    expect(html).toContain(
      "catalog discovery does not activate it or authorize a purchase",
    );
    expect(html).toContain('href="/developers/webmcp"');
    expect(html).toContain(
      'href="https://skills.sh/symbaiex/skills">the SYMBaiEX Skills.sh listing</a>',
    );
    expect(html).toContain(
      "npx skills add symbaiex/skills --skill symbaiex-docs-mcp",
    );
    expect(html).toContain(
      "npx skills add symbaiex/skills --skill symbaiex-agent-enrollment",
    );
    expect(html).toContain("Bun users can replace");
    for (const name of ["evidence", "docs"])
      expect(html).toContain(
        `href="https://registry.modelcontextprotocol.io/v0.1/servers/com.symbaiex.www%2F${name}/versions/1.0.0"`,
      );
    expect(html).toContain("search_symbaiex_docs");
    expect(html).toContain("read_symbaiex_doc");
    expect(html).toContain("WorkOS Connect");
    expect(html).toContain('toolname="search_symbaiex_public_resources"');
    expect(html).toContain("toolparamdescription=");
    expect(html).toContain('action="https://www.symbaiex.com/ask"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="query"');
    expect(html).toMatch(/maxlength="300"/i);
    expect(html).toContain(
      'aria-describedby="browser-resource-search-description"',
    );
    expect(html).not.toContain("toolautosubmit");
    expect(html).toContain(
      "Submitting opens the machine-readable JSON results.",
    );
    for (const path of [
      "api",
      "openapi",
      "authentication",
      "cli",
      "mcp",
      "webhooks",
      "api-lifecycle",
    ])
      expect(html).toContain(`href="/developers/${path}"`);
    for (const resource of [
      "API docs",
      "OpenAPI 3.1 contract",
      "authentication guide",
      "MCP server cards",
      "signed webhook contract",
      "official SDK and CLI",
      "synthetic sandbox",
    ]) {
      expect(html).toContain(resource);
    }
  });
});
