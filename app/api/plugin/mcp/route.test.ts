import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
vi.mock("@/lib/forum-plugin-app", () => ({
  FORUM_PLUGIN_APP_RESOURCE: {
    uri: "ui://symbaiex/forum.html",
    name: "symbaiex-forum",
    mimeType: "text/html;profile=mcp-app",
  },
  FORUM_PLUGIN_APP_HTML: "<!doctype html><title>Forum</title>",
}));
vi.mock("@/lib/forum-plugin-files", () => ({
  importForumPluginAttachments: vi.fn(async () =>
    Response.json({ data: { attachments: [] } }),
  ),
}));
import { GET, POST } from "./route";
import { FORUM_PLUGIN_RESOURCE } from "@/lib/forum-plugin-contract";
import { importForumPluginAttachments } from "@/lib/forum-plugin-files";
function request(
  method: string,
  params?: unknown,
  authorization?: string,
  extraHeaders?: Record<string, string>,
) {
  return new Request(FORUM_PLUGIN_RESOURCE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });
}
function token(aud = FORUM_PLUGIN_RESOURCE) {
  return `Bearer ${btoa("{}")}.${btoa(JSON.stringify({ aud }))}.signature`;
}
beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", "https://backend.convex.site");
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://identity.symbaiex.com");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ status: "completed", actingAs: null, data: [] }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("forum MCP protocol boundary", () => {
  test("supports public initialization, typed tools and the in-ChatGPT resource", async () => {
    const initialized = await POST(
      request("initialize", { protocolVersion: "2025-06-18" }),
    );
    expect(await initialized.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { title: "SYMBaiEX Forum" },
        instructions: expect.stringContaining(
          "completed means the command ran",
        ),
      },
    });
    const discovered = await POST(request("tools/list"));
    const tools = (await discovered.json()).result.tools;
    expect(tools.length).toBeGreaterThan(80);
    expect(
      tools.find((tool: { name: string }) => tool.name === "forum_open"),
    ).toMatchObject({ title: "SYMBaiEX Forum" });
    expect(
      tools.find((tool: { name: string }) => tool.name === "forum_open")._meta
        .ui.resourceUri,
    ).toBe("ui://symbaiex/forum.html");
    const resource = await POST(
      request("resources/read", { uri: "ui://symbaiex/forum.html" }),
    );
    expect((await resource.json()).result.contents[0].text).toContain(
      "<!doctype html>",
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  test("returns public content anonymously but rejects private tools and evidence tokens", async () => {
    const publicRead = await POST(
      request("tools/call", { name: "forum_list_categories", arguments: {} }),
    );
    expect(await publicRead.json()).toMatchObject({
      result: { structuredContent: { status: "completed", data: [] } },
    });
    const privateRead = await POST(
      request("tools/call", {
        name: "forum_list_private_messages",
        arguments: {},
      }),
    );
    expect(privateRead.status).toBe(401);
    expect(privateRead.headers.get("www-authenticate")).toContain(
      "/oauth-protected-resource/api/plugin/mcp",
    );
    vi.mocked(fetch).mockClear();
    const crossResource = await POST(
      request(
        "tools/call",
        { name: "forum_list_categories", arguments: {} },
        token("https://www.symbaiex.com/api/agent/mcp"),
      ),
    );
    expect(crossResource.status).toBe(401);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  test("rejects malformed argument objects and unknown actor fields before executing", async () => {
    for (const args of [
      [],
      null,
      "invalid",
      { title: "missing fields" },
      {
        categorySlug: "general",
        title: "Title",
        body: "Body",
        idempotencyKey: "command-123",
        expectedPolicyVersion: 1,
        actorUserId: "forged",
      },
    ]) {
      const response = await POST(
        request(
          "tools/call",
          { name: "forum_create_thread", arguments: args },
          token(),
        ),
      );
      expect(await response.json()).toMatchObject({ error: { code: -32602 } });
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  test("rejects a missing or invalid policy snapshot before any remote mutation", async () => {
    const args = {
      categorySlug: "general",
      title: "Title",
      body: "Body",
      idempotencyKey: "command-1234",
    };
    for (const input of [
      args,
      { ...args, expectedPolicyVersion: 0 },
      { ...args, expectedPolicyVersion: 1.5 },
    ]) {
      const result = await POST(
        request(
          "tools/call",
          { name: "forum_create_thread", arguments: input },
          token(),
        ),
      );
      expect(await result.json()).toMatchObject({ error: { code: -32602 } });
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  test("forwards write retry keys atomically and preserves pending review results", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        status: "pending_approval",
        commandId: "proposal-1",
        approvalUrl:
          "https://forum.symbaiex.com/control-panel/agent-access?commandId=proposal-1#review-queue",
      }),
    );
    const response = await POST(
      request(
        "tools/call",
        {
          name: "forum_create_thread",
          arguments: {
            categorySlug: "general",
            title: "Title",
            body: "Body",
            idempotencyKey: "command-123",
            expectedPolicyVersion: 1,
          },
        },
        token(),
      ),
    );
    expect(await response.json()).toMatchObject({
      result: {
        content: expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining(
              "This action has not run and no content has been published",
            ),
          }),
          expect.objectContaining({
            text: expect.stringContaining("commandId=proposal-1#review-queue"),
          }),
        ]),
        structuredContent: {
          status: "pending_approval",
          commandId: "proposal-1",
        },
      },
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          operation: "createThread",
          args: { categorySlug: "general", title: "Title", body: "Body" },
          idempotencyKey: "command-123",
          expectedPolicyVersion: 1,
        }),
      }),
    );
  });
  test.each([
    { status: "completed", data: { threadId: "thread-1", status: "pending" } },
    {
      status: "completed",
      publicationStatus: "pending_moderation",
      pendingContentUrl:
        "https://forum.symbaiex.com/control-panel/agent-access#moderation-queue",
      data: { threadId: "thread-1", status: "pending" },
    },
  ])(
    "reports moderated content as unpublished, including old retry receipts",
    async (receipt) => {
      vi.mocked(fetch).mockResolvedValue(Response.json(receipt));
      const response = await POST(
        request(
          "tools/call",
          {
            name: "forum_create_thread",
            arguments: {
              categorySlug: "general",
              title: "Title",
              body: "Body",
              idempotencyKey: "command-123",
              expectedPolicyVersion: 1,
            },
          },
          token(),
        ),
      );
      const body = await response.json();
      expect(body.result.structuredContent).toEqual(receipt);
      expect(body.result.content[0].text).toContain("not published yet");
      expect(body.result.content[0].text).toContain("#moderation-queue");
      expect(body.result.content[0].text).toContain("forum moderator");
      expect(JSON.parse(body.result.content[1].text)).toEqual(receipt);
    },
  );
  test("preserves authoritative successful publication in both model and structured output", async () => {
    const receipt = {
      status: "completed",
      publicationStatus: "published",
      message: "Published to the forum.",
      data: { threadId: "thread-1", status: "active" },
    };
    vi.mocked(fetch).mockResolvedValue(Response.json(receipt));
    const response = await POST(
      request(
        "tools/call",
        {
          name: "forum_create_thread",
          arguments: {
            categorySlug: "general",
            title: "Title",
            body: "Body",
            idempotencyKey: "command-123",
            expectedPolicyVersion: 1,
          },
        },
        token(),
      ),
    );
    const body = await response.json();
    expect(body.result.structuredContent).toEqual(receipt);
    expect(body.result.content[0].text).toBe("Published to the forum.");
    expect(JSON.parse(body.result.content[1].text)).toEqual(receipt);
  });
  test("returns safe tool failures and actionable HTTP auth challenges", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ error: "Not found" }, { status: 404 }),
    );
    const failed = await POST(
      request("tools/call", { name: "forum_list_categories", arguments: {} }),
    );
    expect(await failed.json()).toMatchObject({
      result: { isError: true, structuredContent: { error: "Not found" } },
    });
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ error: "Token revoked" }, { status: 401 }),
    );
    const revoked = await POST(
      request("tools/call", { name: "forum_status", arguments: {} }, token()),
    );
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
  });
  test("validates modern transport headers and preserves JSON-RPC response correlation", async () => {
    const meta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    const response = await POST(
      request("server/discover", { _meta: meta }, undefined, {
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "server/discover",
      }),
    );
    expect(response.headers.get("mcp-protocol-version")).toBe("2026-07-28");
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        resultType: "complete",
        supportedVersions: ["2026-07-28"],
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "symbaiex-forum",
            version: "1.6.0",
          },
        },
      },
    });
    const mismatch = await POST(
      request("tools/list", { _meta: meta }, undefined, {
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
      }),
    );
    expect(await mismatch.json()).toMatchObject({ error: { code: -32020 } });
  });
  test("protects against disallowed origins, malformed JSON and oversized requests", async () => {
    expect(
      (
        await POST(
          request(
            "tools/call",
            { name: "forum_list_categories", arguments: {} },
            undefined,
            { origin: "https://evil.example" },
          ),
        )
      ).status,
    ).toBe(403);
    const malformed = await POST(
      new Request(FORUM_PLUGIN_RESOURCE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(await malformed.json()).toMatchObject({ error: { code: -32700 } });
    const oversized = await POST(
      request("tools/list", {}, undefined, { "content-length": "999999" }),
    );
    expect(oversized.status).toBe(413);
    expect(GET(new Request(FORUM_PLUGIN_RESOURCE)).status).toBe(405);
  });
  test("uploads file parameters only after forum audience isolation", async () => {
    const args = {
      files: [
        { download_url: "https://download.example/file", file_id: "file-1" },
      ],
      idempotencyKey: "upload-1234",
      expectedPolicyVersion: 1,
    };
    const result = await POST(
      request(
        "tools/call",
        { name: "forum_upload_attachments", arguments: args },
        token(),
      ),
    );
    expect(
      (await result.json()).result.structuredContent.data.attachments,
    ).toEqual([]);
    expect(importForumPluginAttachments).toHaveBeenCalledWith(
      expect.any(Request),
      args.files,
      "upload-1234",
      1,
    );
    vi.mocked(importForumPluginAttachments).mockClear();
    expect(
      (
        await POST(
          request(
            "tools/call",
            { name: "forum_upload_attachments", arguments: args },
            token("wrong"),
          ),
        )
      ).status,
    ).toBe(401);
    expect(importForumPluginAttachments).not.toHaveBeenCalled();
  });
});
