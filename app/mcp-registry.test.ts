import { describe, expect, test } from "vitest";
import { GET, HEAD } from "@/app/.well-known/mcp-registry-auth/route";
import { MCP_SERVER_CARD, DOCS_MCP_SERVER_CARD } from "@/lib/agent-discovery";
import evidence from "@/registry/evidence.server.json";
import docs from "@/registry/docs.server.json";

describe("MCP Registry identity", () => {
  test("serves a direct bounded public-key proof without exposing private material", async () => {
    const response = GET();
    const proof = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("location")).toBeNull();
    expect(proof).toMatch(/^v=MCPv1; k=ed25519; p=[A-Za-z0-9+/]{43}=\n$/);
    expect(Buffer.from(proof.split("p=")[1].trim(), "base64")).toHaveLength(32);
    expect(await HEAD().text()).toBe("");
    expect(HEAD().headers.get("cache-control")).toBe(
      response.headers.get("cache-control"),
    );
  });

  test.each([
    [evidence, MCP_SERVER_CARD],
    [docs, DOCS_MCP_SERVER_CARD],
  ])(
    "keeps registry documents and served cards on the same domain-bound identity",
    (entry, card) => {
      expect(entry.$schema).toBe(
        "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
      );
      expect(entry.name).toMatch(/^com\.symbaiex\.www\/[a-z]+$/);
      expect(entry.name).toBe(card.name);
      expect(entry.title).toBe(card.title);
      expect(entry.version).toBe(card.version);
      expect(entry.description).toBe(card.description);
      expect(entry.description.length).toBeLessThanOrEqual(100);
      expect(entry.remotes[0].url).toBe(card.remotes[0].url);
      expect(entry.remotes[0].type).toBe("streamable-http");
      expect(entry).not.toHaveProperty("packages");
      expect(entry).not.toHaveProperty("repository");
    },
  );
});
