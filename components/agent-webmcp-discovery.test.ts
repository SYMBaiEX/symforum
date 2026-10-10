import { afterEach, describe, expect, test, vi } from "vitest";

import {
  SYMBAIEX_WEBMCP_DISCOVERY_TOOL,
  SYMBAIEX_WEBMCP_DOCS_SEARCH_TOOL as search,
  SYMBAIEX_WEBMCP_DOCS_READ_TOOL as read,
  SYMBAIEX_WEBMCP_TOOLS,
  resolveWebMcpModelContext,
  registerSymbaiexBrowserTools,
} from "./agent-webmcp-discovery";

describe("SYMBaiEX WebMCP discovery tool", () => {
  afterEach(() => vi.unstubAllGlobals());
  test("is a read-only, no-input discovery operation", async () => {
    const controller = new AbortController();
    const result = await SYMBAIEX_WEBMCP_DISCOVERY_TOOL.execute(
      {},
      { signal: controller.signal },
    );

    expect(SYMBAIEX_WEBMCP_DISCOVERY_TOOL.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: false,
    });
    expect(SYMBAIEX_WEBMCP_DISCOVERY_TOOL.inputSchema).toMatchObject({
      additionalProperties: false,
      properties: {},
    });
    expect(result).toMatchObject({
      apiManifest: "https://www.symbaiex.com/api/agent",
      humanSetup: "https://www.symbaiex.com/agent/signup",
    });
    expect(JSON.stringify(result)).not.toMatch(/token|privateKey|password/i);
  });

  test("honors an already-aborted execution", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(
      SYMBAIEX_WEBMCP_DISCOVERY_TOOL.execute({}, { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });

  test("supports native preview hosts that omit execution options or the signal", async () => {
    const uri = "https://www.symbaiex.com/auth.md";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply({ results: [{ uri }] }))
      .mockResolvedValueOnce(
        reply({ resource: { uri, text: "# Authentication" } }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      SYMBAIEX_WEBMCP_DISCOVERY_TOOL.execute({}),
    ).resolves.toMatchObject({ service: "SYMBaiEX" });
    await expect(search.execute({ query: "OAuth" })).resolves.toMatchObject({
      results: [{ uri }],
    });
    await expect(read.execute({ uri }, {})).resolves.toMatchObject({
      resource: { uri },
    });
    for (const [, options] of fetcher.mock.calls) {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.signal.aborted).toBe(false);
    }
  });

  test("searches and reads real public MCP documentation without credentials", async () => {
    const uri = "https://www.symbaiex.com/auth.md";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply({
          results: [
            {
              uri,
              name: "SYMBaiEX authentication",
              description: "Authentication guide",
              score: 2,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        reply({
          resource: {
            uri,
            text: "# Authentication\n\nUse PKCE and owner approval.",
          },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    const result = await search.execute(
      { query: "OAuth PKCE", limit: 2 },
      { signal },
    );
    expect(result.results).toHaveLength(1);
    expect((await read.execute({ uri }, { signal })).resource).toMatchObject({
      uri,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe("https://www.symbaiex.com/api/docs/mcp");
      expect(options).toMatchObject({
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      expect(options.headers).not.toHaveProperty("Authorization");
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      method: "tools/call",
      params: {
        name: "docs_search",
        arguments: { query: "OAuth PKCE", limit: 2 },
      },
    });
  });

  test("validates inputs before networking and honors cancellation for every tool", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    for (const input of [
      { query: "" },
      { query: "x".repeat(201) },
      { query: "docs", limit: 5 },
      { query: "docs", token: "forbidden" },
    ])
      await expect(search.execute(input, { signal })).rejects.toThrow();
    for (const uri of [
      "https://evil.example/auth.md",
      "file:///etc/passwd",
      "https://www.symbaiex.com/" + "x".repeat(300),
    ])
      await expect(read.execute({ uri }, { signal })).rejects.toThrow();
    await expect(
      SYMBAIEX_WEBMCP_DISCOVERY_TOOL.execute({ unexpected: true }, { signal }),
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    for (const tool of SYMBAIEX_WEBMCP_TOOLS)
      await expect(
        tool.execute({}, { signal: controller.signal }),
      ).rejects.toThrow("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("rejects HTTP, protocol, malformed and oversized responses", async () => {
    const responses = [
      new Response("unavailable", { status: 503 }),
      Response.json({
        jsonrpc: "2.0",
        id: "browser-docs",
        error: { code: -32602 },
      }),
      reply({ results: null }),
      new Response("x".repeat(65537), {
        headers: { "content-type": "application/json" },
      }),
      Response.json({
        jsonrpc: "2.0",
        id: "wrong",
        result: { structuredContent: {} },
      }),
    ];
    for (const response of responses) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(
        search.execute(
          { query: "docs" },
          { signal: new AbortController().signal },
        ),
      ).rejects.toThrow();
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        reply({
          resource: { uri: "https://evil.example/auth.md", text: "wrong" },
        }),
      ),
    );
    await expect(
      read.execute(
        { uri: "https://www.symbaiex.com/auth.md" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow();
  });

  test("registers all three tools and passes the lifetime signal without breaking unsupported browsers", async () => {
    const controller = new AbortController();
    const registerTool = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("unsupported");
      })
      .mockImplementationOnce(() => undefined)
      .mockRejectedValueOnce(new Error("denied"));
    expect(() =>
      registerSymbaiexBrowserTools({ registerTool }, controller.signal),
    ).not.toThrow();
    expect(registerTool).toHaveBeenCalledTimes(3);
    for (const [, options] of registerTool.mock.calls)
      expect(options.signal).toBe(controller.signal);
    controller.abort();
    registerSymbaiexBrowserTools({ registerTool }, controller.signal);
    expect(registerTool).toHaveBeenCalledTimes(3);
    await Promise.resolve();
  });

  test("prefers document.modelContext and uses navigator.modelContext only as fallback", () => {
    const documentContext = { registerTool: vi.fn() };
    const navigatorContext = { registerTool: vi.fn() };

    expect(resolveWebMcpModelContext(documentContext, navigatorContext)).toBe(
      documentContext,
    );
    expect(resolveWebMcpModelContext({}, navigatorContext)).toBe(
      navigatorContext,
    );
    expect(resolveWebMcpModelContext({}, {})).toBeNull();
  });
});

function reply(structuredContent: Record<string, unknown>) {
  return Response.json({
    jsonrpc: "2.0",
    id: "browser-docs",
    result: { structuredContent },
  });
}
