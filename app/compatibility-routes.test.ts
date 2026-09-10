import { describe, expect, test } from "vitest";

import { GET as getAgentLlms } from "@/app/agent/llms.txt/route";
import { GET as getDocsAlias } from "@/app/docs/[[...segments]]/route";
import { GET as getRootMcp, POST as postRootMcp } from "@/app/mcp/route";
import { GET as getRootMcpJson } from "@/app/mcp.json/route";
import { GET as getSandboxAlias } from "@/app/sandbox/route";

const docsContext = (segments?: string[]) => ({
  params: Promise.resolve({ segments }),
});

describe("agent-facing compatibility routes", () => {
  test("redirects conventional documentation and sandbox paths to canonical guides", async () => {
    const docs = await getDocsAlias(
      new Request("https://www.symbaiex.com/docs"),
      docsContext(),
    );
    const api = await getDocsAlias(
      new Request("https://www.symbaiex.com/docs/api"),
      docsContext(["api"]),
    );
    const sandboxDocs = await getDocsAlias(
      new Request("https://www.symbaiex.com/docs/sandbox"),
      docsContext(["sandbox"]),
    );
    const sandbox = getSandboxAlias();

    expect([docs, api, sandboxDocs, sandbox]).toEqual([
      expect.objectContaining({ status: 308 }),
      expect.objectContaining({ status: 308 }),
      expect.objectContaining({ status: 308 }),
      expect.objectContaining({ status: 308 }),
    ]);
    expect(docs.headers.get("location")).toBe(
      "https://www.symbaiex.com/developers",
    );
    expect(api.headers.get("location")).toBe(
      "https://www.symbaiex.com/developers/api",
    );
    expect(sandboxDocs.headers.get("location")).toBe(
      "https://www.symbaiex.com/developers/sandbox",
    );
    expect(sandbox.headers.get("location")).toBe(
      "https://www.symbaiex.com/developers/sandbox",
    );
  });

  test("keeps unknown documentation aliases structured and closed", async () => {
    const response = await getDocsAlias(
      new Request("https://www.symbaiex.com/docs/private"),
      docsContext(["private"]),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "DOCUMENTATION_ALIAS_NOT_FOUND",
      resolution: expect.stringContaining("/developers"),
    });
  });

  test("serves the same MCP card and public handshake from conventional root paths", async () => {
    const [card, jsonCard] = await Promise.all([
      getRootMcp(),
      getRootMcpJson(),
    ]);
    await expect(card.json()).resolves.toMatchObject({
      serverUrl: "https://www.symbaiex.com/api/agent/mcp",
      transport: "streamable-http",
    });
    await expect(jsonCard.json()).resolves.toMatchObject({
      name: "ai.symbaiex/evidence",
    });

    const handshake = await postRootMcp(
      new Request("https://www.symbaiex.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "compatibility-probe",
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

  test("publishes agent-scoped llms guidance without duplicating policy", async () => {
    const response = getAgentLlms();
    const body = await response.text();
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain("# SYMBaiEX agent operating instructions");
    expect(body).toContain("use only authorization_servers actually advertised");
  });
});
