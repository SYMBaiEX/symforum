import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
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
  for (const id of ["app", "content", "status", "identity", "mode", "connection-owner", "posting-trust", "navigation", "compose", "expand", "search", "query", "settings", "chat-messages", "chat-notice", "chat-form", "chat-body", "chat-send", "chat-older", "chat-moderation", "chat-profile", "chat-toggle", "chat-panel", "chat-latest"]) nodes.set(id, new Node(id === "search" ? "form" : "div"));
  const listeners = new Map<string, (event: { source: unknown; data: unknown }) => void>();
  const timers = new Map<number, () => void>();
  const timerDurations = new Map<number, number>();
  let nextTimer = 0;
  let uuid = 0;
  const parent = { postMessage(message: Message) { sent.push(message); } };
  const documentElement = new Node("html");
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
      documentElement,
    },
    URL, Date, Map, Set, Promise,
    crypto: { randomUUID() { return "00000000-0000-0000-0000-" + String(++uuid).padStart(12, "0"); } },
    setTimeout(callback: () => void, duration: number) { timers.set(++nextTimer, callback); timerDurations.set(nextTimer, duration); return nextTimer; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const message = (data: Message, source: unknown = parent) => listeners.get("message")?.({ source, data });
  const reply = (request: Message, result: unknown) => message({ jsonrpc: "2.0", id: request.id, result });
  const latest = (method: string) => sent.filter(request => request.method === method).at(-1)!;
  const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
  const connect = async () => {
    reply(latest("ui/initialize"), { protocolVersion: "2026-01-26", hostContext: { theme: "dark", availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline" }, hostCapabilities: { serverTools: {} } });
    await flush();
    reply(latest("tools/call"), { structuredContent: { actingAs: { userId: "research-agent", username: "Research agent", isAgent: true }, capabilities: ["read", "participate", "personal", "messages", "attachments"], executionMode: "review", policyVersion: 1 } });
    await flush();
    for (const call of sent.filter(request => request.method === "tools/call" && ["forum_list_categories", "forum_list_chat_messages"].includes(String(request.params?.name)))) {
      reply(call, { structuredContent: { status: "completed", actingAs: { userId: "research-agent", username: "Research agent", isAgent: true }, data: call.params?.name === "forum_list_categories" ? [] : { page: [], pending: [], viewer: { canSend: true }, isDone: true, continueCursor: "" } } });
    }
    await flush();
    const chat = sent.filter(request => request.params?.name === "forum_list_chat_messages").at(-1);
    if (chat) reply(chat, { structuredContent: { data: { page: [], pending: [], viewer: { canRead: true, canSend: true }, isDone: true } } });
    await flush();
  };
  return { sent, nodes, documentElement, listeners, timers, timerDurations, message, reply, latest, flush, connect };
}

describe("forum MCP App resource", () => {
  test("opens Boards by default and decodes preserved ChatGPT result metadata", async () => {
    const app = appHarness();
    await app.connect();
    expect(app.sent.some(call => call.params?.name === "forum_list_categories")).toBe(true);
    expect(app.sent.some(call => call.params?.name === "forum_list_feed_threads")).toBe(false);
    for (const key of ["call_tool_result", "mcp_tool_result"]) {
      app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { [key]: { structuredContent: { status: "pending_approval", approvalUrl: "https://forum.symbaiex.com/control-panel/agent-access?commandId=test#review-queue" } } } });
      expect(app.nodes.get("status")!.textContent).toContain("Review");
      expect(app.nodes.get("status")!.textContent).not.toContain("no structured");
    }
  });

  test("recovers an older cached feed tool without hiding authorization failures", async () => {
    for (const [error, fallback] of [["Unknown tool forum_list_feed_threads", true], ["Permission denied: tool unavailable", false]] as const) {
      const app = appHarness(); await app.connect();
      app.nodes.get("navigation")!.find("Feed")!.fire("click");
      const news = app.sent.filter(call => call.params?.name === "forum_list_news_feed").at(-1)!;
      app.reply(news, { structuredContent: { data: { stories: [] } } });
      app.message({ jsonrpc: "2.0", id: app.latest("tools/call").id, error: { message: error } });
      await app.flush();
      expect(app.sent.some(call => call.params?.name === "forum_overview")).toBe(fallback);
      if (fallback) {
        app.reply(app.latest("tools/call"), { structuredContent: { data: { newestThreads: [{ title: "Cached-host conversation", slug: "cached", categorySlug: "general" }] } } });
        await app.flush();
        expect(app.nodes.get("content")!.textContent).toContain("Cached-host conversation");
      } else expect(app.nodes.get("content")!.textContent).toContain("Permission denied");
    }
  });

  test("uses a shorter initialize timeout only when the legacy host bridge is available", async () => {
    const standard = appHarness();
    expect([...standard.timerDurations.values()]).toEqual([20000]);
    const calls: string[] = [];
    const legacy = appHarness({ callTool: async (name: string) => { calls.push(name); return { structuredContent: { data: name === "forum_list_categories" ? [] : { capabilities: [], page: [], isDone: true } } }; } });
    expect([...legacy.timerDurations.values()]).toEqual([2000]);
    legacy.timers.values().next().value!(); await legacy.flush();
    expect(calls).toContain("forum_list_categories");
    expect(legacy.nodes.get("content")!.textContent).toContain("Forum boards");
  });

  test.each([
    { label: "empty metadata with valid raw output", metadata: {}, output: { actingAs: { userId: "hint", username: "Snapshot profile" }, data: { capabilities: ["read"] } } },
    { label: "both snapshots malformed", metadata: { unrelated: "host metadata" }, output: "not structured forum data" },
  ])("legacy boot continues with $label", async ({ metadata, output }) => {
    const calls: string[] = [];
    const app = appHarness({ toolResponseMetadata: metadata, toolOutput: output, callTool: async (name: string) => {
      calls.push(name);
      if (name === "forum_status") return { structuredContent: { actingAs: { userId: "owner", username: "Authenticated profile" }, data: { capabilities: ["read"], policyVersion: 1, executionMode: "direct" } } };
      return { structuredContent: { data: name === "forum_list_categories" ? [{ name: "Working General", slug: "general" }] : { page: [], pending: [], viewer: { canRead: true, canSend: false }, isDone: true } } };
    } });
    app.timers.values().next().value!(); await app.flush();
    expect(calls).toEqual(["forum_status", "forum_list_categories", "forum_list_chat_messages"]);
    expect(app.nodes.get("identity")!.textContent).toContain("Authenticated profile");
    expect(app.nodes.get("content")!.textContent).toContain("Working General");
    expect(app.nodes.get("status")!.textContent).not.toContain("no structured forum data");
  });

  test("uses the available legacy tool bridge after an explicit cached-tool error", async () => {
    const calls: string[] = [];
    const app = appHarness({ callTool: async (name: string) => { calls.push(name); return { mcp_tool_result: { structuredContent: { data: { page: [{ title: "Bridge fallback", categorySlug: "general", slug: "fallback" }], isDone: true } } } }; } });
    await app.connect();
    app.nodes.get("navigation")!.find("Community")!.fire("click");
    app.message({ jsonrpc: "2.0", id: app.latest("tools/call").id, error: { message: "Tool unavailable in cache" } });
    await app.flush();
    expect(calls).toEqual(["forum_list_feed_threads"]);
    expect(app.nodes.get("content")!.textContent).toContain("Bridge fallback");
  });

  test("chat sends only on submission, preserves exact retry keys, and stops polling when collapsed", async () => {
    const app = appHarness(); await app.connect();
    expect(app.sent.filter(call => call.params?.name === "forum_send_chat_message")).toHaveLength(0);
    const body = app.nodes.get("chat-body")!; body.value = "Hello lounge"; body.fire("input");
    app.nodes.get("chat-form")!.fire("submit"); await app.flush();
    const first = app.latest("tools/call");
    expect(first.params).toMatchObject({ name: "forum_send_chat_message", arguments: { body: "Hello lounge", expectedPolicyVersion: 1 } });
    app.message({ jsonrpc: "2.0", id: first.id, error: { message: "Temporary failure" } }); await app.flush();
    expect(body.value).toBe("Hello lounge");
    app.nodes.get("chat-form")!.fire("submit"); await app.flush();
    const retry = app.latest("tools/call"); expect(retry.params).toEqual(first.params);
    app.reply(retry, { structuredContent: { status: "pending_approval", approvalUrl: "https://forum.symbaiex.com/control-panel/agent-access?commandId=chat#review-queue" } }); await app.flush();
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], pending: [], viewer: { canSend: true }, isDone: true } } }); await app.flush();
    expect(app.nodes.get("chat-notice")!.textContent).toContain("not sent yet");
    expect(body.value).toBe("");
    app.nodes.get("chat-toggle")!.fire("click");
    expect(app.nodes.get("chat-panel")!.hidden).toBe(true);
    expect(app.timers.size).toBe(0);
  });

  test("chat permission transition drops old reads and requires explicit draft actor confirmation", async () => {
    const app = appHarness(); await app.connect();
    const body = app.nodes.get("chat-body")!; body.value = "Preserve chat draft"; body.fire("input");
    app.nodes.get("chat-latest")!.fire("click"); const old = app.latest("tools/call");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: { userId: "new", username: "New profile" }, data: { capabilities: ["read", "participate"], policyVersion: 2, executionMode: "direct" } } } });
    app.reply(old, { structuredContent: { data: { page: [{ body: "Old private response" }], viewer: { canSend: true }, isDone: true } } }); await app.flush();
    expect(app.nodes.get("chat-messages")!.textContent).not.toContain("Old private response");
    expect(app.nodes.get("chat-send")!.disabled).toBe(true);
    expect(body.value).toBe("Preserve chat draft");
    expect(app.nodes.get("chat-form")!.find("Use current profile")!.hidden).toBe(false);
    app.nodes.get("chat-form")!.fire("submit");
    expect(app.sent.filter(call => call.params?.name === "forum_send_chat_message")).toHaveLength(0);
  });

  test("missing chat tools leave Boards readable and do not keep polling an unsupported tool", async () => {
    const app = appHarness(); await app.connect();
    app.nodes.get("chat-latest")!.fire("click");
    app.message({ jsonrpc: "2.0", id: app.latest("tools/call").id, error: { message: "Unknown tool forum_list_chat_messages" } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("Forum boards");
    expect(app.nodes.get("chat-notice")!.textContent).toContain("Reconnect");
    expect(app.timers.size).toBe(0);
  });


  test("chat shows own moderated messages safely and polling leaves the active reader intact", async () => {
    const app = appHarness(); await app.connect();
    app.nodes.get("compose")!.fire("click");
    const draft = app.nodes.get("content")!.byName("body")!; draft.value = "Keep forum draft"; draft.fire("input");
    app.nodes.get("chat-latest")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], pending: [{ _id: "pending", body: "<script>untrusted</script>", status: "pending", authorIdentity: { username: "Research agent", isAgent: true } }], viewer: { canRead: true, canSend: true }, isDone: true } } }); await app.flush();
    expect(app.nodes.get("chat-messages")!.textContent).toContain("Awaiting staff");
    expect(app.nodes.get("chat-messages")!.textContent).toContain("<script>untrusted</script>");
    expect(app.nodes.get("chat-messages")!.querySelector("script")).toBeNull();
    expect(app.nodes.get("content")!.byName("body")).toBe(draft);
    expect(draft.value).toBe("Keep forum draft");
  });

  test("chat stops automatic polling on denied or quota failures and requires an explicit sending allowance", async () => {
    for (const message of ["Connection revoked", "Quota exhausted", "Permission denied"]) {
      const app = appHarness(); await app.connect();
      app.nodes.get("chat-latest")!.fire("click");
      app.message({ jsonrpc: "2.0", id: app.latest("tools/call").id, error: { message } }); await app.flush();
      expect(app.timers.size).toBe(0);
      expect(app.nodes.get("chat-send")!.disabled).toBe(true);
      app.nodes.get("chat-latest")!.fire("click");
      app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], viewer: {}, isDone: true } } }); await app.flush();
      expect(app.nodes.get("chat-send")!.disabled).toBe(true);
    }
  });

  test("opens the real feed and pages through sparse community results without using unread semantics", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("navigation")!.find("Feed")!.fire("click");
    expect(app.sent.filter(call => call.method === "tools/call").map(call => call.params?.name)).toContain("forum_list_feed_threads");
    expect(app.sent.some(call => call.params?.name === "forum_list_recent_threads")).toBe(false);
    app.nodes.get("navigation")!.find("Community")!.fire("click");
    const first = app.latest("tools/call");
    expect(first.params).toEqual({ name: "forum_list_feed_threads", arguments: { sort: "active", communityOnly: true, paginationOpts: { numItems: 12, cursor: null } } });
    app.reply(first, { structuredContent: { data: { page: [], isDone: false, continueCursor: "native-cursor" } } });
    await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("No visible conversations on this page");
    app.nodes.get("content")!.find("More discussions →")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toEqual({ sort: "active", communityOnly: true, paginationOpts: { numItems: 12, cursor: "native-cursor" } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ title: "A real conversation", slug: "real", categorySlug: "general", authorIdentity: { name: "Agent reader", isAgent: true }, excerpt: "A clear preview" }], isDone: true, continueCursor: "" } } });
    await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("A real conversationAgent reader · AI agent");
    app.nodes.get("content")!.find("← Previous")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toEqual({ sort: "active", communityOnly: true, paginationOpts: { numItems: 12, cursor: null } });
  });

  test("renders stored news editions with canonical links and separates HN and local activity", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("navigation")!.find("News")!.fire("click");
    expect(app.latest("tools/call").params).toEqual({ name: "forum_list_news_feed", arguments: { limit: 30 } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { snapshot: { snapshotDate: "2026-10-02" }, snapshots: [{ snapshotDate: "2026-10-02" }], stories: [
      { hnItemId: 123, title: "Tools & people", host: "example.com", hnScore: 80, hnCommentCount: 40, platformStats: { comments: 3 }, platformStatsStatus: "available" },
      { hnItemId: 124, title: "No local counts yet", hnScore: 8, platformStats: null, platformStatsStatus: "unavailable" },
    ] } } });
    await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("80 HN points · 40 HN comments · 3 SYMBaiEX comments");
    expect(app.nodes.get("content")!.textContent).not.toContain("0 SYMBaiEX comments");
    expect(app.nodes.get("content")!.querySelector("article")!.children[0].attributes["aria-label"]).toBe("Hacker News rank 1");
    const anchor = app.nodes.get("content")!.querySelector("a")!;
    expect(anchor.href).toBe("https://www.symbaiex.com/news/tools-and-people-123");
    anchor.fire("click");
    expect(app.latest("ui/open-link").params).toEqual({ url: anchor.href });
  });

  test("drops a delayed old actor response after a policy change and clears the private reader", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("navigation")!.find("Saved")!.fire("click");
    const stale = app.latest("tools/call");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: { userId: "new-owner", username: "New profile" }, data: { capabilities: ["read"], policyVersion: 2, executionMode: "direct" } } } });
    expect(app.nodes.get("content")!.textContent).toContain("Connection changed");
    app.reply(stale, { structuredContent: { actingAs: { userId: "research-agent", username: "Old agent", isAgent: true }, data: [{ title: "Old private preview", categorySlug: "private", slug: "secret" }] } });
    await app.flush();
    expect(app.nodes.get("identity")!.textContent).toBe("New profile · agent assisted");
    expect(app.nodes.get("content")!.textContent).not.toContain("Old private preview");
    expect(app.nodes.get("mode")!.textContent).toBe("Direct execution");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: { userId: "research-agent", username: "Old agent" }, data: { threads: [] } } } });
    expect(app.nodes.get("identity")!.textContent).toBe("New profile · agent assisted");
  });

  test("isolates two connections with the same actor and policy revision", async () => {
    const app = appHarness();
    await app.connect();
    const status = (connectionId: string) => ({ structuredContent: { actingAs: { userId: "research-agent", username: "Research agent", isAgent: true }, data: { connectionId, capabilities: ["read", "personal"], policyVersion: 1, executionMode: "direct" } } });
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: status("old-connection") });
    app.nodes.get("navigation")!.find("Saved")!.fire("click");
    const stale = app.latest("tools/call");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: status("new-connection") });
    app.reply(stale, { structuredContent: { data: [{ title: "Old connection bookmark" }] } });
    await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("Connection changed");
    expect(app.nodes.get("content")!.textContent).not.toContain("Old connection bookmark");
  });

  test("ships a portable HTML resource with no external connection or frame permissions", () => {
    expect(FORUM_PLUGIN_APP_RESOURCE.uri).toBe("ui://symbaiex/forum.html");
    expect(FORUM_PLUGIN_APP_RESOURCE.mimeType).toBe("text/html;profile=mcp-app");
    expect(FORUM_PLUGIN_APP_RESOURCE._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: [], frameDomains: [] });
    expect(FORUM_PLUGIN_APP_HTML.startsWith("<!doctype html>")).toBe(true);
    expect(FORUM_PLUGIN_APP_HTML).not.toMatch(/innerHTML|<iframe|fetch\(|XMLHttpRequest|localStorage|accessToken|authorization:/i);
    expect(FORUM_PLUGIN_APP_HTML).toContain('aria-label="Forum sections"');
    expect(FORUM_PLUGIN_APP_HTML).toContain("focus-visible");
  });

  test("keeps the portable light and dark palette aligned with native forum tokens", () => {
    const nativeCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const declarations = (block: string) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)].map(match => [match[1], match[2].trim()]));
    const nativeLight = declarations(nativeCss.match(/:root\s*\{([^}]+)\}/)![1]);
    const nativeDark = { ...nativeLight, ...declarations(nativeCss.match(/\.dark\s*\{([^}]+)\}/)![1]) };
    for (const [theme, expected] of [["light", nativeLight], ["dark", nativeDark]] as const) {
      const portable = declarations(FORUM_PLUGIN_APP_HTML.match(new RegExp(":root\\[data-theme=" + theme + "\\]\\{([^}]+)\\}"))![1]);
      expect(Object.keys(portable).length).toBeGreaterThan(10);
      for (const [name, value] of Object.entries(portable)) expect(value, theme + " " + name).toBe(expected[name]);
    }
    expect(FORUM_PLUGIN_APP_HTML).toContain('aria-label="SYMBaiEX Forum"');
  });

  test("updates theme from the host without losing the active forum draft", async () => {
    const app = appHarness();
    await app.connect();
    expect(app.documentElement.dataset.theme).toBe("dark");
    app.nodes.get("compose")!.fire("click");
    const body = app.nodes.get("content")!.byName("body")!;
    body.value = "Keep my draft when the theme changes";
    body.fire("input");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "light" } });
    expect(app.documentElement.dataset.theme).toBe("light");
    expect(app.nodes.get("content")!.byName("body")).toBe(body);
    expect(body.value).toBe("Keep my draft when the theme changes");
  });

  test("shows the connected owner and posting trust independently of direct execution without clearing the action receipt", async () => {
    const app = appHarness();
    await app.connect();
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { status: "pending_approval", approvalUrl: "https://forum.symbaiex.com/control-panel/agent-access?commandId=queued#review-queue" } } });
    const receipt = app.nodes.get("status")!.textContent;
    const pendingContentUrl = "https://forum.symbaiex.com/control-panel/agent-access#moderation-queue";
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
      status: "completed", actingAs: { userId: "agent", username: "Forum assistant", isAgent: true }, data: {
        capabilities: ["read", "participate"], executionMode: "direct", policyVersion: 2,
        ownerProfile: { userId: "owner", username: "austin-hamilton-8fjcv2" }, postingTrust: "moderated",
        postingNotice: "The connected owner is awaiting forum posting trust.", pendingContentUrl,
      },
    } } });
    expect(app.nodes.get("identity")!.textContent).toBe("Forum assistant · AI agent");
    expect(app.nodes.get("connection-owner")!.textContent).toBe("Connected owner: austin-hamilton-8fjcv2");
    expect(app.nodes.get("mode")!.textContent).toBe("Direct execution · Posts require forum moderation");
    expect(app.nodes.get("posting-trust")!.textContent).toContain("awaiting forum posting trust");
    app.nodes.get("posting-trust")!.querySelector("a")!.fire("click");
    expect(app.latest("ui/open-link").params).toEqual({ url: pendingContentUrl });
    expect(app.nodes.get("status")!.textContent).toBe(receipt);

    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: null, data: { capabilities: [], postingTrust: "moderated" } } } });
    expect(app.nodes.get("identity")!.textContent).toBe("Public browsing");
    expect(app.nodes.get("mode")!.textContent).toBe("Connect a profile to participate");
    expect(app.nodes.get("connection-owner")!.hidden).toBe(true);
    expect(app.nodes.get("posting-trust")!.hidden).toBe(true);
    expect(app.nodes.get("status")!.textContent).toBe(receipt);
  });

  test("removes the moderation warning and queue link when current owner posting trust becomes trusted", async () => {
    const app = appHarness();
    await app.connect();
    for (const postingTrust of ["moderated", "trusted"]) {
      app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: { userId: "owner", username: "Forum member", isAgent: false }, data: {
        capabilities: ["read", "participate"], executionMode: "direct", ownerProfile: { userId: "owner", username: "Forum member" }, postingTrust,
        postingNotice: postingTrust === "trusted" ? "Current posting trust permits immediate publication; forum permissions still apply." : "Posts require moderator approval.",
        pendingContentUrl: "https://forum.symbaiex.com/control-panel/agent-access#moderation-queue",
      } } } });
    }
    expect(app.nodes.get("connection-owner")!.textContent).toBe("Connected owner: Forum member");
    expect(app.nodes.get("mode")!.textContent).toBe("Direct execution");
    expect(app.nodes.get("posting-trust")!.textContent).toContain("forum permissions still apply");
    expect(app.nodes.get("posting-trust")!.querySelector("a")).toBeNull();
  });

  test("renders native board rows with separately labelled thread and post counts", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { status: "completed", data: [{ name: "Research", slug: "research", description: "Working notes", threadCount: 12, postCount: 34 }] } });
    await app.flush();
    const counts = app.nodes.get("content")!.querySelector("dl")!;
    expect(counts.children.map(item => item.children.map(node => [node.tagName, node.textContent]))).toEqual([[ ["dt", "Threads"], ["dd", "12"] ], [ ["dt", "Posts"], ["dd", "34"] ]]);
    expect(app.nodes.get("content")!.find("Research")!.disabled).toBe(false);
  });

  test("keeps board hierarchy and target permissions when opening subforums", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: [
      { _id: "parent", name: "Research", slug: "research", threadCount: 12, postCount: 34 },
      { _id: "child", parentCategoryId: "parent", name: "Working notes", slug: "working-notes", threadCount: 2, postCount: 3 },
    ] } });
    await app.flush();
    app.nodes.get("content")!.find("Working notes")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toEqual({ categorySlug: "working-notes", page: 1, pageSize: 20 });
    expect(app.nodes.get("navigation")!.find("Boards")!.attributes["aria-current"]).toBe("page");
    app.reply(app.latest("tools/call"), { structuredContent: { data: {
      category: { name: "Working notes", slug: "working-notes", description: "Research in progress", viewerCanCreateThread: false,
        ancestors: [{ name: "Community", slug: "community", kind: "section", isPostable: false }, { name: "Research", slug: "research", kind: "board" }],
        children: [{ name: "Experiments", slug: "experiments", threadCount: 1, postCount: 2 }] },
      threads: [], rules: { body: "Keep sources attached." }, announcements: [{ title: "Weekly reading", body: "Share your notes here." }],
    } } });
    await app.flush();
    const content = app.nodes.get("content")!;
    expect(content.textContent).toContain("Boards/Community/Research");
    expect(content.find("Community")).toBeUndefined();
    expect(content.find("Create post")).toBeUndefined();
    expect(content.textContent).toContain("Subforums");
    expect(content.textContent).toContain("Weekly reading");
    expect(content.querySelector("summary")!.textContent).toBe("Board rules");
    content.find("Experiments")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toEqual({ categorySlug: "experiments", page: 1, pageSize: 20 });
    const oldChild = app.latest("tools/call");
    app.nodes.get("navigation")!.find("News")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { stories: [] } } });
    await app.flush();
    app.reply(oldChild, { structuredContent: { data: { category: { name: "Experiments", viewerCanCreateThread: true }, threads: [] } } });
    await app.flush();
    expect(content.querySelector("h1")!.textContent).toBe("News");
    expect(content.find("Create post")).toBeUndefined();
  });

  test("keeps thread ownership, AI labels, and reply restrictions in the conversation layout", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("navigation")!.find("Community")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ title: "Sources", slug: "sources", categorySlug: "research", replyCount: 2, viewCount: 8, lastPostAuthor: "Curator", lastPostAt: 1_800_000_000_000 }], isDone: true } } });
    await app.flush();
    const stats = app.nodes.get("content")!.querySelector("dl")!;
    expect(stats.children.map(item => item.children.map(node => node.textContent))).toEqual([["Replies", "2"], ["Views", "8"]]);
    app.nodes.get("content")!.find("Sources")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: {
      category: { name: "Research", slug: "research" },
      thread: { _id: "thread", title: "Sources", author: "Curator", body: "Original sources", viewerCanReply: false, replyCount: 2, authorIdentity: { isAgent: true } },
      replies: { page: [{ author: "Member", body: "A human reply", agentAssisted: true }], pagination: { page: 1, totalPages: 1 } },
    } } });
    await app.flush();
    const content = app.nodes.get("content")!;
    expect(content.textContent).toContain("Conversation2 replies");
    expect(content.textContent).toContain("AI agent");
    expect(content.textContent).toContain("Agent assisted");
    expect(content.textContent).toContain("Original sources");
    expect(content.textContent).toContain("A human reply");
    expect(content.find("Reply")).toBeUndefined();
    expect(content.textContent).toContain("Replies are unavailable");
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

  test("surfaces model-triggered moderation results without replacing an open draft or opening unpublished content", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("compose")!.fire("click");
    const draft = app.nodes.get("content")!;
    const body = draft.byName("body")!;
    body.value = "My unsent draft";
    body.fire("input");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
      status: "completed", publicationStatus: "pending_moderation", message: "Saved, awaiting moderator approval. It is not published yet.",
      pendingContentUrl: "https://forum.symbaiex.com/control-panel/agent-access#moderation-queue",
      moderationUrl: "https://forum.symbaiex.com/moderation?threadId=thread-pending",
      actingAs: { username: "Research agent", isAgent: true },
    } } });
    expect(draft.byName("body")).toBe(body);
    expect(body.value).toBe("My unsent draft");
    expect(app.nodes.get("status")!.textContent).toContain("not published yet");
    expect(app.nodes.get("status")!.querySelector("a")!.href).toBe("https://forum.symbaiex.com/control-panel/agent-access#moderation-queue");
    expect(app.sent.some(message => message.method === "ui/open-link")).toBe(false);
    expect(app.sent.some(message => message.params?.name === "forum_get_thread")).toBe(false);
  });

  test("keeps a model-triggered approval notice visible when an earlier navigation finishes", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    const read = app.latest("tools/call");
    const approvalUrl = "https://forum.symbaiex.com/control-panel/agent-access?commandId=command-1#review-queue";
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { status: "pending_approval", commandId: "command-1", approvalUrl } } });
    app.reply(read, { structuredContent: { status: "completed", data: [] } });
    await app.flush();
    expect(app.nodes.get("status")!.textContent).toContain("has not executed");
    const reviewLink = app.nodes.get("status")!.querySelector("a")!;
    expect(reviewLink.href).toBe(approvalUrl);
    reviewLink.fire("click");
    expect(app.latest("ui/open-link").params).toEqual({ url: approvalUrl });
  });

  test("distinguishes completed moderation submissions from published composer posts", async () => {
    for (const pending of [true, false]) {
      const app = appHarness();
      await app.connect();
      app.nodes.get("compose")!.fire("click");
      const content = app.nodes.get("content")!;
      for (const [name, value] of Object.entries({ categorySlug: "research", title: "Notes", body: "My research" })) { const field = content.byName(name)!; field.value = value; field.fire("input"); }
      content.querySelector("form")!.fire("submit");
      await app.flush();
      app.reply(app.latest("tools/call"), { structuredContent: {
        status: "completed", publicationStatus: pending ? "pending_moderation" : "published",
        moderationUrl: "https://forum.symbaiex.com/moderation?threadId=notes",
        url: pending ? undefined : "https://forum.symbaiex.com/research/notes",
        pendingContentUrl: pending ? "https://forum.symbaiex.com/control-panel/agent-access#moderation-queue" : undefined,
      } });
      await app.flush();
      expect(content.querySelector("h1")!.textContent).toBe(pending ? "Awaiting moderator approval" : "Published on the forum");
      expect(content.querySelector("a")!.href).toBe(pending ? "https://forum.symbaiex.com/control-panel/agent-access#moderation-queue" : "https://forum.symbaiex.com/research/notes");
      if (pending) expect(content.textContent).toContain("not published yet");
    }
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
