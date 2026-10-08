import { describe, expect, test, vi } from "vitest";
import { ForumHostBridge, unwrapToolResult } from "./bridge";

function hostFixture() {
  const target = new EventTarget();
  const parent = { postMessage: vi.fn() };
  const win = Object.assign(target, {
    parent,
    document: {
      documentElement: { dataset: {}, classList: { toggle: vi.fn() } },
    },
  }) as unknown as Window;
  const bridge = new ForumHostBridge(win);
  const deliver = (data: unknown, source: unknown = parent) =>
    target.dispatchEvent(Object.assign(new Event("message"), { data, source }));
  return { target, parent, win, bridge, deliver };
}
const status = {
  status: "completed" as const,
  actingAs: { userId: "actor", username: "helper", isAgent: true },
  data: {
    connectionId: "connection",
    policyVersion: 1,
    capabilities: ["read", "attachments"],
  },
};
describe("native forum host boundary", () => {
  test("child reads wait for host initialization and launch identity", async () => {
    const f = hostFixture();
    const pending = f.bridge.tool("forum_overview", {});
    f.bridge.notify("ui/notifications/size-changed", { width: 400, height: 800 });
    await vi.waitFor(() => expect(f.parent.postMessage).toHaveBeenCalled());
    expect(f.parent.postMessage.mock.calls.map(([m]) => m.method)).toEqual(["ui/initialize"]);
    const initialize = f.parent.postMessage.mock.calls[0][0];
    f.deliver({ jsonrpc: "2.0", id: initialize.id, result: {
      protocolVersion: "2026-01-26", hostInfo: { name: "test", version: "1" },
      hostCapabilities: { serverTools: {} }, hostContext: { displayMode: "fullscreen" },
    } });
    await vi.waitFor(() => expect(f.parent.postMessage.mock.calls.some(([m]) => m.method === "ui/notifications/initialized")).toBe(true));
    expect(f.parent.postMessage.mock.calls.some(([m]) => m.method === "tools/call")).toBe(false);
    f.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [], structuredContent: status } });
    await vi.waitFor(() => expect(f.parent.postMessage.mock.calls.some(([m]) => m.method === "tools/call")).toBe(true));
    const request = f.parent.postMessage.mock.calls.find(([m]) => m.method === "tools/call")![0];
    f.deliver({ jsonrpc: "2.0", id: request.id, result: { content: [], structuredContent: { data: "current-profile" } } });
    await expect(pending).resolves.toEqual({ data: "current-profile" });
    f.bridge.destroy();
  });
  test("SDK handshake consumes the launch result and avoids a duplicate status read", async () => {
    const f = hostFixture();
    const connected = f.bridge.connect();
    await vi.waitFor(() => expect(f.parent.postMessage).toHaveBeenCalled());
    const initialize = f.parent.postMessage.mock.calls.find(([m]) => m.method === "ui/initialize")![0];
    f.deliver({ jsonrpc: "2.0", id: initialize.id, result: {
      protocolVersion: "2026-01-26", hostInfo: { name: "test", version: "1" },
      hostCapabilities: { serverTools: {} }, hostContext: { displayMode: "fullscreen" },
    } });
    await vi.waitFor(() => expect(f.parent.postMessage.mock.calls.some(([m]) => m.method === "ui/notifications/initialized")).toBe(true));
    f.deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [], structuredContent: status } });
    await connected;
    expect(f.bridge.status.connectionId).toBe("connection");
    expect(f.bridge.ready).toBe(true);
    expect(f.parent.postMessage.mock.calls.some(([m]) => m.method === "tools/call")).toBe(false);
    const pending = f.bridge.tool("forum_overview", {});
    await vi.waitFor(() => expect(f.parent.postMessage.mock.calls.some(([m]) => m.method === "tools/call")).toBe(true));
    const request = f.parent.postMessage.mock.calls.find(([m]) => m.method === "tools/call")![0];
    f.deliver({ jsonrpc: "2.0", method: "ping", id: request.id });
    await vi.waitFor(() => expect(f.parent.postMessage).toHaveBeenCalledWith({ jsonrpc: "2.0", id: request.id, result: {} }, "*"));
    // A foreign frame and a source-less foreign origin cannot resolve the call.
    f.deliver({ jsonrpc: "2.0", id: request.id, result: { content: [], structuredContent: { data: "foreign" } } }, {});
    f.target.dispatchEvent(Object.assign(new Event("message"), { source: null, origin: "https://foreign.example", data: { jsonrpc: "2.0", id: request.id, result: {} } }));
    f.target.dispatchEvent(Object.assign(new Event("message"), { source: null, origin: "", data: { jsonrpc: "2.0", id: request.id, result: { content: [], structuredContent: { data: "native" } } } }));
    await expect(pending).resolves.toEqual({ data: "native" });
    const closed = expect(f.bridge.tool("forum_overview", {})).rejects.toThrow();
    f.deliver({ jsonrpc: "2.0", method: "ui/resource-teardown", id: "host-close", params: {} });
    await vi.waitFor(() => expect(f.parent.postMessage).toHaveBeenCalledWith({ jsonrpc: "2.0", id: "host-close", result: {} }, "*"));
    await closed;
    await expect(f.bridge.tool("forum_overview", {})).rejects.toThrow("Reopen");
  });
  test("uses structured or text tool results and retains typed errors", () => {
    expect(unwrapToolResult({ structuredContent: status })).toEqual(status);
    expect(
      unwrapToolResult({
        content: [{ type: "text", text: JSON.stringify(status) }],
      }),
    ).toEqual(status);
    expect(() =>
      unwrapToolResult({
        isError: true,
        structuredContent: {
          code: "CONNECTION_REVOKED",
          error: "Disconnected",
        },
      }),
    ).toThrow("Disconnected");
  });
  test("retries reviewed uploads with the same receipt and refreshed ephemeral URLs", async () => {
    const fixture = hostFixture();
    fixture.bridge.destroy();
    let attempt = 0;
    const callTool = vi.fn(async (name: string, args: unknown) => {
      expect(name).toBe("forum_upload_attachments");
      expect(args).toBeTruthy();
      return {
        structuredContent:
          ++attempt === 1
            ? { status: "pending_approval", actingAs: status.actingAs }
            : {
                status: "completed",
                actingAs: status.actingAs,
                data: {
                  attachments: [{ storageId: "owned", filename: "image.png" }],
                },
              },
      };
    });
    const uploadFile = vi.fn(async () => ({ fileId: "host-file" }));
    const getFileDownloadUrl = vi.fn(async () => ({
      downloadUrl: `https://temporary.example/${attempt}`,
    }));
    Object.assign(fixture.win, {
      openai: { callTool, uploadFile, getFileDownloadUrl },
    });
    const bridge = new ForumHostBridge(fixture.win);
    bridge.acceptStatus(status);
    const file = new File(["png"], "image.png", { type: "image/png" });
    await expect(bridge.uploadFiles([file])).rejects.toThrow("owner approval");
    await expect(bridge.uploadFiles([file])).resolves.toEqual([
      { storageId: "owned", filename: "image.png" },
    ]);
    const first = callTool.mock.calls[0][1] as {
      idempotencyKey: string;
      files: unknown[];
    };
    const second = callTool.mock.calls[1][1] as typeof first;
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(first.files).toEqual([
      {
        file_id: "host-file",
        file_name: "image.png",
        mime_type: "image/png",
        download_url: "https://temporary.example/0",
      },
    ]);
    expect(second.files).toEqual([
      {
        file_id: "host-file",
        file_name: "image.png",
        mime_type: "image/png",
        download_url: "https://temporary.example/1",
      },
    ]);
    bridge.destroy();
  });
  test("blocks a held upload after an identity or policy change", async () => {
    const fixture = hostFixture();
    fixture.bridge.destroy();
    const callTool = vi.fn(async () => ({
      structuredContent: {
        status: "pending_approval",
        actingAs: status.actingAs,
      },
    }));
    Object.assign(fixture.win, {
      openai: {
        callTool,
        uploadFile: async () => ({ fileId: "file" }),
        getFileDownloadUrl: async () => ({
          downloadUrl: "https://temporary.example/file",
        }),
      },
    });
    const bridge = new ForumHostBridge(fixture.win);
    bridge.acceptStatus(status);
    const file = new File(["x"], "a.txt");
    await expect(bridge.uploadFiles([file])).rejects.toThrow("owner approval");
    bridge.acceptStatus({
      ...status,
      data: { ...status.data, policyVersion: 2 },
    });
    await expect(bridge.uploadFiles([file])).rejects.toThrow("acting profile");
    expect(callTool).toHaveBeenCalledTimes(1);
    bridge.destroy();
  });
  test("does not reuse a reviewed upload for different contents with identical file metadata", async () => {
    const fixture = hostFixture();
    fixture.bridge.destroy();
    const callTool = vi.fn(async () => ({
      structuredContent: {
        status: "pending_approval",
        actingAs: status.actingAs,
      },
    }));
    const uploadFile = vi.fn(async () => ({
      fileId: `file-${uploadFile.mock.calls.length}`,
    }));
    Object.assign(fixture.win, {
      openai: {
        callTool,
        uploadFile,
        getFileDownloadUrl: async () => ({
          downloadUrl: "https://temporary.example/file",
        }),
      },
    });
    const bridge = new ForumHostBridge(fixture.win);
    bridge.acceptStatus(status);
    for (const contents of ["a", "b"])
      await expect(
        bridge.uploadFiles([
          new File([contents], "a.txt", { lastModified: 1 }),
        ]),
      ).rejects.toThrow("owner approval");
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect((callTool.mock.calls[0] as unknown[])[1]).not.toEqual(
      (callTool.mock.calls[1] as unknown[])[1],
    );
    bridge.destroy();
  });
});
