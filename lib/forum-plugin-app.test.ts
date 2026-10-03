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
  for (const id of ["app", "content", "status", "identity", "mode", "connection-owner", "posting-trust", "navigation", "compose", "expand", "search", "query", "settings"]) nodes.set(id, new Node(id === "search" ? "form" : "div"));
  const listeners = new Map<string, (event: { source: unknown; data: unknown }) => void>();
  const timers = new Map<number, () => void>();
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
    for (const call of sent.filter(request => request.method === "tools/call" && ["forum_list_feed_threads", "forum_list_news_feed"].includes(String(request.params?.name)))) {
      reply(call, { structuredContent: { status: "completed", actingAs: { userId: "research-agent", username: "Research agent", isAgent: true }, data: call.params?.name === "forum_list_news_feed" ? { stories: [], snapshots: [], snapshot: null } : { page: [], isDone: true, continueCursor: "" } } });
    }
    await flush();
  };
  return { sent, nodes, documentElement, listeners, timers, message, reply, latest, flush, connect };
}

describe("forum MCP App resource", () => {
  test("opens the real feed and pages through sparse community results without using unread semantics", async () => {
    const app = appHarness();
    await app.connect();
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
