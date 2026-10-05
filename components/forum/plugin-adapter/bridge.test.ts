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
  test("accepts native webview replies with no source/origin while rejecting foreign delivery", async () => {
    const { target, bridge, parent, win } = hostFixture();
    for (const source of [null, win]) {
      const pending = bridge.request("ui/initialize");
      const id = parent.postMessage.mock.calls.at(-1)![0].id;
      target.dispatchEvent(Object.assign(new Event("message"), { data: { jsonrpc: "2.0", id, result: "foreign" }, source: null, origin: "https://foreign.example" }));
      target.dispatchEvent(Object.assign(new Event("message"), { data: { jsonrpc: "2.0", id, result: "native" }, source, origin: "" }));
      await expect(pending).resolves.toBe("native");
    }
    bridge.destroy();
  });
  test("answers host health checks without consuming a colliding app request ID", async () => {
    const { bridge, parent, deliver } = hostFixture();
    const pending = bridge.request("ui/initialize");
    const request = parent.postMessage.mock.calls[0][0];
    deliver({ jsonrpc: "2.0", method: "ping", id: request.id });
    expect(parent.postMessage).toHaveBeenLastCalledWith({ jsonrpc: "2.0", id: request.id, result: {} }, "*");
    deliver({ jsonrpc: "2.0", id: request.id, result: { hostContext: { theme: "dark" } } });
    await expect(pending).resolves.toEqual({ hostContext: { theme: "dark" } });
    deliver({ jsonrpc: "2.0", method: "ping", id: "host-health" });
    expect(parent.postMessage).toHaveBeenLastCalledWith({ jsonrpc: "2.0", id: "host-health", result: {} }, "*");
    bridge.destroy();
  });
  test("acknowledges teardown even when its ID matches an outstanding app request", async () => {
    const { bridge, parent, deliver } = hostFixture();
    const pending = bridge.request("tools/call");
    const id = parent.postMessage.mock.calls[0][0].id;
    deliver({ jsonrpc: "2.0", method: "ui/resource-teardown", id });
    expect(parent.postMessage).toHaveBeenLastCalledWith({ jsonrpc: "2.0", id, result: {} }, "*");
    await expect(pending).rejects.toThrow("Forum closed");
  });
  test("ignores responses from other frames and cleans up outstanding requests", async () => {
    const { bridge, parent, deliver } = hostFixture();
    const response = bridge.request("tools/call", { name: "forum_overview" });
    const request = parent.postMessage.mock.calls[0][0];
    deliver({ jsonrpc: "2.0", id: request.id, result: "untrusted" }, {});
    deliver({ jsonrpc: "2.0", id: request.id, result: "correct" });
    await expect(response).resolves.toBe("correct");
    const closed = bridge.request("tools/call");
    bridge.destroy();
    await expect(closed).rejects.toThrow("Forum closed");
    await expect(bridge.request("tools/call")).rejects.toThrow("Reopen");
  });
  test("acknowledges resource teardown as a request and rejects pending work", async () => {
    const { bridge, parent, deliver } = hostFixture();
    const waiting = bridge.request("tools/call");
    deliver({ jsonrpc: "2.0", method: "ui/resource-teardown", id: 70 });
    expect(parent.postMessage).toHaveBeenCalledWith(
      { jsonrpc: "2.0", id: 70, result: {} },
      "*",
    );
    await expect(waiting).rejects.toThrow("Forum closed");
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
