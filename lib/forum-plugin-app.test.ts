import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { FORUM_PLUGIN_APP_HTML, FORUM_PLUGIN_APP_RESOURCE } from "./forum-plugin-app";
import { findForumPluginTool, validateForumPluginArguments } from "./forum-plugin-catalog";

/** Minimal DOM for exercising the shipped script and host protocol without a browser dependency. */
class Node {
  children: Node[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners = new Map<string, Array<(event: { preventDefault(): void }) => void>>();
  value = "";
  disabled = false;
  hidden = false;
  name = "";
  files: Array<{ name: string; size: number; type: string }> = [];
  href = "";
  tagName: string;
  private ownText = "";
  constructor(tag: string) { this.tagName = tag; }
  set textContent(value: string) { this.ownText = value; this.children = []; }
  get textContent(): string { return this.ownText + this.children.map(node => node.textContent).join(""); }
  append(...nodes: Node[]) { this.children.push(...nodes); }
  prepend(...nodes: Node[]) { this.children.unshift(...nodes); }
  replaceChildren(...nodes: Node[]) { this.ownText = ""; this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, callback: (event: { preventDefault(): void }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
  }
  fire(name: string) { for (const listener of this.listeners.get(name) ?? []) listener({ preventDefault() {} }); }
  focus() {}
  reportValidity() { return true; }
  querySelector(tag: string): Node | null {
    for (const child of this.children) { if (child.tagName === tag) return child; const nested = child.querySelector(tag); if (nested) return nested; }
    return null;
  }
  get firstElementChild() { return this.children[0]; }
  find(text: string): Node | undefined {
    if (this.tagName === "button" && this.textContent === text) return this;
    for (const child of this.children) { const result = child.find(text); if (result) return result; }
  }
  byName(name: string): Node | undefined {
    if (this.name === name) return this;
    for (const child of this.children) { const result = child.byName(name); if (result) return result; }
  }
}

type Message = { jsonrpc?: string; id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
function appHarness(openai?: Record<string, unknown>) {
  const sent: Message[] = [];
  const nodes = new Map<string, Node>();
  for (const id of ["app", "content", "status", "identity", "mode", "navigation", "compose", "expand", "search", "query", "settings"]) nodes.set(id, new Node(id === "search" ? "form" : "div"));
  const listeners = new Map<string, (event: { source: unknown; data: unknown }) => void>();
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let uuid = 0;
  const parent = { postMessage(message: Message) { sent.push(message); } };
  const window = {
    parent,
    openai,
    addEventListener(name: string, callback: (event: { source: unknown; data: unknown }) => void) { listeners.set(name, callback); },
    removeEventListener(name: string) { listeners.delete(name); },
  };
  const script = FORUM_PLUGIN_APP_HTML.match(/<script>([\s\S]+)<\/script>/)![1];
  runInNewContext(script, {
    window, document: {
      getElementById(id: string) { return nodes.get(id); },
      createElement(tag: string) { return new Node(tag); },
      createTextNode(text: string) { const node = new Node("text"); node.textContent = text; return node; },
      documentElement: new Node("html"),
    },
    URL, Date, Map, Set, Promise,
    crypto: { randomUUID() { return "00000000-0000-0000-0000-" + String(++uuid).padStart(12, "0"); } },
    setTimeout(callback: () => void) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const message = (data: Message, source: unknown = parent) => listeners.get("message")?.({ source, data });
  const reply = (request: Message, result: unknown) => message({ jsonrpc: "2.0", id: request.id, result });
  const latest = (method: string) => sent.filter(request => request.method === method).at(-1)!;
  const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
  const connect = async () => {
    reply(latest("ui/initialize"), { protocolVersion: "2026-01-26", hostContext: { theme: "dark", availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline" }, hostCapabilities: { serverTools: {} } });
    await flush();
    reply(latest("tools/call"), { structuredContent: { actingAs: { userId: "research-agent", username: "Research agent", isAgent: true }, capabilities: ["read", "participate", "personal", "messages", "attachments"], executionMode: "review", policyVersion: 1 } });
    await flush();
    reply(latest("tools/call"), { structuredContent: { status: "completed", actingAs: { userId: "research-agent", username: "Research agent", isAgent: true }, data: { threads: [], pagination: { page: 1, totalPages: 1 } } } });
    await flush();
  };
  return { sent, nodes, listeners, timers, message, reply, latest, flush, connect };
}

describe("forum MCP App resource", () => {
  test("ships a portable HTML resource with no external connection or frame permissions", () => {
    expect(FORUM_PLUGIN_APP_RESOURCE.uri).toBe("ui://symbaiex/forum.html");
    expect(FORUM_PLUGIN_APP_RESOURCE.mimeType).toBe("text/html;profile=mcp-app");
    expect(FORUM_PLUGIN_APP_RESOURCE._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [], frameDomains: [] });
    expect(FORUM_PLUGIN_APP_HTML.startsWith("<!doctype html>")).toBe(true);
    expect(FORUM_PLUGIN_APP_HTML).not.toMatch(/innerHTML|<iframe|fetch\(|XMLHttpRequest|localStorage|accessToken|authorization:/i);
    expect(FORUM_PLUGIN_APP_HTML).toContain('aria-label="Forum sections"');
    expect(FORUM_PLUGIN_APP_HTML).toContain("focus-visible");
  });

  test("negotiates the standard protocol and guards parent source, response shape and request IDs", async () => {
    const app = appHarness();
    const init = app.latest("ui/initialize");
    expect(init.params).toMatchObject({ protocolVersion: "2026-01-26", appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] } });
    app.message({ jsonrpc: "2.0", id: init.id, result: { protocolVersion: "2026-01-26" } }, {});
    app.message({ jsonrpc: "1.0", id: init.id, result: {} });
    app.message({ jsonrpc: "2.0", id: 900, result: {} });
    app.message({ jsonrpc: "2.0", id: init.id, result: {}, error: {} });
    await app.flush();
    expect(app.sent.filter(message => message.method === "tools/call")).toHaveLength(0);
    await app.connect();
    expect(app.sent.some(message => message.method === "ui/notifications/initialized")).toBe(true);
    expect(app.nodes.get("identity")!.textContent).toBe("Research agent · AI agent");
    expect(app.nodes.get("mode")!.textContent).toBe("Writes require review");
    for (const request of app.sent.filter(message => message.method === "tools/call")) {
      const tool = findForumPluginTool(String(request.params!.name))!;
      expect(tool).toBeDefined();
      expect(validateForumPluginArguments(tool, request.params!.arguments)).toBeNull();
    }
  });

  test("rejects stalled bridge requests and tears down pending calls", async () => {
    const app = appHarness();
    app.timers.values().next().value!();
    await app.flush();
    expect(app.nodes.get("status")!.textContent).toContain("host did not respond");
    const connected = appHarness();
    await connected.connect();
    connected.nodes.get("expand")!.fire("click");
    expect(connected.latest("ui/request-display-mode").params).toEqual({ mode: "fullscreen" });
    connected.message({ jsonrpc: "2.0", id: 78, method: "ui/resource-teardown" });
    await connected.flush();
    expect(connected.listeners.has("message")).toBe(false);
    expect(connected.timers.size).toBe(0);
    expect(connected.sent.at(-1)).toMatchObject({ id: 78, result: {} });
  });

  test("renders hostile forum text as text and ignores stale navigation results", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    const stale = app.latest("tools/call");
    app.nodes.get("navigation")!.find("Members")!.fire("click");
    const latest = app.latest("tools/call");
    app.reply(latest, { structuredContent: { status: "completed", data: { members: [{ username: '<img src=x onerror="alert(1)">', bio: "test" }] } } });
    await app.flush();
    app.reply(stale, { structuredContent: { status: "completed", data: [{ name: "Old board", slug: "old" }] } });
    await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(app.nodes.get("content")!.textContent).not.toContain("Old board");
    expect(app.nodes.get("content")!.querySelector("img")).toBeNull();
  });

  test("keeps exact idempotency key and draft across write errors; queues review actions", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("compose")!.fire("click");
    const draft = app.nodes.get("content")!;
    const fields = { categorySlug: "general", title: "Research notes", body: "Hello forum" };
    for (const [name, value] of Object.entries(fields)) { const field = draft.byName(name)!; field.value = value; field.fire("input"); }
    const form = draft.querySelector("form")!;
    form.fire("submit");
    await app.flush();
    const first = app.latest("tools/call");
    expect(first.params!.name).toBe("forum_create_thread");
    expect(validateForumPluginArguments(findForumPluginTool("forum_create_thread")!, first.params!.arguments)).toBeNull();
    expect(draft.byName("body")!.disabled).toBe(true);
    app.reply(first, { isError: true, content: [{ type: "text", text: "Temporary error" }] });
    await app.flush();
    expect(draft.byName("body")!.value).toBe("Hello forum");
    expect(draft.byName("body")!.disabled).toBe(false);
    form.fire("submit");
    await app.flush();
    const retry = app.latest("tools/call");
    expect(retry.params!.arguments).toEqual(first.params!.arguments);
    app.reply(retry, { structuredContent: { status: "pending_approval", approvalUrl: "https://forum.symbaiex.com/control-panel/agent-access", actingAs: { username: "Research agent", isAgent: true } } });
    await app.flush();
    expect(draft.textContent).toContain("Awaiting owner review");
    expect(app.nodes.get("status")!.textContent).toContain("has not executed");
    expect(app.sent.filter(message => message.method === "tools/call").some(message => /approve/i.test(String(message.params!.name)))).toBe(false);
  });

  test("imports ChatGPT-selected files through tools and waits for attachment review before sending content", async () => {
    let downloadRequestCount = 0;
    const app = appHarness({
      selectFiles: async () => [{ fileId: "file-notes", fileName: "notes.md", mimeType: "text/markdown" }],
      getFileDownloadUrl: async () => { downloadRequestCount++; return { downloadUrl: "https://files.example.test/temporary-secret-" + downloadRequestCount }; },
    });
    await app.connect();
    app.nodes.get("compose")!.fire("click");
    const draft = app.nodes.get("content")!;
    for (const [name, value] of Object.entries({ categorySlug: "general", title: "Research notes", body: "Read the attachment" })) { const field = draft.byName(name)!; field.value = value; field.fire("input"); }
    draft.find("Choose from ChatGPT")!.fire("click");
    await app.flush();
    expect(draft.textContent).toContain("notes.md · awaiting import");
    const form = draft.querySelector("form")!;
    form.fire("submit");
    await app.flush();
    const upload = app.latest("tools/call");
    expect(upload.params!.name).toBe("forum_upload_attachments");
    expect(validateForumPluginArguments(findForumPluginTool("forum_upload_attachments")!, upload.params!.arguments)).toBeNull();
    expect(draft.textContent).not.toContain("temporary-secret");
    app.reply(upload, { structuredContent: { status: "pending_approval", data: { attachments: [], proposals: [{ commandId: "command-1", approvalUrl: "https://forum.symbaiex.com/control-panel/agent-access" }] } } });
    await app.flush();
    expect(app.nodes.get("status")!.textContent).toContain("discussion has not been sent");
    expect(app.sent.some(message => message.params?.name === "forum_create_thread")).toBe(false);
    expect(draft.byName("body")!.value).toBe("Read the attachment");
    form.fire("submit");
    await app.flush();
    const retryUpload = app.latest("tools/call");
    expect((retryUpload.params!.arguments as Record<string, unknown>).idempotencyKey).toBe((upload.params!.arguments as Record<string, unknown>).idempotencyKey);
    expect(downloadRequestCount).toBe(2);
    app.reply(retryUpload, { structuredContent: { status: "completed", data: { attachments: [{ storageId: "storage-notes", filename: "notes.md" }], proposals: [] } } });
    await app.flush();
    const write = app.latest("tools/call");
    expect(write.params!.name).toBe("forum_create_thread");
    expect(write.params!.arguments).toMatchObject({ attachments: [{ storageId: "storage-notes", filename: "notes.md" }] });
    expect(JSON.stringify(write.params)).not.toContain("temporary-secret");
  });

  test("enforces the attachment count before importing library files", async () => {
    const app = appHarness({ selectFiles: async () => Array.from({ length: 6 }, (_, index) => ({ fileId: "file-" + index, fileName: index + ".txt", mimeType: "text/plain" })), getFileDownloadUrl: async () => ({ downloadUrl: "https://files.example.test" }) });
    await app.connect();
    app.nodes.get("compose")!.fire("click");
    app.nodes.get("content")!.find("Choose from ChatGPT")!.fire("click");
    await app.flush();
    expect(app.nodes.get("status")!.textContent).toContain("at most five attachments");
    expect(app.sent.some(message => message.params?.name === "forum_upload_attachments")).toBe(false);
  });

  test("validates local attachment size and type before uploading to ChatGPT", async () => {
    let uploaded = 0;
    const app = appHarness({ uploadFile: async () => { uploaded++; return { fileId: "file-local" }; }, getFileDownloadUrl: async () => ({ downloadUrl: "https://files.example.test" }) });
    await app.connect();
    app.nodes.get("compose")!.fire("click");
    const input = app.nodes.get("content")!.byName("attachments")!;
    input.files = [{ name: "large.pdf", size: 5 * 1024 * 1024 + 1, type: "application/pdf" }];
    input.fire("change");
    await app.flush();
    expect(app.nodes.get("status")!.textContent).toContain("5 MiB");
    expect(uploaded).toBe(0);
    input.files = [{ name: "script.svg", size: 12, type: "image/svg+xml" }];
    input.fire("change");
    await app.flush();
    expect(uploaded).toBe(0);
    input.files = [{ name: "notes.txt", size: 100, type: "text/plain" }];
    input.fire("change");
    await app.flush();
    expect(uploaded).toBe(1);
    expect(app.nodes.get("content")!.textContent).toContain("notes.txt · awaiting import");
  });

  test("binds writes to the draft policy and requires an explicit profile choice after a stale-policy rejection", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("compose")!.fire("click");
    const draft = app.nodes.get("content")!;
    for (const [name, value] of Object.entries({ categorySlug: "general", title: "Preserved research", body: "Do not lose this draft" })) { const field = draft.byName(name)!; field.value = value; field.fire("input"); }
    const form = draft.querySelector("form")!;
    form.fire("submit");
    await app.flush();
    const first = app.latest("tools/call");
    expect(first.params!.arguments).toMatchObject({ expectedPolicyVersion: 1 });
    app.reply(first, { isError: true, content: [{ type: "text", text: "PLUGIN_POLICY_CHANGED: The acting profile or connection policy changed." }] });
    await app.flush();
    const newStatus = { actingAs: { userId: "different-agent", username: "New agent", isAgent: true }, capabilities: ["read", "participate", "attachments"], executionMode: "direct", policyVersion: 2 };
    expect(app.latest("tools/call").params!.name).toBe("forum_status");
    app.reply(app.latest("tools/call"), { structuredContent: newStatus });
    await app.flush();
    expect(draft.byName("body")!.value).toBe("Do not lose this draft");
    const writeCount = app.sent.filter(message => message.params?.name === "forum_create_thread").length;
    form.fire("submit");
    await app.flush();
    expect(app.sent.filter(message => message.params?.name === "forum_create_thread")).toHaveLength(writeCount);
    expect(draft.find("Submit for review")!.disabled).toBe(true);
    draft.find("Use New agent")!.fire("click");
    await app.flush();
    app.reply(app.latest("tools/call"), { structuredContent: newStatus });
    await app.flush();
    expect(draft.find("Send")!.disabled).toBe(false);
    expect(app.sent.filter(message => message.params?.name === "forum_create_thread")).toHaveLength(writeCount);
    form.fire("submit");
    await app.flush();
    const next = app.latest("tools/call");
    expect(next.params!.arguments).toMatchObject({ expectedPolicyVersion: 2, body: "Do not lose this draft" });
    expect((next.params!.arguments as Record<string, unknown>).idempotencyKey).not.toBe((first.params!.arguments as Record<string, unknown>).idempotencyKey);
  });

  test("honors shared display-mode restrictions even when the OpenAI alias exists", async () => {
    let aliasCalls = 0;
    const app = appHarness({ requestDisplayMode: async () => { aliasCalls++; return { mode: "fullscreen" }; } });
    await app.connect();
    app.message({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { availableDisplayModes: ["inline"], displayMode: "inline" } });
    expect(app.nodes.get("expand")!.hidden).toBe(true);
    app.nodes.get("expand")!.fire("click");
    await app.flush();
    expect(aliasCalls).toBe(0);
    expect(app.sent.some(message => message.method === "ui/request-display-mode")).toBe(false);
  });
});
