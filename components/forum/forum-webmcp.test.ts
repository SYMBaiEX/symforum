// @vitest-environment node
import { expect, test, vi } from "vitest";
import {
  createForumBrowserTools,
  registerForumBrowserTools,
  selectedForumAgentFiles,
  uploadSelectedForumAgentFiles,
} from "./forum-webmcp";
import type { ForumBrowserContext } from "./forum-plugin-refs";
import { FORUM_PLUGIN_OPERATIONS } from "@/lib/forum-plugin-catalog";
import { FORUM_PLUGIN_CAPABILITIES } from "@/lib/forum-plugin-contract";

const context: ForumBrowserContext = {
  connectionId: "browser-connection",
  actorMode: "agent",
  actingAs: { userId: "agent-user", username: "SYM-AGENT", isAgent: true },
  capabilities: ["read", "participate", "attachments"],
  capabilityCeiling: ["read", "participate", "attachments"],
  executionMode: "review",
  policyVersion: 2,
};
const completed = { status: "completed" as const, actingAs: context.actingAs };

test("anonymous tools expose only public reads and never privileged or upload tools", () => {
  const tools = createForumBrowserTools(
    null,
    new AbortController().signal,
    vi.fn(),
  );
  expect(tools.find((tool) => tool.name === "forum_open")).toBeDefined();
  expect(
    tools.find((tool) => tool.name === "forum_create_reply"),
  ).toBeUndefined();
  expect(tools.find((tool) => tool.name === "forum_status")).toBeUndefined();
  expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
});

test("native WebMCP maps destructive operations to consequentialHint", () => {
  const tools = createForumBrowserTools(
    { ...context, capabilities: [...FORUM_PLUGIN_CAPABILITIES] },
    new AbortController().signal,
    vi.fn(),
    vi.fn(),
  );
  for (const tool of tools) {
    const operation = FORUM_PLUGIN_OPERATIONS.find(
      (entry) => entry.name === tool.name,
    );
    expect(tool.annotations.consequentialHint).toBe(
      operation?.destructive ?? false,
    );
    expect(tool.annotations).not.toHaveProperty("destructiveHint");
  }
  expect(
    tools.find((tool) => tool.name === "forum_delete_thread")?.annotations
      .consequentialHint,
  ).toBe(true);
  expect(
    tools.find((tool) => tool.name === "forum_get_thread")?.annotations
      .consequentialHint,
  ).toBe(false);
  expect(
    tools.find((tool) => tool.name === "forum_upload_selected_attachments")
      ?.annotations.consequentialHint,
  ).toBe(false);
});

test("registered writes use exact selected connection and stable command key", async () => {
  const execute = vi.fn().mockResolvedValue(completed);
  const tools = createForumBrowserTools(
    context,
    new AbortController().signal,
    execute,
  );
  const reply = tools.find((tool) => tool.name === "forum_create_reply")!;
  expect(reply).toBeDefined();
  expect(tools.some((tool) => tool.name === "forum_send_private_message")).toBe(
    false,
  );
  expect(tools.some((tool) => tool.name === "forum_admin_overview")).toBe(
    false,
  );
  await reply.execute({
    threadId: "thread-123",
    body: "Hello forum",
    idempotencyKey: "stable-command-123",
  });
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({
      connectionId: context.connectionId,
      expectedPolicyVersion: context.policyVersion,
      operation: "createReply",
      args: { threadId: "thread-123", body: "Hello forum" },
      idempotencyKey: "stable-command-123",
      readOnly: false,
    }),
  );
});

test("policy/session/navigation abort prevents stale actor execution", async () => {
  const controller = new AbortController();
  const execute = vi.fn();
  const reply = createForumBrowserTools(
    context,
    controller.signal,
    execute,
  ).find((tool) => tool.name === "forum_create_reply")!;
  controller.abort(new Error("Connection changed"));
  await expect(
    reply.execute({
      threadId: "thread-123",
      body: "Stale",
      idempotencyKey: "stable-command-123",
    }),
  ).rejects.toThrow("Connection changed");
  expect(execute).not.toHaveBeenCalled();
});

test("invocation cancellation and invalid arguments do not send a mutation", async () => {
  const execute = vi.fn();
  const reply = createForumBrowserTools(
    context,
    new AbortController().signal,
    execute,
  ).find((tool) => tool.name === "forum_create_reply")!;
  await expect(
    reply.execute({ threadId: "thread-123", body: "Missing key" }),
  ).rejects.toThrow("idempotencyKey");
  const invocation = new AbortController();
  invocation.abort(new Error("Cancelled"));
  await expect(
    reply.execute(
      {
        threadId: "thread-123",
        body: "Hello",
        idempotencyKey: "stable-command-123",
      },
      { signal: invocation.signal },
    ),
  ).rejects.toThrow("Cancelled");
  expect(execute).not.toHaveBeenCalled();
});

test("a stale in-flight result is rejected when the connection changes", async () => {
  const controller = new AbortController();
  let finish: (value: typeof completed) => void = () => {};
  const execute = vi.fn(
    () =>
      new Promise<typeof completed>((resolve) => {
        finish = resolve;
      }),
  );
  const tool = createForumBrowserTools(
    context,
    controller.signal,
    execute,
  ).find((tool) => tool.name === "forum_open")!;
  const request = tool.execute({});
  controller.abort(new Error("Profile changed"));
  finish(completed);
  await expect(request).rejects.toThrow("Profile changed");
});

test("registration provides the teardown signal and tolerates unsupported tools", async () => {
  const controller = new AbortController();
  const tools = createForumBrowserTools(null, controller.signal, vi.fn());
  const registerTool = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error("Unsupported");
    })
    .mockRejectedValueOnce(new Error("Unsupported"));
  registerForumBrowserTools({ registerTool }, tools, controller.signal);
  expect(registerTool).toHaveBeenCalledTimes(tools.length);
  expect(registerTool.mock.calls[0][1]).toEqual({ signal: controller.signal });
  controller.abort();
  registerForumBrowserTools({ registerTool }, tools, controller.signal);
  expect(registerTool).toHaveBeenCalledTimes(tools.length);
  await Promise.resolve();
});

function picker(files: File[], visible = true) {
  return {
    disabled: false,
    hidden: false,
    closest: () => null,
    getClientRects: () => (visible ? [{ width: 10 }] : []),
    files,
  };
}
function surface(pickers: ReturnType<typeof picker>[]) {
  return { querySelectorAll: vi.fn(() => pickers) } as unknown as Pick<
    Document,
    "querySelectorAll"
  >;
}
test("browser attachments read only selected visible forum picker files", () => {
  const visible = new File(["hello"], "forum.txt", { type: "text/plain" });
  const hidden = new File(["private"], "private.txt", { type: "text/plain" });
  expect(
    selectedForumAgentFiles(
      surface([picker([visible]), picker([hidden], false)]),
    ),
  ).toEqual([visible]);
  expect(() =>
    selectedForumAgentFiles(surface([picker([hidden], false)])),
  ).toThrow("visible forum agent file picker");
  expect(() =>
    selectedForumAgentFiles(
      surface([picker(Array.from({ length: 6 }, () => visible))]),
    ),
  ).toThrow("five");
  expect(() =>
    selectedForumAgentFiles(
      surface([
        picker([
          new File(["hello"], "bad.exe", { type: "application/x-executable" }),
        ]),
      ]),
    ),
  ).toThrow("supported");
});

test("selected-file tool never exposes remote download URLs to browser agents", async () => {
  const upload = vi
    .fn()
    .mockResolvedValue({ status: "completed", attachments: [] });
  const tools = createForumBrowserTools(
    context,
    new AbortController().signal,
    vi.fn(),
    upload,
  );
  expect(
    tools.find((tool) => tool.name === "forum_upload_attachments"),
  ).toBeUndefined();
  const selected = tools.find(
    (tool) => tool.name === "forum_upload_selected_attachments",
  )!;
  await selected.execute({ idempotencyKey: "upload-command-123" });
  expect(upload).toHaveBeenCalledWith(
    "upload-command-123",
    expect.any(AbortSignal),
  );
  await expect(
    selected.execute({
      idempotencyKey: "upload-command-123",
      files: ["secret"],
    }),
  ).rejects.toThrow("idempotencyKey");
});

test("review uploads preserve proposals and policy binding before usable attachment references", async () => {
  const file = new File(["hello"], "forum.txt", { type: "text/plain" });
  vi.stubGlobal("document", surface([picker([file])]));
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: "pending_approval",
        commandId: "proposal-123",
        approvalUrl: "https://forum.symbaiex.com/control-panel/agent-access",
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  try {
    const result = await uploadSelectedForumAgentFiles(
      "browser-connection",
      3,
      "stable-upload-key",
      new AbortController().signal,
    );
    expect(result.status).toBe("pending_approval");
    expect(result.attachments).toEqual([]);
    expect(result.proposals).toEqual([
      expect.objectContaining({ commandId: "proposal-123" }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/plugin/forum/attachments",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Forum-Plugin-Connection": "browser-connection",
          "X-Forum-Plugin-Policy-Version": "3",
          "Idempotency-Key": "stable-upload-key:0",
        }),
        body: file,
      }),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

test("completed upload receipts expose actor-owned attachment references", async () => {
  const file = new File(["hello"], "forum.txt", { type: "text/plain" });
  vi.stubGlobal("document", surface([picker([file])]));
  const attachment = {
    storageId: "stored-file",
    filename: "forum.txt",
    contentType: "text/plain",
    size: 5,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          actingAs: context.actingAs,
          data: attachment,
        }),
        { status: 200 },
      ),
    ),
  );
  try {
    const result = await uploadSelectedForumAgentFiles(
      context.connectionId,
      context.policyVersion,
      "stable-upload-key",
      new AbortController().signal,
    );
    expect(result.status).toBe("completed");
    expect(result.attachments).toEqual([attachment]);
    expect(result.proposals).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("connection status tool dispatches a protected read with selected policy revision", async () => {
  const execute = vi.fn().mockResolvedValue({ ...completed, data: context });
  const status = createForumBrowserTools(
    context,
    new AbortController().signal,
    execute,
  ).find((tool) => tool.name === "forum_status")!;
  expect(status).toBeDefined();
  const result = await status.execute({});
  expect(result).toEqual({ ...completed, data: context });
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "status",
      readOnly: true,
      connectionId: context.connectionId,
      expectedPolicyVersion: context.policyVersion,
      args: {},
    }),
  );
});

test("browser reads spend automation quota with a fresh key per invocation", async () => {
  const execute = vi.fn().mockResolvedValue(completed);
  const tool = createForumBrowserTools(
    context,
    new AbortController().signal,
    execute,
  ).find((tool) => tool.name === "forum_open")!;
  await tool.execute({});
  await tool.execute({});
  const first = execute.mock.calls[0][0];
  const second = execute.mock.calls[1][0];
  expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  expect(first.expectedPolicyVersion).toBe(context.policyVersion);
});

test("browser writes ignore caller policy versions and strip reserved fields from domain arguments", async () => {
  const execute = vi.fn().mockResolvedValue(completed);
  const reply = createForumBrowserTools(
    context,
    new AbortController().signal,
    execute,
  ).find((tool) => tool.name === "forum_create_reply")!;
  expect(reply.inputSchema.required).not.toContain("expectedPolicyVersion");
  await reply.execute({
    threadId: "thread-123",
    body: "Hello",
    idempotencyKey: "stable-command-123",
    expectedPolicyVersion: 999,
  });
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({
      args: { threadId: "thread-123", body: "Hello" },
      expectedPolicyVersion: context.policyVersion,
    }),
  );
});
