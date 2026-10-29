import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  preflight: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("./forum-plugin-relay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./forum-plugin-relay")>()),
  relayForumPlugin: mocks.preflight,
}));
import {
  downloadForumPluginFile,
  importForumPluginAttachments,
  isPublicForumFileAddress,
  type ForumPluginFile,
} from "./forum-plugin-files";
import { FORUM_PLUGIN_RESOURCE } from "./forum-plugin-contract";

function authorized(aud = FORUM_PLUGIN_RESOURCE) {
  return new Request(FORUM_PLUGIN_RESOURCE, {
    headers: {
      authorization: `Bearer ${btoa("{}")}.${btoa(JSON.stringify({ aud }))}.signature`,
    },
  });
}
const file = (overrides: Partial<ForumPluginFile> = {}): ForumPluginFile => ({
  download_url: "https://files.example/image.png",
  file_id: "file-1",
  file_name: "image.png",
  ...overrides,
});
function downloadResponse(
  options: {
    status?: number;
    headers?: Record<string, string>;
    bytes?: Uint8Array;
    error?: boolean;
  } = {},
) {
  mocks.request.mockImplementationOnce(
    (
      _url: URL,
      requestOptions: unknown,
      onResponse: (response: EventEmitter) => void,
    ) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => {
        queueMicrotask(() => {
          const response = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string>;
            resume: () => void;
            destroy: () => void;
          };
          response.statusCode = options.status ?? 200;
          response.headers = {
            "content-type": "image/png",
            ...options.headers,
          };
          response.resume = vi.fn();
          response.destroy = vi.fn();
          onResponse(response);
          if (options.error) response.emit("error", new Error("failed"));
          else {
            response.emit("data", options.bytes ?? new Uint8Array([1, 2, 3]));
            response.emit("end");
          }
        });
      };
      return req;
    },
  );
}
beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", "https://backend.convex.site");
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://identity.symbaiex.com");
  mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mocks.preflight.mockImplementation(async () =>
    Response.json({
      status: "completed",
      actingAs: { username: "owner" },
      data: { capabilities: ["attachments"], policyVersion: 1 },
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        status: "completed",
        actingAs: { username: "owner" },
        data: { storageId: "storage-1", filename: "image.png" },
      }),
    ),
  );
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("forum attachment URL and DNS boundary", () => {
  test("rejects private, mapped, documentation, loopback and multicast addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.0.1",
      "192.168.0.1",
      "100.64.0.1",
      "198.18.0.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
      "invalid",
    ])
      expect(isPublicForumFileAddress(address), address).toBe(false);
    for (const address of [
      "8.8.8.8",
      "1.1.1.1",
      "172.15.0.1",
      "172.32.0.1",
      "2606:4700:4700::1111",
      "2001:4860:4860::8888",
    ])
      expect(isPublicForumFileAddress(address), address).toBe(true);
  });
  test("rejects unsafe URL forms before resolving or fetching", async () => {
    for (const url of [
      "http://files.example/file",
      "https://user:secret@files.example/file",
      "https://files.example:8443/file",
      "https://files.example/file#fragment",
      "file:///etc/passwd",
      "invalid",
    ])
      await expect(downloadForumPluginFile(url)).rejects.toMatchObject({
        status: 400,
      });
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  test("rejects a mixed public/private DNS answer and pins a valid address to TLS", async () => {
    mocks.lookup.mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      downloadForumPluginFile(file().download_url),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.request).not.toHaveBeenCalled();
    downloadResponse();
    await expect(
      downloadForumPluginFile(file().download_url),
    ).resolves.toMatchObject({ contentType: "image/png" });
    const opts = mocks.request.mock.calls[0][1];
    const callback = vi.fn();
    for (const options of [{}, { all: false }]) {
      callback.mockClear();
      opts.lookup("files.example", options, callback);
      expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    }
  });
  test.each([
    [{ address: "8.8.8.8", family: 4 }],
    [{ address: "2606:4700:4700::1111", family: 6 }],
    [
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ],
  ])(
    "returns an address array for Node family selection while retaining the DNS pin: %j",
    async (...answers) => {
      mocks.lookup.mockResolvedValueOnce(answers);
      downloadResponse();
      await expect(
        downloadForumPluginFile(file().download_url),
      ).resolves.toMatchObject({ contentType: "image/png" });
      const callback = vi.fn();
      mocks.request.mock.calls[0][1].lookup(
        "files.example",
        { all: true },
        callback,
      );
      expect(callback).toHaveBeenCalledWith(null, [answers[0]]);
      expect(mocks.lookup).toHaveBeenCalledTimes(1);
      expect(mocks.request.mock.calls[0][0].hostname).toBe("files.example");
    },
  );
  test("checks every redirect destination and bounds redirect depth", async () => {
    downloadResponse({
      status: 302,
      headers: { location: "https://localhost/metadata" },
    });
    mocks.lookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      downloadForumPluginFile(file().download_url),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    downloadResponse({
      status: 302,
      headers: { location: "http://files.example/unsafe" },
    });
    await expect(
      downloadForumPluginFile(file().download_url),
    ).rejects.toMatchObject({ status: 400 });
    downloadResponse({ status: 302, headers: { location: "/again" } });
    await expect(
      downloadForumPluginFile(file().download_url, 3),
    ).rejects.toMatchObject({ status: 400 });
  });
  test("malformed redirect locations fail through the download error contract", async () => {
    downloadResponse({ status: 302, headers: { location: "http://[" } });
    await expect(
      downloadForumPluginFile(file().download_url),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  test("enforces the 5 MiB byte limit for declared and streaming sizes", async () => {
    downloadResponse({
      headers: { "content-length": String(5 * 1024 * 1024 + 1) },
    });
    await expect(
      downloadForumPluginFile(file().download_url),
    ).rejects.toMatchObject({ status: 413 });
    downloadResponse({ bytes: new Uint8Array(5 * 1024 * 1024 + 1) });
    await expect(
      downloadForumPluginFile(file().download_url),
    ).rejects.toMatchObject({ status: 413 });
    downloadResponse({ bytes: new Uint8Array() });
    await expect(
      downloadForumPluginFile(file().download_url),
    ).rejects.toMatchObject({ status: 400 });
    downloadResponse({ error: true });
    await expect(
      downloadForumPluginFile(file().download_url),
    ).rejects.toMatchObject({ status: 400 });
  });
});
describe("ChatGPT file parameter import", () => {
  test("requires a forum bearer and one to five files before network activity", async () => {
    for (const request of [
      new Request(FORUM_PLUGIN_RESOURCE),
      authorized("https://www.symbaiex.com/api/agent/mcp"),
    ])
      expect(
        (await importForumPluginAttachments(request, [file()], "upload-key", 1))
          .status,
      ).toBe(401);
    for (const files of [[], Array.from({ length: 6 }, () => file())])
      expect(
        (
          await importForumPluginAttachments(
            authorized(),
            files,
            "upload-key",
            1,
          )
        ).status,
      ).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  test("rechecks authorization and attachment capability before downloading any bytes", async () => {
    mocks.preflight.mockResolvedValueOnce(
      Response.json({ error: "Revoked" }, { status: 401 }),
    );
    expect(
      (
        await importForumPluginAttachments(
          authorized(),
          [file()],
          "upload-key",
          1,
        )
      ).status,
    ).toBe(401);
    mocks.preflight.mockResolvedValueOnce(
      Response.json({ status: "completed", data: { capabilities: ["read"] } }),
    );
    expect(
      (
        await importForumPluginAttachments(
          authorized(),
          [file()],
          "upload-key",
          1,
        )
      ).status,
    ).toBe(403);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
  test("malformed preflight responses fail before downloading files", async () => {
    mocks.preflight.mockResolvedValueOnce(
      new Response("not-json", { status: 200 }),
    );
    const result = await importForumPluginAttachments(
      authorized(),
      [file()],
      "upload-key",
      1,
    );
    expect(result.status).toBe(502);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  test("uploads pinned bytes with actor authorization and stable per-file command keys", async () => {
    downloadResponse();
    downloadResponse();
    const result = await importForumPluginAttachments(
      authorized(),
      [file(), file({ file_id: "file-2" })],
      "upload-key",
      1,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      status: "completed",
      data: {
        attachments: [{ storageId: "storage-1" }, { storageId: "storage-1" }],
        proposals: [],
      },
    });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(
          ([, opts]) =>
            (opts?.headers as Record<string, string>)["Idempotency-Key"],
        ),
    ).toEqual(["upload-key:0", "upload-key:1"]);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      redirect: "error",
      headers: {
        "Content-Type": "image/png",
        "X-Forum-Attachment-Filename": "image.png",
        "X-Forum-Plugin-Policy-Version": "1",
      },
    });
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain(
      "download_url",
    );
  });
  test("rejects unsupported types and propagates upstream auth failure", async () => {
    downloadResponse({
      headers: { "content-type": "application/x-executable" },
    });
    const invalid = await importForumPluginAttachments(
      authorized(),
      [
        file({
          file_name: "program.exe",
          mime_type: "application/x-executable",
        }),
      ],
      "upload-key",
      1,
    );
    expect(invalid.status).toBe(415);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    downloadResponse();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: "Permission removed" }, { status: 403 }),
    );
    expect(
      (
        await importForumPluginAttachments(
          authorized(),
          [file()],
          "upload-key",
          1,
        )
      ).status,
    ).toBe(403);
  });
  test("returns immutable review proposals rather than attachment references until approval", async () => {
    downloadResponse();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        status: "pending_approval",
        actingAs: { username: "owner" },
        commandId: "command-1",
        approvalUrl: "https://forum.symbaiex.com/control-panel/agent-access",
        expiresAt: 1234,
      }),
    );
    const result = await importForumPluginAttachments(
      authorized(),
      [file()],
      "upload-key",
      1,
    );
    expect(await result.json()).toMatchObject({
      status: "pending_approval",
      data: {
        attachments: [],
        proposals: [{ commandId: "command-1", expiresAt: 1234 }],
      },
    });
  });
});
