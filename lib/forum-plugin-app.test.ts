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
  checked = false;
  hidden = false;
  name = "";
  open = false;
  files: Array<{ name: string; size: number; type: string }> = [];
  href = "";
  tagName: string;
  private ownText = "";
  constructor(tag: string, private onFocus?: (node: Node) => void) { this.tagName = tag; }
  set textContent(value: string) { this.ownText = value; this.children = []; }
  get textContent(): string { return this.ownText + this.children.map(node => node.textContent).join(""); }
  append(...nodes: Node[]) { this.children.push(...nodes); }
  prepend(...nodes: Node[]) { this.children.unshift(...nodes); }
  replaceChildren(...nodes: Node[]) { this.ownText = ""; this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, callback: (event: { preventDefault(): void }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
  }
  fire(name: string) { let prevented = false; for (const listener of this.listeners.get(name) ?? []) listener({ preventDefault() { prevented = true; } }); return prevented; }
  focus() { this.onFocus?.(this); }
  reportValidity() { return true; }
  contains(node: Node | null): boolean { return node === this || this.children.some(child => child.contains(node)); }
  querySelector(selector: string): Node | null {
    const [head, ...tail] = selector.split(" ");
    const matches = (node: Node) => head.startsWith(".") ? (node.attributes.class ?? node.className).split(" ").includes(head.slice(1)) : node.tagName === head;
    for (const child of this.children) {
      if (matches(child)) { if (!tail.length) return child; const match = child.querySelector(tail.join(" ")); if (match) return match; }
      const nested = child.querySelector(selector); if (nested) return nested;
    }
    return null;
  }
  className = "";
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
function appHarness(openai?: Record<string, unknown>, initialWidth?: number) {
  const sent: Message[] = [];
  const nodes = new Map<string, Node>();
  let activeElement: Node | null = null;
  const createNode = (tag: string) => new Node(tag, node => { activeElement = node; });
  for (const id of ["app", "content", "status", "identity", "mode", "connection-owner", "posting-trust", "navigation", "forum-context", "surface-switcher", "surface-trigger", "surface-choices", "connection-details", "connection-trigger", "compose", "post-choices", "expand", "search", "search-panel", "query", "settings", "chat-messages", "chat-notice", "chat-form", "chat-body", "chat-send", "chat-older", "chat-moderation", "chat-profile", "chat-peek", "chat-toggle", "chat-panel", "chat-latest"]) nodes.set(id, createNode(id === "search" ? "form" : "div"));
  nodes.get("surface-switcher")!.append(nodes.get("surface-trigger")!, nodes.get("surface-choices")!);
  nodes.get("connection-details")!.append(nodes.get("connection-trigger")!);
  nodes.get("search-panel")!.append(createNode("summary"), nodes.get("search")!);
  const documentListeners = new Map<string, (event: { target: Node | null; key?: string; preventDefault(): void }) => void>();
  const listeners = new Map<string, (event: { source: unknown; data: unknown }) => void>();
  const timers = new Map<number, () => void>();
  const timerDurations = new Map<number, number>();
  let nextTimer = 0;
  let uuid = 0;
  const scrolls: number[] = [];
  const parent = { postMessage(message: Message) { sent.push(message); } };
  const documentElement = new Node("html");
  const searchMediaListeners = new Set<() => void>();
  const searchMedia = {
    matches: initialWidth !== undefined && initialWidth <= 680,
    addEventListener(_name: string, callback: () => void) { searchMediaListeners.add(callback); },
    removeEventListener(_name: string, callback: () => void) { searchMediaListeners.delete(callback); },
  };
  const navigationMediaListeners = new Set<() => void>();
  const navigationMedia = {
    matches: initialWidth !== undefined && initialWidth >= 1000,
    addEventListener(_name: string, callback: () => void) { navigationMediaListeners.add(callback); },
    removeEventListener(_name: string, callback: () => void) { navigationMediaListeners.delete(callback); },
  };
  const window = {
    scrollY: 0,
    scrollTo(position: { top: number }) { window.scrollY = position.top; scrolls.push(position.top); },
    ...(initialWidth === undefined ? {} : { matchMedia(query: string) { return query.includes("max-width") ? searchMedia : navigationMedia; } }),
    parent,
    openai,
    addEventListener(name: string, callback: (event: { source: unknown; data: unknown }) => void) { listeners.set(name, callback); },
    removeEventListener(name: string) { listeners.delete(name); },
  };
  const script = FORUM_PLUGIN_APP_HTML.match(/<script>([\s\S]+)<\/script>/)![1];
  runInNewContext(script, {
    window, document: {
      getElementById(id: string) { return nodes.get(id); },
      addEventListener(name: string, callback: (event: { target: Node | null; key?: string; preventDefault(): void }) => void) { documentListeners.set(name, callback); },
      removeEventListener(name: string) { documentListeners.delete(name); },
      createElement(tag: string) { return createNode(tag); },
      createElementNS(_namespace: string, tag: string) { return createNode(tag); },
      get activeElement() { return activeElement; },
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
  const connect = async (openChat = true) => {
    reply(latest("ui/initialize"), { protocolVersion: "2026-01-26", hostContext: { theme: "dark", availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline" }, hostCapabilities: { serverTools: {} } });
    await flush();
    const fullscreen = sent.find(request => request.method === "ui/request-display-mode");
    if (fullscreen) reply(fullscreen, { mode: "fullscreen" });
    await flush();
    reply(latest("tools/call"), { structuredContent: { actingAs: { userId: "research-agent", username: "Research agent", isAgent: true }, capabilities: ["read", "participate", "personal", "messages", "attachments"], executionMode: "review", policyVersion: 1, usagePolicy: { scope: "forum", monthlyLimit: null, readRequestsPerMinute: 600, writeRequestsPerMinute: 120, ownerScoped: true } } });
    await flush();
    const experienceCall = sent.find(request => request.params?.name === "forum_get_my_forum_experience");
    if (experienceCall) { reply(experienceCall, { structuredContent: { data: { defaultFeed: "discover", authorFilter: "all", mutedWords: [], followingBoards: [], followingMembers: [] } } }); await flush(); }
    for (const call of sent.filter(request => request.method === "tools/call" && ["forum_overview", "forum_list_categories", "forum_list_feed_threads", "forum_list_news_feed", "forum_list_chat_messages"].includes(String(request.params?.name)))) {
      reply(call, { structuredContent: { status: "completed", actingAs: { userId: "research-agent", username: "Research agent", isAgent: true }, data: call.params?.name === "forum_list_categories" ? [] : { page: [], pending: [], viewer: { canSend: true }, isDone: true, continueCursor: "" } } });
    }
    await flush();
    for (const preview of sent.filter(request => request.params?.name === "forum_list_chat_messages")) reply(preview, { structuredContent: { data: { page: [], pending: [], viewer: { canRead: true, canSend: true }, isDone: true } } });
    await flush();
    if (openChat) { nodes.get("chat-toggle")!.fire("click"); await flush(); }
    const chat = sent.filter(request => request.params?.name === "forum_list_chat_messages").at(-1);
    if (chat) reply(chat, { structuredContent: { data: { page: [], pending: [], viewer: { canRead: true, canSend: true }, isDone: true } } });
    await flush();
  };
  const beginPostDraft = async () => {
    nodes.get("compose")!.fire("click");
    if (nodes.get("post-choices")!.textContent.includes("Loading boards")) {
      reply(latest("tools/call"), { structuredContent: { data: [{ _id: "general", slug: "general", name: "General", isPostable: true, viewerCanCreateThread: true }] } }); await flush();
    }
    const choice = nodes.get("post-choices")!.find("General") ?? nodes.get("post-choices")!.querySelector("button");
    choice?.fire("click");
  };
  return { setScroll(top: number) { window.scrollY = top; }, scrolls, beginPostDraft, sent, nodes, documentElement, listeners, documentListeners, documentEvent(name: string, target: Node | null, key?: string) { documentListeners.get(name)?.({ target, key, preventDefault() {} }); }, timers, timerDurations, message, reply, latest, flush, connect, searchMediaListeners, navigationMediaListeners, setSearchWidth(width: number) { searchMedia.matches = width <= 680; navigationMedia.matches = width >= 1000; for (const callback of searchMediaListeners) callback(); for (const callback of navigationMediaListeners) callback(); }, get activeElement() { return activeElement; } };
}

describe("forum MCP App resource", () => {
  test("feed photos reauthorize into an internal gallery, browse locally and return without opening an external page", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Feed")!.fire("click");
    const attachments = [1,2].map(n => ({ filename: `photo-${n}.png`, altText: `Photo ${n}`, contentType: "image/png", url: `https://strong-bee-384.convex.cloud/api/storage/photo-${n}` }));
    const unsafe = [{ filename: "unsafe.svg", contentType: "image/svg+xml", url: "javascript:alert(1)" }, { filename: "tracker.png", contentType: "image/png", url: "https://tracker.example/image" }];
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "thread", title: "Photos", slug: "photos", categorySlug: "general", attachments: [...attachments, ...unsafe] }], isDone: true } } }); await app.flush();
    const grid = app.nodes.get("content")!.querySelector(".media-grid")!;
    expect(grid.children).toHaveLength(2); expect(grid.children[0].querySelector("img")!.attributes.src).toBe(attachments[0].url);
    grid.children[0].fire("click"); await app.flush();
    expect(app.latest("tools/call").params).toEqual({ name: "forum_get_thread", arguments: { categorySlug: "general", threadSlug: "photos", page: 1, pageSize: 20 } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { thread: { title: "Photos", attachments }, replies: [] } } }); await app.flush();
    const calls = app.sent.length;
    app.nodes.get("content")!.find("Next image")!.fire("click");
    expect(app.nodes.get("content")!.querySelector(".media-viewer img")!.attributes.src).toBe(attachments[1].url);
    expect(app.sent).toHaveLength(calls);
    app.nodes.get("content")!.find("Close photos")!.fire("click"); await app.flush();
    expect(app.nodes.get("app")!.dataset.view).toBe("feed"); expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });
  test("an image viewer cannot reuse preview URLs after the authorized content read removes them", async () => {
    const app = appHarness(); await app.connect(false); app.nodes.get("navigation")!.find("Feed")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ title: "Photos", slug: "photos", categorySlug: "general", attachments: [{ filename: "photo.png", contentType: "image/png", url: "https://strong-bee-384.convex.cloud/api/storage/photo" }] }], isDone: true } } }); await app.flush();
    app.nodes.get("content")!.querySelector(".media-tile")!.fire("click"); await app.flush();
    app.reply(app.latest("tools/call"), { structuredContent: { data: { thread: { title: "Photos", attachments: [] } } } }); await app.flush();
    expect(app.nodes.get("content")!.querySelector("img")).toBeNull(); expect(app.nodes.get("content")!.textContent).toContain("no longer available");
  });

  test("news discussion stays inside the sidecar and starts an exact reviewed local action", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("News")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { stories: [{ hnItemId: 123, title: "A useful story", host: "example.com" }] } } }); await app.flush();
    app.nodes.get("content")!.find("Discuss on SYMBaiEX")!.fire("click");
    expect(app.latest("tools/call").params).toEqual({ name: "forum_get_news_discussion", arguments: { hnItemId: 123 } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { story: { hnItemId: 123, title: "A useful story", url: "https://example.com/story" }, discussion: null } } }); await app.flush();
    app.nodes.get("content")!.find("Start forum discussion")!.fire("click");
    const categories = app.latest("tools/call");
    expect(categories.params?.name).toBe("forum_list_categories");
    app.reply(categories, { structuredContent: { data: [{ name: "General", slug: "general", viewerCanCreateThread: true }] } }); await app.flush();
    const form = app.nodes.get("content")!.querySelector("form")!; form.byName("categorySlug")!.value = "general";
    form.byName("body")!.value = "Here is why it matters"; form.byName("body")!.fire("input"); form.fire("submit"); await app.flush();
    const command = app.latest("tools/call");
    expect(command.params?.name).toBe("forum_create_news_discussion");
    expect(command.params?.arguments).toMatchObject({ hnItemId: 123, categorySlug: "general", body: "Here is why it matters" });
    expect(command.params?.arguments).not.toHaveProperty("title");
    expect(validateForumPluginArguments(findForumPluginTool("forum_create_news_discussion")!, command.params?.arguments)).toBeNull();
    app.reply(command, { structuredContent: { status: "pending_approval", commandId: "news-proposal" } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("Awaiting owner review");
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });

  test("an existing news discussion opens its exact forum route without creating another", async () => {
    const app = appHarness(); await app.connect(false);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { "openai/deepLink": { url: "/news/story-123" } } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { story: { hnItemId: 123, title: "Story" }, discussion: { categorySlug: "general", threadSlug: "story", status: "active" } } } }); await app.flush();
    app.nodes.get("content")!.find("Open forum discussion")!.fire("click");
    expect(app.latest("tools/call").params).toEqual({ name: "forum_get_thread", arguments: { categorySlug: "general", threadSlug: "story", page: 1, pageSize: 20 } });
    expect(app.sent.some(call => call.params?.name === "forum_create_news_discussion" || call.method === "ui/open-link")).toBe(false);
  });

  test("lounge replies and mentions preserve parent attribution and reviewed read markers stay uncommitted", async () => {
    const app = appHarness(); await app.connect();
    app.nodes.get("chat-latest")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "message", status: "active", body: "Thoughts?", authorIdentity: { username: "suki", isAgent: true }, replyTo: { _id: "older", body: "An earlier thought" } }], viewer: { canRead: true, canSend: true }, unreadCount: 3, mentionCount: 1, unreadLimited: true, isDone: true } } }); await app.flush();
    const rows = app.nodes.get("chat-messages")!;
    expect(rows.textContent).toContain("An earlier thought");
    rows.find("Reply")!.fire("click"); rows.find("Mention")!.fire("click");
    expect(app.nodes.get("chat-form")!.textContent).toContain("Replying to suki");
    expect(app.nodes.get("chat-body")!.value).toBe("@suki ");
    app.nodes.get("chat-body")!.value += "Thanks"; app.nodes.get("chat-body")!.fire("input"); app.nodes.get("chat-form")!.fire("submit"); await app.flush();
    const command = app.latest("tools/call");
    expect(command.params?.name).toBe("forum_send_chat_message"); expect(command.params?.arguments).toMatchObject({ body: "@suki Thanks", replyToId: "message" });
    expect(validateForumPluginArguments(findForumPluginTool("forum_send_chat_message")!, command.params?.arguments)).toBeNull();
    app.reply(command, { structuredContent: { status: "pending_approval" } }); await app.flush();
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "message", status: "active", body: "Thoughts?", authorIdentity: { username: "suki" } }], viewer: { canRead: true, canSend: true }, unreadCount: 3, mentionCount: 1, isDone: true } } }); await app.flush();
    expect(app.nodes.get("chat-notice")!.textContent).toContain("Queued for owner review; not sent yet");
    const read = app.nodes.get("chat-panel")!.find("Mark lounge read")!; read.fire("click"); await app.flush();
    expect(app.latest("tools/call").params?.name).toBe("forum_mark_chat_read"); expect(app.latest("tools/call").params?.arguments).toMatchObject({ messageId: "message" });
    app.reply(app.latest("tools/call"), { structuredContent: { status: "pending_approval" } }); await app.flush();
    expect(app.nodes.get("chat-panel")!.textContent).toContain("3 unread"); expect(read.textContent).toBe("Awaiting review");
  });

  test("published lounge messages promote to an attributed thread using only selected message IDs", async () => {
    const app = appHarness(); await app.connect();
    app.nodes.get("chat-latest")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "message", status: "active", body: "A useful idea", authorIdentity: { username: "suki" } }], pending: [{ _id: "unpublished", status: "pending", body: "Unpublished idea" }], viewer: { canRead: true, canSend: true }, isDone: true } } }); await app.flush();
    const rows = app.nodes.get("chat-messages")!; rows.find("Start thread")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: [{ name: "General", slug: "general", viewerCanCreateThread: true }] } }); await app.flush();
    const content = app.nodes.get("content")!;
    expect(content.textContent).toContain("suki: A useful idea");
    const form = content.querySelector("form")!; form.byName("categorySlug")!.value = "general"; form.fire("submit"); await app.flush();
    const command = app.latest("tools/call");
    expect(command.params?.name).toBe("forum_create_thread_from_chat");
    expect(command.params?.arguments).toMatchObject({ categorySlug: "general", title: "A useful idea", messageIds: ["message"] });
    expect(command.params?.arguments).not.toHaveProperty("body"); expect(command.params?.arguments).not.toHaveProperty("attachments");
    expect(validateForumPluginArguments(findForumPluginTool("forum_create_thread_from_chat")!, command.params?.arguments)).toBeNull();
  });

  test("shared conversation starters seed the exact question draft without submitting", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Find your communities")!.fire("click");
    for (const call of app.sent.filter(call => call.method === "tools/call").slice(-2)) app.reply(call, { structuredContent: { data: call.params?.name === "forum_list_categories" ? [{ _id: "general", name: "General", slug: "general", viewerCanCreateThread: true }] : { followingBoards: [], onboardingCompleted: true } } });
    await app.flush(); app.nodes.get("content")!.find("Ask for help")!.fire("click");
    const form = app.nodes.get("content")!.querySelector("form")!;
    expect(form.byName("kind")!.value).toBe("question"); expect(form.byName("categorySlug")!.value).toBe("general");
    expect(form.byName("body")!.value).toBe("What I'm trying to do:\n\nWhat I've tried:\n\nWhere I'm stuck:\n");
    expect(app.sent.some(call => call.params?.name === "forum_create_thread")).toBe(false);
    app.nodes.get("content")!.find("Close draft")!.fire("click");
    expect(app.nodes.get("content")!.find("Discard draft")).toBeDefined();
  });

  test("personal launch reads saved feed defaults without overwriting navigation during the read", async () => {
    const app = appHarness();
    app.reply(app.latest("ui/initialize"), { protocolVersion: "2026-01-26", hostContext: {} }); await app.flush();
    app.reply(app.latest("tools/call"), { structuredContent: { actingAs: { userId: "owner", username: "Owner" }, data: { capabilities: ["read", "personal"], executionMode: "direct", policyVersion: 1 } } }); await app.flush();
    const preferences = app.latest("tools/call");
    expect(preferences.params?.name).toBe("forum_get_my_forum_experience");
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    const boards = app.latest("tools/call");
    app.reply(boards, { structuredContent: { data: [{ name: "General", slug: "general" }] } }); await app.flush();
    app.reply(preferences, { structuredContent: { data: { defaultFeed: "following", authorFilter: "humans" } } }); await app.flush();
    expect(app.nodes.get("app")!.dataset.view).toBe("boards");
    expect(app.latest("tools/call")).toBe(boards);
    expect(app.sent.some(call => call.params?.name === "forum_list_feed_threads")).toBe(false);
  });

  test("personal feed defaults select following and AI agents at launch", async () => {
    const app = appHarness();
    app.reply(app.latest("ui/initialize"), { protocolVersion: "2026-01-26", hostContext: {} }); await app.flush();
    app.reply(app.latest("tools/call"), { structuredContent: { actingAs: { userId: "owner" }, data: { capabilities: ["read", "personal"], policyVersion: 1 } } }); await app.flush();
    app.reply(app.latest("tools/call"), { structuredContent: { data: { defaultFeed: "following", authorFilter: "agents" } } }); await app.flush();
    expect(app.latest("tools/call").params).toEqual({ name: "forum_list_feed_threads", arguments: { sort: "active", scope: "following", authorFilter: "agents", communityOnly: false, now: expect.any(Number), paginationOpts: { numItems: 12, cursor: null } } });
  });

  test("feed selection survives sort, pagination, refresh and Back while switching filters drops old rows", async () => {
    const app = appHarness(); await app.connect(false);
    const content = app.nodes.get("content")!;
    content.find("Unanswered")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], isDone: true } } }); await app.flush();
    content.byName("authorFilter")!.value = "humans"; content.byName("authorFilter")!.fire("change");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], isDone: true } } }); await app.flush();
    content.find("Following feed")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ sort: "unanswered", scope: "following", authorFilter: "humans" });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "one", title: "Followed question", kind: "question", categorySlug: "general", slug: "question" }], isDone: false, continueCursor: "following-cursor" } } }); await app.flush();
    content.find("Load more discussions")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ sort: "unanswered", scope: "following", authorFilter: "humans", paginationOpts: { cursor: "following-cursor" } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "two", title: "Another question", kind: "question", categorySlug: "general", slug: "another" }], isDone: true } } }); await app.flush();
    app.setScroll(640);
    content.find("Another question")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { thread: { _id: "two", title: "Another question" }, replies: [] } } }); await app.flush();
    content.find("← Back")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ scope: "following", authorFilter: "humans", sort: "unanswered", paginationOpts: { cursor: "following-cursor" } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], isDone: true } } }); await app.flush();
    expect(content.textContent).toContain("Followed question");
    expect(app.scrolls.at(-1)).toBe(640);
    content.find("Refresh")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ scope: "following", authorFilter: "humans", sort: "unanswered", paginationOpts: { cursor: null } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], isDone: true } } }); await app.flush();
    content.find("Discover")!.fire("click");
    expect(content.textContent).not.toContain("Followed question");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ scope: "discover", authorFilter: "humans", sort: "unanswered", paginationOpts: { cursor: null } });
  });

  test("catch up renders real unread, saved and pending status without offering delegated approval", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Catch up & interests")!.fire("click");
    const catchUp = app.sent.filter(call => call.params?.name === "forum_list_my_forum_catch_up").at(-1)!;
    expect(catchUp.params).toEqual({ name: "forum_list_my_forum_catch_up", arguments: { limit: 24 } });
    for (const call of app.sent.filter(call => call.method === "tools/call").slice(-2)) app.reply(call, { structuredContent: { data: call.params?.name === "forum_list_categories" ? [] : { followingBoards: [] } } });
    app.reply(catchUp, { structuredContent: { data: { threads: [{ title: "Unread topic", categorySlug: "general", slug: "unread" }], saved: [{ title: "Saved topic", categorySlug: "general", slug: "saved" }], pending: [{ title: "Unpublished topic", type: "thread", excerpt: "Waiting" }], summary: { unread: 1, saved: 1, pending: 1 }, bounded: true } } }); await app.flush();
    const content = app.nodes.get("content")!;
    expect(content.textContent).toContain("Unread topic"); expect(content.textContent).toContain("Saved topic");
    expect(content.textContent).toContain("Unpublished topicPending moderation");
    expect(content.find("Approve")).toBeUndefined(); expect(content.find("Unpublished topic")).toBeUndefined();
    expect(content.textContent).toContain("recent selection");
  });

  test("starter board follows use desired states and leave review proposals unexecuted", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Find your communities")!.fire("click");
    const calls = app.sent.filter(call => call.method === "tools/call").slice(-2);
    for (const call of calls) app.reply(call, { structuredContent: { data: call.params?.name === "forum_list_categories" ? [{ _id: "general", slug: "general", name: "General", description: "Meet the community" }] : { followingBoards: [], authorFilter: "all", defaultFeed: "discover", onboardingCompleted: false } } });
    await app.flush();
    app.nodes.get("content")!.find("Follow board")!.fire("click"); await app.flush();
    expect(app.latest("tools/call").params?.name).toBe("forum_set_category_subscription");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ categorySlug: "general", subscribed: true, expectedPolicyVersion: 1 });
    app.reply(app.latest("tools/call"), { structuredContent: { status: "pending_approval", commandId: "follow-proposal" } }); await app.flush();
    expect(app.nodes.get("content")!.find("Awaiting review")).toBeDefined();
    expect(app.nodes.get("content")!.find("Unfollow board")).toBeUndefined();
    expect(app.sent.some(call => /approve/.test(String(call.params?.name)))).toBe(false);
  });

  test("typed link posts preserve source, reject unsafe URLs and preserve pending publication truth", async () => {
    const app = appHarness(); await app.connect(false); await app.beginPostDraft();
    const content = app.nodes.get("content")!; const form = content.querySelector("form")!;
    form.byName("kind")!.value = "link"; form.byName("kind")!.fire("change");
    for (const [name, value] of Object.entries({ title: "Useful source", body: "Why this matters", sourceUrl: "javascript:alert(1)" })) { form.byName(name)!.value = value; form.byName(name)!.fire("input"); }
    const before = app.sent.length; form.fire("submit"); await app.flush();
    expect(app.sent.length).toBe(before); expect(app.nodes.get("status")!.textContent).toContain("HTTP or HTTPS");
    form.byName("sourceUrl")!.value = "https://example.com/article"; form.byName("sourceUrl")!.fire("input"); form.fire("submit"); await app.flush();
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ kind: "link", sourceUrl: "https://example.com/article", title: "Useful source", body: "Why this matters" });
    app.reply(app.latest("tools/call"), { structuredContent: { status: "completed", publicationStatus: "pending_moderation", pendingContentUrl: "https://forum.symbaiex.com/control-panel/agent-access#moderation-queue" } }); await app.flush();
    expect(content.textContent).toContain("Awaiting moderator approval"); expect(content.textContent).not.toContain("Published on the forum");
  });

  test("contextual replies retain their parent and return to the discussion after a receipt", async () => {
    const app = appHarness(); await app.connect(false);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "question" } } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { thread: { _id: "thread", title: "Question", kind: "question", body: "How?" }, replies: [{ _id: "parent", author: "Suki", body: "Try this", postNumber: 2 }] } } }); await app.flush();
    const content = app.nodes.get("content")!; content.find("Reply to Suki")!.fire("click");
    expect(content.textContent).toContain("Replying to SukiTry this");
    content.byName("body")!.value = "Thank you"; content.byName("body")!.fire("input"); content.querySelector("form")!.fire("submit"); await app.flush();
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ threadId: "thread", parentPostId: "parent", body: "Thank you" });
    app.reply(app.latest("tools/call"), { structuredContent: { status: "completed", publicationStatus: "published" } }); await app.flush();
    content.find("Back to discussion")!.fire("click");
    expect(app.latest("tools/call").params).toEqual({ name: "forum_get_thread", arguments: { categorySlug: "general", threadSlug: "question", page: 1, pageSize: 20 } });
  });

  test("accepted answers require current reader authority and review does not mark them accepted", async () => {
    const app = appHarness(); await app.connect(false);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "question" } } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { thread: { _id: "thread", title: "Question", kind: "question", viewerCanAcceptAnswer: true }, replies: [{ _id: "answer", author: "Suki", body: "An answer" }] } } }); await app.flush();
    const content = app.nodes.get("content")!; content.find("Accept answer")!.fire("click"); await app.flush();
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ threadId: "thread", postId: "answer" });
    app.reply(app.latest("tools/call"), { structuredContent: { status: "pending_approval" } }); await app.flush();
    expect(content.textContent).not.toContain("Accepted answer"); expect(content.find("Remove accepted answer")).toBeUndefined();
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "question" } } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { thread: { _id: "thread", title: "Question", kind: "question", acceptedPostId: "answer", viewerCanAcceptAnswer: false }, replies: [{ _id: "answer", author: "Suki", body: "An answer" }] } } }); await app.flush();
    expect(content.textContent).toContain("Accepted answer"); expect(content.find("Accept answer")).toBeUndefined(); expect(content.find("Remove accepted answer")).toBeUndefined();
  });

  test("muted phrase editor sends a deduplicated array and retains retry identity", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("content")!.find("Feed preferences")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { defaultFeed: "discover", authorFilter: "all", mutedWords: ["spam"], followingMembers: [] } } }); await app.flush();
    app.nodes.get("content")!.find("Edit muted phrases")!.fire("click");
    const form = app.nodes.get("content")!.querySelector("form")!; form.byName("mutedWords")!.value = "spam\nnoise\nnoise\n "; form.byName("mutedWords")!.fire("input"); form.fire("submit"); await app.flush();
    const command = app.latest("tools/call");
    expect(command.params?.arguments).toMatchObject({ mutedWords: ["spam", "noise"], mutedUntil: null });
    app.reply(command, { isError: true, structuredContent: { error: "Temporary failure" } }); await app.flush(); form.fire("submit"); await app.flush();
    expect(app.latest("tools/call").params?.arguments).toEqual(command.params?.arguments);
  });

  test("member links stay in the sidecar and Back restores the directory", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Members & agents")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { members: [{ username: "suki", displayName: "Suki", postCount: 12, threadCount: 4 }] } } }); await app.flush();
    app.nodes.get("content")!.querySelector("a")!.fire("click");
    expect(app.latest("tools/call").params).toEqual({ name: "forum_list_members", arguments: { query: "suki", pageSize: 100, page: 1 } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { members: [{ username: "suki", displayName: "Suki", postCount: 12, threadCount: 4, location: "Online" }] } } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("12 posts · 4 discussions");
    expect(app.nodes.get("content")!.find("Send message")).toBeDefined();
    app.nodes.get("content")!.find("← Back")!.fire("click");
    expect(app.latest("tools/call").params?.name).toBe("forum_list_members");
    expect(app.latest("tools/call").params?.arguments).toEqual({ limit: 30 });
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });

  test("help summaries open the full document internally", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Help & rules")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: [{ title: "Forum rules", slug: "rules", excerpt: "Short summary" }] } }); await app.flush();
    app.nodes.get("content")!.find("Read help")!.fire("click");
    expect(app.latest("tools/call").params).toEqual({ name: "forum_get_help_document", arguments: { slug: "rules" } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { title: "Forum rules", body: "[b]Full rules[/b]" } } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("Full rules");
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });

  test("profile editing preserves profile fields and reuses unchanged retry keys", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("My profile")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { bio: "Old bio", birthday: "2000-01-01", signature: "Signature", showSignatures: true } } }); await app.flush();
    app.nodes.get("content")!.find("Edit profile")!.fire("click");
    const form = app.nodes.get("content")!.querySelector("form")!;
    const bio = form.byName("bio")!; bio.value = "New bio"; bio.fire("input");
    form.fire("submit"); await app.flush();
    const first = app.latest("tools/call");
    expect(first.params?.name).toBe("forum_update_my_forum_profile");
    expect(first.params?.arguments).toMatchObject({ bio: "New bio", birthday: "2000-01-01", signature: "Signature", showSignatures: true, expectedPolicyVersion: 1 });
    expect(validateForumPluginArguments(findForumPluginTool("forum_update_my_forum_profile")!, first.params?.arguments)).toBeNull();
    app.reply(first, { isError: true, structuredContent: { error: "Temporary failure" } }); await app.flush();
    form.fire("submit"); await app.flush();
    expect(app.latest("tools/call").params?.arguments).toEqual(first.params?.arguments);
    expect(bio.value).toBe("New bio");
    app.reply(app.latest("tools/call"), { structuredContent: { status: "completed", data: {} } }); await app.flush();
    expect(app.latest("tools/call").params?.name).toBe("forum_get_my_forum_profile");
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });

  test("notification preferences use desired states and queue review without approving", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.querySelector("a")!;
    const account = app.nodes.get("navigation")!.children[1].querySelector(".secondary-navigation")!;
    const findLink = (node: Node): Node | undefined => node.tagName === "a" && node.textContent === "Account & preferences" ? node : node.children.map(findLink).find(Boolean);
    findLink(account)!.fire("click");
    expect(app.latest("tools/call").params?.name).toBe("forum_get_my_forum_notification_preferences");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { inAppReplies: true, inAppMentions: true, emailReplies: false } } }); await app.flush();
    app.nodes.get("content")!.find("Edit notifications")!.fire("click");
    const form = app.nodes.get("content")!.querySelector("form")!;
    form.byName("emailReplies")!.checked = true; form.byName("emailReplies")!.fire("change");
    form.fire("submit"); await app.flush();
    const command = app.latest("tools/call");
    expect(command.params?.name).toBe("forum_update_my_forum_notification_preferences");
    expect(command.params?.arguments).toMatchObject({ inAppReplies: true, inAppMentions: true, emailReplies: true, inAppNewThreads: false, emailNewThreads: false });
    expect(validateForumPluginArguments(findForumPluginTool("forum_update_my_forum_notification_preferences")!, command.params?.arguments)).toBeNull();
    app.reply(command, { structuredContent: { status: "pending_approval", commandId: "queued", approvalUrl: "https://forum.symbaiex.com/control-panel/agent-access?commandId=queued#review-queue" } }); await app.flush();
    expect(app.latest("tools/call").params?.name).toBe("forum_status");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { capabilities: ["personal"], policyVersion: 1 } } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("Only the signed-in human owner can approve");
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
    expect(app.sent.some(call => /approve|policy|consent/.test(String(call.params?.name)))).toBe(false);
  });

  test("post editing uses the selected post and preserves the draft across policy reductions", async () => {
    const app = appHarness(); await app.connect(false);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "reader" } } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { thread: { _id: "thread-1", title: "Reader", body: "Original", viewerCanEdit: true, attachments: [{ storageId: "file", filename: "notes.txt" }] }, replies: { page: [] } } } }); await app.flush();
    app.nodes.get("content")!.find("Edit")!.fire("click");
    const form = app.nodes.get("content")!.querySelector("form")!;
    form.byName("body")!.value = "Changed body"; form.byName("body")!.fire("input");
    form.fire("submit"); await app.flush();
    const command = app.latest("tools/call");
    expect(command.params?.name).toBe("forum_update_thread_content");
    expect(command.params?.arguments).toMatchObject({ threadId: "thread-1", title: "Reader", body: "Changed body" });
    expect(command.params?.arguments).not.toHaveProperty("attachmentIdsToKeep");
    expect(command.params?.arguments).not.toHaveProperty("attachments");
    expect(validateForumPluginArguments(findForumPluginTool("forum_update_thread_content")!, command.params?.arguments)).toBeNull();
    app.reply(command, { isError: true, structuredContent: { error: "Retry later" } }); await app.flush();
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: { userId: "research-agent" }, data: { capabilities: ["read"], policyVersion: 2 } } } });
    const before = app.sent.length;
    form.fire("submit"); await app.flush();
    expect(app.sent.length).toBe(before);
    expect(form.byName("body")!.value).toBe("Changed body");
    expect(app.nodes.get("status")!.textContent).toContain("permissions changed");
    expect(app.nodes.get("content")!.find("Cancel")).toBeDefined();
  });

  test("canonical links in a post navigate through authorized tools without opening a browser", async () => {
    const app = appHarness(); await app.connect(false);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "reader" } } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { thread: { _id: "thread-1", title: "Reader", body: "[url=https://forum.symbaiex.com/another-board/sources?page=2]Related discussion[/url]" }, replies: { page: [] } } } }); await app.flush();
    app.nodes.get("content")!.querySelector(".post-content a")!.fire("click");
    expect(app.latest("tools/call").params).toEqual({ name: "forum_get_thread", arguments: { categorySlug: "another-board", threadSlug: "sources", page: 2, pageSize: 20 } });
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });

  test("host deep links select internal routes and cannot navigate external URLs or discard drafts", async () => {
    const app = appHarness(); await app.connect(false);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { "openai/deepLink": { url: "/general/sources?page=2" } } });
    expect(app.latest("tools/call").params).toEqual({ name: "forum_get_thread", arguments: { categorySlug: "general", threadSlug: "sources", page: 2, pageSize: 20 } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { thread: { _id: "sources", title: "Sources", body: "Sources" }, replies: { page: [] } } } }); await app.flush();
    const before = app.sent.length;
    app.message({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { "openai/deepLink": { url: "//malicious.example/general" } } });
    expect(app.sent.length).toBe(before);
    app.nodes.get("content")!.find("Reply")!.fire("click");
    const body = app.nodes.get("content")!.byName("body")!; body.value = "Preserve this draft"; body.fire("input");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { "openai/deepLink": { url: "/help/rules" } } });
    expect(app.nodes.get("content")!.byName("body")).toBe(body);
    expect(app.nodes.get("status")!.textContent).toContain("Close or submit your draft");
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });

  test("guest account navigation explains connection inside the sidecar", async () => {
    const app = appHarness(); await app.connect(false);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: null, data: { capabilities: ["read"] } } } });
    const findLink = (node: Node): Node | undefined => node.tagName === "a" && node.textContent === "Account & preferences" ? node : node.children.map(findLink).find(Boolean);
    findLink(app.nodes.get("navigation")!)!.fire("click");
    expect(app.latest("tools/call").params?.name).toBe("forum_status");
    app.reply(app.latest("tools/call"), { structuredContent: { actingAs: null, data: { capabilities: ["read"] } } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("Connect your SYMBaiEX account through this plugin");
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });

  test("launch board navigation matches the website groups and selects a parent while reading a sub-board", async () => {
    const app = appHarness(undefined, 1280); await app.connect(false);
    const overview = app.sent.find(call => call.params?.name === "forum_overview")!;
    // A completed launch overview normally arrives before or alongside Feed.
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: [
      { _id: "section", slug: "community", name: "Community", kind: "section" },
      { _id: "general", slug: "general", name: "General", parentCategoryId: "section" },
      { _id: "child", slug: "support", name: "Support", parentCategoryId: "general" },
    ] } }); await app.flush();
    const nav = app.nodes.get("navigation")!;
    expect(overview).toBeDefined();
    expect(nav.textContent).toContain("Your spaceCatch up & interestsSaved threadsFollowingInboxAgent access");
    expect(nav.textContent).toContain("CommunityFind your communitiesMembers & agentsAnnouncementsCalendarHelp & rules");
    expect(nav.find("GGeneral")).toBeDefined();
    expect(nav.find("SSupport")).toBeUndefined();
    app.nodes.get("content")!.find("Support")!.fire("click");
    expect(nav.find("GGeneral")!.attributes["aria-current"]).toBe("page");
    expect(nav.find("Boards")!.attributes["aria-current"]).toBe("page");
    expect(nav.find("Browse all boards")!.attributes["aria-current"]).toBe("false");
  });

  test("Following and individual resources call the matching forum operations", async () => {
    const app = appHarness(); await app.connect(false);
    for (const [label, name] of [["Following", "forum_list_my_thread_subscriptions"], ["Announcements", "forum_list_announcements"], ["Calendar", "forum_list_calendar_events"], ["Help & rules", "forum_list_help_documents"], ["Who’s online", "forum_list_online_members"], ["Today’s posts", "forum_list_recent_threads"]]) {
      const count = app.sent.filter(call => call.method === "tools/call").length;
      app.nodes.get("navigation")!.find(label)!.fire("click"); await app.flush();
      const calls = app.sent.filter(call => call.method === "tools/call").slice(count);
      expect(calls.map(call => call.params?.name)).toEqual([name]);
      expect(validateForumPluginArguments(findForumPluginTool(name)!, calls[0].params?.arguments)).toBeNull();
      if (label === "Today’s posts") expect(calls[0].params?.arguments).toMatchObject({ mode: "today" });
      app.reply(calls[0], { structuredContent: { data: [] } }); await app.flush();
    }
  });

  test("header post picker only offers writable boards and restores board filters when a draft closes", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: [
      { _id: "general", slug: "general", name: "General", isPostable: true, viewerCanCreateThread: true },
      { _id: "locked", slug: "locked", name: "Restricted", viewerCanCreateThread: false },
      { _id: "section", slug: "section", name: "Section", kind: "section" },
    ] } }); await app.flush();
    app.nodes.get("navigation")!.find("GGeneral")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { category: { slug: "general", name: "General", viewerCanCreateThread: true }, threads: [] } } }); await app.flush();
    const filters = app.nodes.get("content")!.querySelector("form")!;
    filters.byName("sortKey")!.value = "replies"; filters.byName("sortOrder")!.value = "asc"; filters.byName("days")!.value = "7";
    filters.fire("submit");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ categorySlug: "general", sortKey: "replies", sortOrder: "asc", days: 7, page: 1 });
    expect(validateForumPluginArguments(findForumPluginTool("forum_list_threads")!, app.latest("tools/call").params?.arguments)).toBeNull();
    app.reply(app.latest("tools/call"), { structuredContent: { data: { category: { slug: "general", name: "General", viewerCanCreateThread: true }, threads: [] } } }); await app.flush();
    app.nodes.get("compose")!.fire("click");
    const picker = app.nodes.get("post-choices")!;
    expect(picker.hidden).toBe(false); expect(picker.find("Restricted")).toBeUndefined(); expect(picker.find("Section")).toBeUndefined();
    picker.find("General")!.fire("click");
    expect(picker.hidden).toBe(true); expect(app.nodes.get("compose")!.attributes["aria-expanded"]).toBe("false");
    expect(app.nodes.get("content")!.byName("categorySlug")!.value).toBe("general");
    app.nodes.get("content")!.find("Close draft")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ categorySlug: "general", sortKey: "replies", sortOrder: "asc", days: 7 });
  });

  test("card display changes without a read request and failed load-more retains loaded discussions", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Feed")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "one", title: "First discussion", slug: "first", categorySlug: "general" }], isDone: false, continueCursor: "next" } } }); await app.flush();
    const count = app.sent.length;
    app.nodes.get("content")!.find("Compact view")!.fire("click");
    expect(app.nodes.get("app")!.dataset.feedDisplay).toBe("compact"); expect(app.sent).toHaveLength(count);
    app.nodes.get("content")!.find("Load more discussions")!.fire("click");
    expect(app.nodes.get("content")!.textContent).toContain("First discussion");
    app.reply(app.latest("tools/call"), { isError: true, structuredContent: { error: "Temporary read failure" } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("First discussion");
    app.nodes.get("content")!.find("Try again")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "one", title: "First discussion", slug: "first", categorySlug: "general" }, { _id: "two", title: "Second discussion", slug: "second", categorySlug: "general" }], isDone: true } } }); await app.flush();
    const text = app.nodes.get("content")!.textContent;
    expect(text.split("First discussion")).toHaveLength(2); expect(text).toContain("Second discussion");
    expect(app.nodes.get("app")!.dataset.feedDisplay).toBe("compact");
  });

  test("timeline is the default and its post entry opens the existing board composer with the chosen intent", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Boards")!.fire("click"); await app.flush();
    app.reply(app.latest("tools/call"), { structuredContent: { data: { categories: [{ _id: "general", slug: "general", name: "General", isPostable: true, viewerCanCreateThread: true }] } } }); await app.flush();
    app.nodes.get("navigation")!.find("Feed")!.fire("click"); await app.flush();
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], isDone: true } } }); await app.flush();
    expect(app.nodes.get("app")!.dataset.feedDisplay).toBe("timeline");
    app.nodes.get("content")!.find("Ask a question")!.fire("click");
    expect(app.nodes.get("content")!.byName("categorySlug")!.value).toBe("general");
    expect(app.nodes.get("content")!.byName("kind")!.value).toBe("question");
    expect(app.nodes.get("content")!.find("Submit for review")).toBeDefined();
  });

  test("timeline Save uses a desired state and leaves reviewed actions visibly queued", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Feed")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "one", title: "First discussion", slug: "first", categorySlug: "general", viewerBookmarked: false }], isDone: true } } }); await app.flush();
    const save = app.nodes.get("content")!.find("Save")!;
    save.fire("click"); await app.flush();
    expect(app.latest("tools/call").params).toMatchObject({ name: "forum_set_thread_bookmark", arguments: { threadId: "one", saved: true, expectedPolicyVersion: 1, idempotencyKey: expect.any(String) } });
    app.reply(app.latest("tools/call"), { structuredContent: { status: "pending_approval", reviewUrl: "https://forum.symbaiex.com/control-panel/agent-access" } }); await app.flush();
    expect(save.textContent).toBe("Awaiting review");
    expect(app.nodes.get("content")!.textContent).toContain("First discussion");
  });

  test("feed settings closes with Escape and outside click and restores keyboard focus", async () => {
    const app = appHarness(); await app.connect(false);
    const menu = app.nodes.get("content")!.querySelector(".feed-settings")!;
    const trigger = menu.firstElementChild!;
    menu.open = true; menu.find("Feed preferences")!.focus();
    app.documentEvent("keydown", app.activeElement, "Escape");
    expect(menu.open).toBe(false); expect(app.activeElement).toBe(trigger);
    menu.open = true; app.documentEvent("pointerdown", app.nodes.get("identity")!);
    expect(menu.open).toBe(false);
  });

  test("delayed launch metadata cannot restore a prior actor's board rail", async () => {
    const app = appHarness();
    app.reply(app.latest("ui/initialize"), { protocolVersion: "2026-01-26", hostContext: { theme: "dark" } }); await app.flush();
    app.reply(app.latest("tools/call"), { structuredContent: { actingAs: { userId: "owner-a", username: "Owner A" }, data: { capabilities: ["read", "participate"], policyVersion: 1 } } }); await app.flush();
    const oldOverview = app.sent.find(call => call.params?.name === "forum_overview")!;
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: { userId: "owner-b", username: "Owner B" }, data: { capabilities: ["read"], policyVersion: 2 } } } });
    app.reply(oldOverview, { structuredContent: { data: { categories: [{ _id: "old", name: "Old private board", slug: "private" }] } } }); await app.flush();
    expect(app.nodes.get("navigation")!.textContent).not.toContain("Old private board");
    expect(app.nodes.get("identity")!.textContent).toContain("Owner B");
    expect(app.nodes.get("post-choices")!.hidden).toBe(true);
  });

  test("closing a draft after policy changes cannot restore cached restricted feed rows or a prior cursor", async () => {
    for (const nextActor of ["research-agent", "new-owner"]) {
      const app = appHarness(); await app.connect(false);
      app.nodes.get("navigation")!.find("Feed")!.fire("click");
      app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "private", title: "Restricted old profile discussion", slug: "private", categorySlug: "restricted" }], isDone: false, continueCursor: "old-owner-cursor" } } }); await app.flush();
      app.nodes.get("content")!.find("Load more discussions")!.fire("click");
      app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "second", title: "Second old discussion", slug: "second", categorySlug: "general" }], isDone: true } } }); await app.flush();
      await app.beginPostDraft();
      const body = app.nodes.get("content")!.byName("body")!; body.value = "Preserved unsent editor"; body.fire("input");
      app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: { userId: nextActor, username: "Current profile" }, data: { capabilities: ["read"], policyVersion: 2 } } } });
      expect(body.value).toBe("Preserved unsent editor");
      app.nodes.get("content")!.find("Close draft")!.fire("click"); app.nodes.get("content")!.find("Discard draft")!.fire("click");
      expect(app.latest("tools/call").params?.arguments).toMatchObject({ paginationOpts: { cursor: null } });
      expect(app.nodes.get("content")!.textContent).not.toContain("old profile discussion");
      app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ _id: "fresh", title: "Current profile discussion", slug: "fresh", categorySlug: "general" }], isDone: true } } }); await app.flush();
      expect(app.nodes.get("content")!.textContent).toContain("Current profile discussion");
      expect(app.nodes.get("content")!.textContent).not.toContain("Restricted old"); expect(app.nodes.get("content")!.textContent).not.toContain("Second old");
    }
  });

  test("post picker Escape restores trigger focus and mobile navigation cannot discard a draft", async () => {
    const app = appHarness(undefined, 390); await app.connect(false);
    await app.beginPostDraft();
    const body = app.nodes.get("content")!.byName("body")!; body.value = "Keep my reply"; body.fire("input");
    app.nodes.get("navigation")!.find("News")!.fire("click");
    expect(app.nodes.get("content")!.byName("body")).toBe(body); expect(body.value).toBe("Keep my reply");
    app.nodes.get("content")!.find("Close draft")!.fire("click"); expect(body.value).toBe("Keep my reply");
    app.nodes.get("content")!.find("Discard draft")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], isDone: true } } }); await app.flush();
    app.nodes.get("compose")!.fire("click"); app.nodes.get("post-choices")!.find("General")!.focus();
    app.documentEvent("keydown", app.activeElement, "Escape");
    expect(app.nodes.get("post-choices")!.hidden).toBe(true); expect(app.activeElement).toBe(app.nodes.get("compose"));
  });

  test("surface links wait for the host handshake before opening an external site", () => {
    const app = appHarness();
    expect(app.nodes.get("surface-choices")!.children[0].fire("click")).toBe(true);
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
    expect(app.nodes.get("status")!.textContent).toContain("Connecting to the host");
  });

  test("the unified logo switcher opens Blog through the host and selects the embedded Forum feed", async () => {
    const app = appHarness(); await app.connect(false);
    const choices = app.nodes.get("surface-choices")!;
    const [blog, forum, nativeForum] = choices.children;
    expect(blog.attributes["aria-label"]).toBe("Blog");
    expect(blog.href).toBe("https://www.symbaiex.com");
    expect(blog.textContent).toContain("Articles, research & news");
    expect(forum.attributes).toMatchObject({ "aria-label": "Forum", "aria-current": "page" });
    expect(forum.textContent).toContain("Conversations & communityCurrent");
    expect(nativeForum.textContent).toBe("Open forum website ↗");
    app.nodes.get("surface-switcher")!.open = true;
    blog.fire("click");
    expect(app.latest("ui/open-link").params).toEqual({ url: "https://www.symbaiex.com" });
    expect(app.nodes.get("surface-switcher")!.open).toBe(false);
    forum.fire("click");
    expect(app.latest("tools/call").params?.name).toBe("forum_list_feed_threads");
    expect(app.sent.some(call => /create|send|approve/.test(String(call.params?.name)))).toBe(false);
  });

  test("the logo switcher preserves a draft and dismisses with Escape, outside click and focus leave", async () => {
    const app = appHarness(undefined, 390); await app.connect(false);
    await app.beginPostDraft();
    const body = app.nodes.get("content")!.byName("body")!;
    body.value = "Keep this unsent draft"; body.fire("input");
    const panel = app.nodes.get("surface-switcher")!;
    const forum = app.nodes.get("surface-choices")!.children[1];
    panel.open = true; forum.focus();
    app.documentEvent("keydown", forum, "Escape");
    expect(panel.open).toBe(false);
    expect(app.activeElement).toBe(app.nodes.get("surface-trigger"));
    panel.open = true; forum.fire("click");
    expect(body.value).toBe("Keep this unsent draft");
    expect(app.nodes.get("content")!.byName("body")).toBe(body);
    expect(app.nodes.get("status")!.textContent).toContain("Close or submit your draft");
    panel.open = true; app.documentEvent("pointerdown", app.nodes.get("query")!);
    expect(panel.open).toBe(false);
    panel.open = true; app.nodes.get("query")!.focus(); app.documentEvent("focusin", app.nodes.get("query")!);
    expect(panel.open).toBe(false);
    expect(app.activeElement).toBe(app.nodes.get("query"));
    expect(body.value).toBe("Keep this unsent draft");
    app.message({ jsonrpc: "2.0", id: 201, method: "ui/resource-teardown" }); await app.flush();
    expect(app.documentListeners.size).toBe(0);
  });

  test("legacy Blog navigation uses openExternal without direct window navigation", async () => {
    const external: string[] = [];
    const app = appHarness({ openExternal: ({ href }: { href: string }) => { external.push(href); }, callTool: async (name: string) => ({ structuredContent: { data: name === "forum_status" ? { capabilities: ["read"] } : { page: [], isDone: true } } }) });
    app.timers.values().next().value!(); await app.flush();
    app.nodes.get("surface-choices")!.children[0].fire("click");
    expect(external).toEqual(["https://www.symbaiex.com"]);
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });

  test("navigation clears stale content while loading and retry preserves the failed target", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Members & agents")!.fire("click");
    const members = app.latest("tools/call");
    app.reply(members, { structuredContent: { data: { members: [{ username: "Visible member" }] } } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("Visible member");
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    expect(app.nodes.get("content")!.textContent).not.toContain("Visible member");
    expect(app.nodes.get("content")!.attributes["aria-busy"]).toBe("true");
    expect(app.nodes.get("compose")!.disabled).toBe(true);
    app.message({ jsonrpc: "2.0", id: app.latest("tools/call").id, error: { message: "Connection expired. Reconnect to continue." } }); await app.flush();
    expect(app.nodes.get("content")!.attributes["aria-busy"]).toBe("false");
    expect(app.nodes.get("status")!.textContent).toContain("Connection expired");
    expect(app.nodes.get("compose")!.disabled).toBe(false);
    app.nodes.get("content")!.find("Try again")!.fire("click");
    expect(app.latest("tools/call").params?.name).toBe("forum_list_categories");
  });

  test("mailbox folders and pagination remain bound to the selected mailbox", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Inbox")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { messages: [], pagination: { totalPages: 1 } } } }); await app.flush();
    app.nodes.get("content")!.find("Sent")!.fire("click");
    expect(app.latest("tools/call").params).toMatchObject({ name: "forum_list_private_messages", arguments: { box: "sent", page: 1, pageSize: 20 } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { messages: [{ _id: "sent-1", subject: "Sent note" }], pagination: { totalPages: 2 } } } }); await app.flush();
    app.nodes.get("content")!.find("Next →")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ box: "sent", page: 2 });
  });

  test.each(["trash", "sent"])("%s message readers preserve folder visibility and return page", async (box) => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Inbox")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { messages: [], pagination: { totalPages: 1 } } } }); await app.flush();
    const label = box === "trash" ? "Trash" : "Sent";
    app.nodes.get("content")!.find(label)!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { messages: [], pagination: { totalPages: 2 } } } }); await app.flush();
    app.nodes.get("content")!.find("Next →")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { messages: [{ _id: "message-2", subject: "Folder message" }], pagination: { totalPages: 2 } } } }); await app.flush();
    app.nodes.get("content")!.find("Folder message")!.fire("click");
    expect(app.latest("tools/call").params).toMatchObject({ name: "forum_get_private_message", arguments: { messageId: "message-2", box } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { message: { _id: "message-2", subject: "Folder message", body: "Visible folder message" } } } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("Visible folder message");
    app.nodes.get("content")!.find("← " + label)!.fire("click");
    expect(app.latest("tools/call").params).toMatchObject({ name: "forum_list_private_messages", arguments: { box, page: 2, pageSize: 20 } });
  });

  test("responsive search preserves an active query across widths and cleans up its media listener", async () => {
    const app = appHarness(undefined, 390);
    const panel = app.nodes.get("search-panel")!;
    const form = app.nodes.get("search")!;
    const query = app.nodes.get("query")!;
    form.append(query);
    expect(panel.open).toBe(false);
    query.value = "Preserved search"; query.focus();
    app.setSearchWidth(1280); expect(panel.open).toBe(true);
    app.setSearchWidth(390); expect(panel.open).toBe(true);
    expect(query.value).toBe("Preserved search");
    app.nodes.get("identity")!.focus();
    app.setSearchWidth(1280); app.setSearchWidth(390);
    expect(panel.open).toBe(false);
    expect(query.value).toBe("Preserved search");
    expect(app.searchMediaListeners.size).toBe(1);
    app.message({ jsonrpc: "2.0", id: 199, method: "ui/resource-teardown" });
    await app.flush();
    expect(app.searchMediaListeners.size).toBe(0);
  });

  test("leaving desktop collapses its default More rail while preserving focused and user-opened menus", async () => {
    const app = appHarness(undefined, 1280); await app.connect(false);
    const more = app.nodes.get("navigation")!.querySelector("details")!;
    expect(more.open).toBe(true);
    app.setSearchWidth(320); expect(more.open).toBe(false);
    app.setSearchWidth(1280); expect(more.open).toBe(true);
    const saved = more.find("Saved threads")!; saved.focus();
    app.setSearchWidth(320);
    expect(more.open).toBe(true);
    expect(app.activeElement).toBe(saved);
    // A mobile user can keep a deliberately opened menu across width changes.
    more.open = false;
    more.querySelector("summary")!.fire("click"); more.open = true;
    app.nodes.get("identity")!.focus();
    app.setSearchWidth(1280); app.setSearchWidth(320);
    expect(more.open).toBe(true);
    expect(app.navigationMediaListeners.size).toBe(1);
    app.message({ jsonrpc: "2.0", id: 200, method: "ui/resource-teardown" }); await app.flush();
    expect(app.navigationMediaListeners.size).toBe(0);
    expect(app.searchMediaListeners.size).toBe(0);
  });

  test("does not read hidden chat and refreshes only while opened", async () => {
    const app = appHarness(); await app.connect(false);
    expect(app.nodes.get("chat-panel")!.hidden).toBe(true);
    expect(FORUM_PLUGIN_APP_HTML).toContain('aria-expanded="false" aria-controls="chat-panel">Open chat');
    expect([...app.timers.keys()].some(id => app.timerDurations.get(id) === 30_000)).toBe(false);
    expect(app.sent.some(call => call.params?.name === "forum_list_chat_messages")).toBe(false);
    // A fresh preview remains text-only even if its author or body is hostile.
    app.nodes.get("chat-toggle")!.fire("click");
    const opened = app.latest("tools/call");
    expect(opened.params?.name).toBe("forum_list_chat_messages");
    app.reply(opened, { structuredContent: { data: { page: [{ body: "<img src=x>", authorIdentity: { username: "Reader" } }], viewer: { canRead: true, canSend: true }, isDone: true } } });
    await app.flush();
    expect(app.nodes.get("chat-peek")!.textContent).toBe("Reader: <img src=x>");
    expect(app.nodes.get("chat-peek")!.querySelector("img")).toBeNull();
    expect([...app.timers.keys()].some(id => app.timerDurations.get(id) === 30_000)).toBe(true);
    const input = app.nodes.get("chat-body")!; input.value = "My unsent draft"; input.fire("input");
    app.nodes.get("chat-toggle")!.fire("click");
    expect(input.value).toBe("My unsent draft");
    expect([...app.timers.keys()].some(id => app.timerDurations.get(id) === 30_000)).toBe(false);
  });

  test("an explicit collapsed-chat refresh reads once without starting background polling", async () => {
    const app = appHarness(); await app.connect(false);
    expect(app.sent.some(call => call.params?.name === "forum_list_chat_messages")).toBe(false);
    app.nodes.get("chat-latest")!.fire("click");
    expect(app.latest("tools/call").params?.name).toBe("forum_list_chat_messages");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ body: "Fresh preview", authorIdentity: { username: "Member" } }], viewer: { canRead: true, canSend: true }, isDone: true } } }); await app.flush();
    expect(app.nodes.get("chat-peek")!.textContent).toBe("Member: Fresh preview");
    expect([...app.timers.keys()].some(id => app.timerDurations.get(id) === 30_000)).toBe(false);
  });

  test("forum unlimited usage status ignores obsolete counters and preserves browsing and live refresh", async () => {
    const app = appHarness(); await app.connect();
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: { userId: "research-agent", username: "Research agent", isAgent: true }, data: { usagePolicy: { scope: "forum", monthlyLimit: null, readRequestsPerMinute: 600, writeRequestsPerMinute: 120, ownerScoped: true }, quota: { remainingUnits: 0, settingsUrl: "https://www.symbaiex.com/developer" } } } } });
    await app.flush();
    const settings = app.nodes.get("settings")!.textContent;
    expect(settings).toContain("Forum has no monthly usage limit.");
    expect(settings).toContain("posting cooldowns and permissions still apply");
    expect(settings).not.toMatch(/allowance|remaining|Developer|units used/i);
    expect(FORUM_PLUGIN_APP_HTML).not.toContain('id="quota"');
    expect(FORUM_PLUGIN_APP_HTML).not.toContain("https://www.symbaiex.com/developer");
    const panel = app.nodes.get("chat-panel")!;
    panel.find("Pause live refresh")!.fire("click");
    expect([...app.timers.keys()].some(id => app.timerDurations.get(id) === 30_000)).toBe(false);
    const resume = panel.find("Resume live refresh")!;
    expect(resume.disabled).toBe(false); resume.fire("click");
    expect([...app.timers.keys()].some(id => app.timerDurations.get(id) === 30_000)).toBe(true);
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    expect(app.latest("tools/call").params?.name).toBe("forum_list_categories");
  });

  test("short-term read limits keep the shell mounted, give a retry delay and stop live refresh", async () => {
    const app = appHarness(); await app.connect();
    app.nodes.get("chat-latest")!.fire("click");
    app.reply(app.latest("tools/call"), { isError: true, structuredContent: { code: "FORUM_RATE_LIMITED", error: "Too many forum reads.", quotaReason: "rate-limited", retryAfter: 2500 }, content: [{ type: "text", text: "Raw transport error" }] }); await app.flush();
    expect(app.nodes.get("chat-notice")!.textContent).toBe("Too many forum reads. Try again in 3 seconds.");
    expect(app.nodes.get("chat-notice")!.textContent).not.toContain("Write allowance resets");
    expect([...app.timers.keys()].some(id => app.timerDurations.get(id) === 30_000)).toBe(false);
    expect(app.nodes.get("identity")!.textContent).toContain("Research agent");
    expect(app.nodes.get("chat-panel")!.find("Resume live refresh")).toBeDefined();
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    app.reply(app.latest("tools/call"), { isError: true, structuredContent: { error: "Too many forum reads.", quotaReason: "rate-limited", retryAfter: 2500 } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("Try again in 3 seconds.");
    expect(app.nodes.get("content")!.find("Try again")).toBeDefined();
    expect(app.sent.filter(call => call.params?.name === "forum_overview")).toHaveLength(1);
  });

  test.each([
    { code: "FORUM_RATE_LIMITED", error: "Please slow down.", quotaReason: "rate-limited", retryAfter: 2500, expected: "Please slow down. Try again in 3 seconds." },
    { code: "AGENT_QUOTA_EXCEEDED", error: "Agent usage quota reached.", quotaReason: "hard-cap", retryAfter: undefined, expected: "Agent usage quota reached." },
  ])("$code write failure preserves draft and read refresh without monthly-cap presentation", async ({ expected, ...failure }) => {
    const app = appHarness(); await app.connect();
    const input = app.nodes.get("chat-body")!; input.value = "Preserve this message"; input.fire("input");
    app.nodes.get("chat-form")!.fire("submit"); await app.flush();
    app.reply(app.latest("tools/call"), { isError: true, structuredContent: { ...failure, resetsAt: 1_800_000_000_000, quota: { remainingUnits: 0 } } }); await app.flush();
    expect(input.value).toBe("Preserve this message");
    expect(app.nodes.get("chat-notice")!.textContent).toBe(expected);
    expect(app.nodes.get("chat-notice")!.textContent).not.toMatch(/monthly|resets|remaining|allowance settings/i);
    expect(app.nodes.get("settings")!.textContent).toContain("Forum has no monthly usage limit.");
    expect([...app.timers.keys()].some(id => app.timerDurations.get(id) === 30_000)).toBe(true);
    expect(app.nodes.get("chat-panel")!.find("Pause live refresh")).toBeDefined();
    expect(app.sent.filter(call => call.params?.name === "forum_overview")).toHaveLength(1);
  });

  test("an explicit thread selection during connection wins over the default feed", async () => {
    const app = appHarness();
    app.reply(app.latest("ui/initialize"), { protocolVersion: "2026-01-26" }); await app.flush();
    const status = app.latest("tools/call");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "selected" } } });
    const thread = app.latest("tools/call");
    expect(thread.params?.name).toBe("forum_get_thread");
    app.reply(status, { structuredContent: { actingAs: { userId: "owner", username: "Reader" }, capabilities: ["read"], policyVersion: 1 } });
    await app.flush();
    app.reply(thread, { structuredContent: { data: { thread: { title: "Selected discussion", body: "Keep this reader" }, replies: { page: [] } } } });
    await app.flush();
    expect(app.nodes.get("content")!.querySelector("h1")!.textContent).toBe("Selected discussion");
    expect(app.sent.some(call => call.params?.name === "forum_list_feed_threads")).toBe(false);
  });

  test("keeps the four discussion sections visible and moves permission-gated tools into More", async () => {
    const app = appHarness(); await app.connect();
    const nav = app.nodes.get("navigation")!;
    expect(nav.children[0].children.map(node => node.textContent)).toEqual(["Feed", "News", "Community", "Boards"]);
    const more = nav.querySelector("details")!;
    expect(more.firstElementChild.textContent).toBe("More");
    expect(more.find("Saved threads")).toBeDefined();
    expect(more.find("Inbox")).toBeDefined();
    expect(more.find("Moderation")).toBeUndefined();
    more.find("Saved threads")!.fire("click");
    expect(app.latest("tools/call").params?.name).toBe("forum_list_my_thread_bookmarks");
    expect(nav.querySelector("summary")!.attributes["aria-current"]).toBe("page");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
      actingAs: { userId: "research-agent", username: "Research agent", isAgent: true },
      data: { capabilities: ["read"], policyVersion: 2, executionMode: "direct" },
    } } });
    expect(nav.find("Saved threads")).toBeUndefined();
    expect(nav.find("Inbox")).toBeUndefined();
    expect(nav.find("Boards")).toBeDefined();
    expect(app.nodes.get("content")!.textContent).toContain("Connection changed");
    expect(app.nodes.get("compose")!.hidden).toBe(true);
  });

  test("chat polling preserves an expanded More menu and keyboard focus until authority changes", async () => {
    const app = appHarness(); await app.connect();
    const nav = app.nodes.get("navigation")!;
    const more = nav.querySelector("details")!;
    const saved = more.find("Saved threads")!;
    more.open = true; saved.focus();
    const pollTimer = [...app.timers.keys()].find(id => app.timerDurations.get(id) === 30_000)!;
    app.timers.get(pollTimer)!();
    const poll = app.latest("tools/call");
    expect(poll.params?.name).toBe("forum_list_chat_messages");
    app.reply(poll, { structuredContent: {
      actingAs: { userId: "research-agent", username: "Research agent", isAgent: true },
      data: { page: [{ body: "A new lounge message", authorIdentity: { name: "Member" } }], pending: [], viewer: { canRead: true, canSend: true }, isDone: true },
    } });
    await app.flush();
    expect(app.nodes.get("chat-messages")!.textContent).toContain("A new lounge message");
    expect(nav.querySelector("details")).toBe(more);
    expect(more.open).toBe(true);
    expect(nav.find("Saved threads")).toBe(saved);
    expect(app.activeElement).toBe(saved);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
      actingAs: { userId: "research-agent", username: "Research agent", isAgent: true },
      data: { capabilities: ["read"], policyVersion: 2, executionMode: "direct" },
    } } });
    expect(nav.find("Saved threads")).toBeUndefined();
    expect(nav.find("Inbox")).toBeUndefined();
    expect(app.nodes.get("compose")!.hidden).toBe(true);
  });

  test("board rail uses current visible boards and drops cached communities when the actor changes", async () => {
    const app = appHarness(); await app.connect();
    app.nodes.get("navigation")!.find("Boards")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: [
      { _id: "general", slug: "general", name: "General" }, { _id: "section", slug: "category", name: "Category heading", kind: "section" },
    ] } });
    await app.flush();
    const rail = app.nodes.get("navigation")!;
    expect(rail.find("GGeneral")).toBeDefined();
    expect(rail.find("Category heading")).toBeUndefined();
    const boardControl = rail.find("GGeneral")!; boardControl.focus();
    app.nodes.get("chat-latest")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], viewer: { canRead: true, canSend: true }, isDone: true } } });
    await app.flush();
    expect(rail.find("GGeneral")).toBe(boardControl);
    expect(app.activeElement).toBe(boardControl);
    rail.find("GGeneral")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ categorySlug: "general" });
    const stale = app.latest("tools/call");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
      actingAs: { userId: "new-reader", username: "New reader" }, data: { capabilities: ["read"], policyVersion: 2, executionMode: "direct" },
    } } });
    app.reply(stale, { structuredContent: { data: { category: { name: "Old restricted board" }, threads: [] } } });
    await app.flush();
    expect(rail.find("GGeneral")).toBeUndefined();
    expect(app.nodes.get("forum-context")!.textContent).toContain("New reader");
    expect(app.nodes.get("content")!.textContent).not.toContain("Old restricted board");
  });

  test("loads visible forum conversations without optional news reads and preserves the correct thread target", async () => {
    const app = appHarness(); await app.connect();
    app.nodes.get("navigation")!.find("Feed")!.fire("click");
    const feed = app.sent.filter(call => call.params?.name === "forum_list_feed_threads").at(-1)!;
    app.reply(feed, { structuredContent: { data: { page: [{ title: "Community notes", categorySlug: "general", slug: "notes", authorIdentity: { name: "Community reader" } }], isDone: true } } });
    await app.flush();
    const content = app.nodes.get("content")!;
    expect(content.textContent).toContain("Community notes");
    expect(app.sent.some(call => call.params?.name === "forum_list_news_feed")).toBe(false);
    content.find("Community notes")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ categorySlug: "general", threadSlug: "notes" });
  });

  test("feed panels show real creation dates and reply labels without duplicate last-author activity", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Community")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [
      { title: "First topic", slug: "first", categorySlug: "general", authorIdentity: { name: "Original reader" }, createdAt: 1_800_000_000_000, lastPostAuthor: "Duplicate activity author", lastPostAt: 1_800_001_000_000, replyCount: 0, viewCount: 1 },
      { title: "Second topic", slug: "second", categorySlug: "general", replyCount: 1, viewCount: 9 },
    ], isDone: true } } });
    await app.flush();
    const content = app.nodes.get("content")!;
    expect(content.querySelector("time")!.textContent).toBe(new Date(1_800_000_000_000).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    expect(content.textContent).not.toContain("Duplicate activity author");
    expect(content.find("Discuss")).toBeDefined();
    expect(content.find("1 reply")).toBeDefined();
    content.find("Discuss")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toMatchObject({ categorySlug: "general", threadSlug: "first" });
  });

  test.each([
    { guest: true, status: "active", expected: "Connect your profile to reply." },
    { guest: true, status: "locked", expected: "This discussion is locked." },
    { guest: false, status: "active", expected: "Replies are unavailable for your connected profile." },
  ])("thread reply feedback distinguishes guest=$guest status=$status", async ({ guest, status, expected }) => {
    const app = appHarness(); await app.connect(false);
    if (guest) {
      app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: null, capabilities: ["read"] } } });
      await app.flush();
    }
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "reader" } } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { thread: { _id: "reader", title: "Discussion", body: "Conversation", status, viewerCanReply: false }, replies: { page: [], pagination: { page: 1, totalPages: 1 } } } } });
    await app.flush();
    const content = app.nodes.get("content")!;
    expect(content.textContent).toContain(expected);
    expect(content.find("Reply")).toBeUndefined();
    expect(content.find("Reply to discussion")).toBeUndefined();
    if (guest && status === "active") {
      expect(content.textContent).not.toContain("unavailable");
      const connect = content.children.at(-1)!.querySelector("a")!;
      expect(connect.textContent).toBe("Connect your profile to reply.");
      connect.fire("click");
      expect(app.latest("tools/call").params?.name).toBe("forum_status");
      expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
    } else expect(content.textContent).not.toContain("Connect your profile to reply.");
  });

  test("offers a reply after the conversation without bypassing draft permissions", async () => {
    const app = appHarness(); await app.connect();
    app.nodes.get("navigation")!.find("Community")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ title: "Sources", slug: "sources", categorySlug: "research" }], isDone: true } } });
    await app.flush(); app.nodes.get("content")!.find("Sources")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { category: { name: "Research" }, thread: { _id: "sources", title: "Sources", body: "Read these references", viewerCanReply: true }, replies: { page: [], pagination: { page: 1, totalPages: 1 } } } } });
    await app.flush();
    const content = app.nodes.get("content")!;
    expect(content.textContent).toContain("Join the discussion as Research agent");
    content.find("Reply to discussion")!.fire("click");
    const body = content.byName("body")!; body.value = "My reply"; body.fire("input");
    app.nodes.get("navigation")!.find("News")!.fire("click");
    expect(content.byName("body")!.value).toBe("My reply");
    expect(app.nodes.get("status")!.textContent).toContain("Close or submit your draft");
    expect(app.sent.some(call => call.params?.name === "forum_create_post")).toBe(false);
  });

  test("opens Feed by default and decodes preserved ChatGPT result metadata", async () => {
    const app = appHarness();
    await app.connect();
    expect(app.sent.some(call => call.params?.name === "forum_overview")).toBe(true);
    expect(app.sent.some(call => call.params?.name === "forum_list_feed_threads")).toBe(true);
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
        app.message({ jsonrpc: "2.0", id: app.latest("tools/call").id, error: { message: error } });
      await app.flush();
      expect(app.sent.filter(call => call.params?.name === "forum_overview")).toHaveLength(fallback ? 2 : 1);
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
    expect(calls).toContain("forum_list_feed_threads");
    expect(legacy.nodes.get("content")!.textContent).toContain("Feed");
  });

  test.each([
    { label: "empty metadata with valid raw output", metadata: {}, output: { actingAs: { userId: "hint", username: "Snapshot profile" }, data: { capabilities: ["read"] } } },
    { label: "both snapshots malformed", metadata: { unrelated: "host metadata" }, output: "not structured forum data" },
  ])("legacy boot continues with $label", async ({ metadata, output }) => {
    const calls: string[] = [];
    const app = appHarness({ toolResponseMetadata: metadata, toolOutput: output, callTool: async (name: string) => {
      calls.push(name);
      if (name === "forum_status") return { structuredContent: { actingAs: { userId: "owner", username: "Authenticated profile" }, data: { capabilities: ["read"], policyVersion: 1, executionMode: "direct" } } };
      return { structuredContent: { data: name === "forum_list_feed_threads" ? { page: [{ title: "Working conversation", categorySlug: "general", slug: "working" }], isDone: true } : { page: [], pending: [], viewer: { canRead: true, canSend: false }, isDone: true } } };
    } });
    app.timers.values().next().value!(); await app.flush();
    expect(calls).toEqual(["forum_status", "forum_overview", "forum_list_feed_threads"]);
    expect(app.nodes.get("identity")!.textContent).toContain("Authenticated profile");
    expect(app.nodes.get("content")!.textContent).toContain("Working conversation");
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

  test("hides unavailable chat composers without discarding drafts or hiding failure reasons", async () => {
    const app = appHarness(); await app.connect();
    const form = app.nodes.get("chat-form")!;
    const body = app.nodes.get("chat-body")!;
    expect(form.hidden).toBe(false);
    body.value = "Keep my unsent lounge draft"; body.fire("input");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: {
      actingAs: { userId: "research-agent", username: "Research agent", isAgent: true }, data: { capabilities: ["read"], policyVersion: 2, executionMode: "direct" },
    } } });
    expect(form.hidden).toBe(true);
    expect(body.value).toBe("Keep my unsent lounge draft");
    expect(app.nodes.get("chat-send")!.disabled).toBe(true);
    form.fire("submit");
    expect(app.sent.some(call => call.params?.name === "forum_send_chat_message")).toBe(false);
    app.nodes.get("chat-latest")!.fire("click");
    app.message({ jsonrpc: "2.0", id: app.latest("tools/call").id, error: { message: "Chat quota exceeded. Try tomorrow." } });
    await app.flush();
    expect(form.hidden).toBe(true);
    expect(body.value).toBe("Keep my unsent lounge draft");
    expect(app.nodes.get("chat-notice")!.textContent).toBe("Chat quota exceeded. Try tomorrow.");
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { actingAs: null, data: { capabilities: ["read"] } } } });
    expect(form.hidden).toBe(true);
    expect(app.nodes.get("chat-profile")!.textContent).toBe("Connect to join");
    expect(body.value).toBe("Keep my unsent lounge draft");
  });

  test("missing chat tools leave Feed readable and do not keep polling an unsupported tool", async () => {
    const app = appHarness(); await app.connect();
    app.nodes.get("chat-latest")!.fire("click");
    app.message({ jsonrpc: "2.0", id: app.latest("tools/call").id, error: { message: "Unknown tool forum_list_chat_messages" } }); await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("Feed");
    expect(app.nodes.get("chat-notice")!.textContent).toContain("Reconnect");
    expect(app.timers.size).toBe(0);
  });


  test("chat shows own moderated messages safely and polling leaves the active reader intact", async () => {
    const app = appHarness(); await app.connect();
    await app.beginPostDraft();
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
    expect(first.params).toEqual({ name: "forum_list_feed_threads", arguments: { sort: "active", communityOnly: true, now: expect.any(Number), paginationOpts: { numItems: 12, cursor: null } } });
    app.reply(first, { structuredContent: { data: { page: [], isDone: false, continueCursor: "native-cursor" } } });
    await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("No visible conversations on this page");
    app.nodes.get("content")!.find("Load more discussions")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toEqual({ sort: "active", scope: "discover", authorFilter: "all", communityOnly: true, now: expect.any(Number), paginationOpts: { numItems: 12, cursor: "native-cursor" } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [{ title: "A real conversation", slug: "real", categorySlug: "general", authorIdentity: { name: "Agent reader", isAgent: true }, excerpt: "A clear preview" }], isDone: true, continueCursor: "" } } });
    await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("A real conversation");
    expect(app.nodes.get("content")!.textContent).toContain("Agent readerAI agent");
    app.nodes.get("content")!.find("Refresh")!.fire("click");
    expect(app.latest("tools/call").params?.arguments).toEqual({ sort: "active", scope: "discover", authorFilter: "all", communityOnly: true, now: expect.any(Number), paginationOpts: { numItems: 12, cursor: null } });
  });

  test("renders stored news editions with canonical links and separates HN and local activity", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("navigation")!.find("News")!.fire("click");
    expect(app.latest("tools/call").params).toEqual({ name: "forum_list_news_feed", arguments: { limit: 30 } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { snapshot: { snapshotDate: "2026-10-02" }, snapshots: [{ snapshotDate: "2026-10-02" }], stories: [
      { hnItemId: 123, title: "Tools & people", host: "example.com", hnScore: 80, hnCommentCount: 40, platformStats: { comments: 3, score: 2, saves: 1 }, platformStatsStatus: "available" },
      { hnItemId: 124, title: "No local counts yet", hnScore: 8, platformStats: null, platformStatsStatus: "unavailable" },
    ] } } });
    await app.flush();
    expect(app.nodes.get("content")!.textContent).toContain("80 HN points · 40 HN comments · 2 SYMBaiEX votes · 1 saves");
    expect(app.nodes.get("content")!.textContent).not.toContain("0 SYMBaiEX comments");
    expect(app.nodes.get("content")!.querySelector("article")!.children[0].attributes["aria-label"]).toBe("Hacker News rank 1");
    const anchor = app.nodes.get("content")!.querySelector("a")!;
    expect(anchor.href).toBe("https://forum.symbaiex.com/stories/123");
    anchor.fire("click");
    expect(app.latest("tools/call").params).toEqual({ name: "forum_get_news_discussion", arguments: { hnItemId: 123 } });
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });

  test("drops a delayed old actor response after a policy change and clears the private reader", async () => {
    const app = appHarness();
    await app.connect();
    app.nodes.get("navigation")!.find("Saved threads")!.fire("click");
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
    app.nodes.get("navigation")!.find("Saved threads")!.fire("click");
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
    expect(FORUM_PLUGIN_APP_RESOURCE._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: ["https://strong-bee-384.convex.cloud"], frameDomains: [] });
    expect(FORUM_PLUGIN_APP_HTML.startsWith("<!doctype html>")).toBe(true);
    expect(FORUM_PLUGIN_APP_HTML).not.toMatch(/innerHTML|<iframe|fetch\(|XMLHttpRequest|accessToken|authorization:/i);
    expect(FORUM_PLUGIN_APP_HTML).toContain('aria-label="Forum sections"');
    expect(FORUM_PLUGIN_APP_HTML).toContain("focus-visible");
  });

  test("keeps the portable light and dark palette aligned with native forum tokens", () => {
    const nativeCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const declarations = (block: string) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)].map(match => [match[1], match[2].trim()]));
    const nativeBase = declarations(nativeCss.match(/:root\s*\{([^}]+)\}/)![1]);
    const nativeLight = { ...nativeBase, ...declarations(nativeCss.match(/(?<!\.dark )\.forum-app-shell\s*\{([^}]+)\}/)![1]) };
    const nativeDark = { ...nativeLight, ...declarations(nativeCss.match(/\.dark\s*\{([^}]+)\}/)![1]), ...declarations(nativeCss.match(/\.dark \.forum-app-shell\s*\{([^}]+)\}/)![1]) };
    for (const [theme, expected] of [["light", nativeLight], ["dark", nativeDark]] as const) {
      const portable = declarations(FORUM_PLUGIN_APP_HTML.match(new RegExp(":root\\[data-theme=" + theme + "\\]\\{([^}]+)\\}"))![1]);
      expect(Object.keys(portable).length).toBeGreaterThan(10);
      for (const [name, value] of Object.entries(portable)) expect(value, theme + " " + name).toBe(expected[name]);
    }
    expect(FORUM_PLUGIN_APP_HTML).toContain('aria-label="SYMBaiEX Forum"');
  });

  test("prefers fullscreen without blocking initial reads and asks only once when the host advertises it", async () => {
    expect(FORUM_PLUGIN_APP_RESOURCE._meta["openai/ui"]).toEqual({ availableDisplayModes: ["fullscreen"], preferredDisplayMode: "fullscreen" });
    const app = appHarness();
    app.reply(app.latest("ui/initialize"), { protocolVersion: "2026-01-26", hostContext: { availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline" } });
    await app.flush();
    expect(app.latest("ui/request-display-mode").params).toEqual({ mode: "fullscreen" });
    expect(app.latest("tools/call").params!.name).toBe("forum_status");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { capabilities: ["read", "participate"], policyVersion: 1 }, actingAs: { userId: "owner", username: "Owner" } } });
    await app.flush();
    expect(app.latest("tools/call").params!.name).toBe("forum_list_feed_threads");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], isDone: true } } });
    await app.flush();
    await app.beginPostDraft();
    const body = app.nodes.get("content")!.byName("body")!; body.value = "Fullscreen must preserve this draft";
    app.reply(app.latest("ui/request-display-mode"), { mode: "fullscreen" });
    await app.flush();
    app.message({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { displayMode: "inline" } });
    expect(app.sent.filter(message => message.method === "ui/request-display-mode")).toHaveLength(1);
    expect(body.value).toBe("Fullscreen must preserve this draft");
  });

  test("fullscreen preference respects a host exit and ignores a delayed display response", async () => {
    const initial = appHarness();
    initial.reply(initial.latest("ui/initialize"), { protocolVersion: "2026-01-26", hostContext: { availableDisplayModes: ["inline", "fullscreen"], displayMode: "fullscreen" } });
    await initial.flush();
    initial.message({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { displayMode: "inline" } });
    expect(initial.sent.some(call => call.method === "ui/request-display-mode")).toBe(false);
    expect(initial.nodes.get("app")!.dataset.displayMode).toBe("inline");
    const delayed = appHarness();
    delayed.reply(delayed.latest("ui/initialize"), { protocolVersion: "2026-01-26", hostContext: { availableDisplayModes: ["inline", "fullscreen"], displayMode: "inline" } });
    await delayed.flush();
    const request = delayed.latest("ui/request-display-mode");
    delayed.message({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { displayMode: "inline", availableDisplayModes: ["inline"] } });
    delayed.reply(request, { mode: "fullscreen" }); await delayed.flush();
    expect(delayed.nodes.get("app")!.dataset.displayMode).toBe("inline");
    expect(delayed.nodes.get("expand")!.hidden).toBe(true);
  });

  test("quoting a large root post makes an explicit excerpt within reply limits", async () => {
    const app = appHarness(); await app.connect(false);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "long-post" } } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { category: {}, thread: { _id: "thread", title: "Long source", author: "Austin", body: "x".repeat(64_000), viewerCanReply: true }, replies: [] } } }); await app.flush();
    const content = app.nodes.get("content")!;
    content.find("Quote")!.fire("click");
    expect(content.textContent).toContain("This quote is an excerpt to fit the reply limit");
    expect(content.byName("body")!.value.length).toBe(32_000);
    expect(content.byName("body")!.value.endsWith("…[/quote]\n\n")).toBe(true);
    expect(app.sent.some(call => call.params?.name === "forum_create_reply")).toBe(false);
  });

  test("rich readers preserve forum formatting, code literals and safe host-opened attachments", async () => {
    const app = appHarness(); await app.connect(false);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "formatted" } } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { category: { name: "General" }, thread: {
      _id: "thread", title: "Formatted", author: "Austin", body: '[h2]Reading notes[/h2]\n[b]Bold[/b] and [i]italic[/i]\n[quote=Research agent]Quoted [b]source[/b][/quote]\n[code=js]<script>alert(1)</script> [b]literal[/b][/code]\n[list=1][*]First[*]Second[/list]\n[url=https://example.com/research]Read source[/url] [url=javascript:alert(1)]Unsafe[/url] [url=https://user:pass@example.com]Credentials[/url]\n[spoiler=Details]Hidden details[/spoiler]\n[table][tr][th]Topic[/th][th]Result[/th][/tr][tr][td]API[/td][td]Ready[/td][/tr][/table]',
      viewerCanReply: true, attachments: [{ filename: "notes.pdf", url: "https://blue-fox.convex.cloud/api/storage/notes" }, { filename: "unsafe.txt", url: "javascript:alert(2)" }],
    }, replies: [] } } }); await app.flush();
    const content = app.nodes.get("content")!;
    expect(app.nodes.get("app")!.dataset.view).toBe("thread");
    expect(content.querySelector("h2")!.textContent).toBe("Conversation");
    expect(content.querySelector("blockquote")!.textContent).toBe("Quoted source");
    expect(content.querySelector("code")!.textContent).toBe("<script>alert(1)</script> [b]literal[/b]");
    expect(content.querySelector("script")).toBeNull();
    expect(content.querySelector("ol")!.children.map(node => node.textContent)).toEqual(["First", "Second"]);
    expect(content.querySelector("table")!.textContent).toBe("TopicResultAPIReady");
    const collect = (node: Node): Node[] => [node, ...node.children.flatMap(collect)];
    const links = collect(content).filter(node => node.tagName === "a");
    expect(links.find(node => node.textContent === "Read source")!.href).toBe("https://example.com/research");
    expect(links.some(node => /javascript:|user:pass/.test(node.href))).toBe(false);
    const attachment = links.find(node => node.textContent === "notes.pdf ↗")!;
    attachment.fire("click"); await app.flush();
    expect(app.latest("ui/open-link").params).toEqual({ url: "https://blue-fox.convex.cloud/api/storage/notes" });
    app.reply(app.latest("ui/open-link"), {}); await app.flush();
    expect(links.some(node => node.textContent === "unsafe.txt ↗")).toBe(false);
    content.find("Quote")!.fire("click");
    expect(content.byName("body")!.value).toContain("[quote=Austin][h2]Reading notes");
    expect(content.byName("body")!.value.endsWith("[/quote]\n\n")).toBe(true);
    expect(app.sent.some(call => call.params?.name === "forum_create_reply")).toBe(false);
  });

  test("poll readers honor result visibility and require an explicit capability-bound vote", async () => {
    const app = appHarness(); await app.connect(false);
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { data: { capabilities: ["read", "feedback"], policyVersion: 1 }, actingAs: { userId: "research-agent", username: "Research agent" } } } });
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "poll" } } });
    const payload = { category: {}, thread: { _id: "thread", title: "Choose", body: "Which option?", viewerCanReply: false }, replies: [], poll: { _id: "poll", question: "Best approach?", status: "open", viewerCanVote: true, viewerCanSeeResults: false, totalVotes: 0, options: [{ _id: "option", label: "Research", voteCount: 0, percent: 0 }] } };
    app.reply(app.latest("tools/call"), { structuredContent: { data: payload } }); await app.flush();
    const content = app.nodes.get("content")!;
    expect(content.querySelector("meter")).toBeNull();
    content.find('Vote for “Research”')!.fire("click"); await app.flush();
    const vote = app.latest("tools/call");
    expect(vote.params).toMatchObject({ name: "forum_vote_poll", arguments: { pollId: "poll", optionId: "option", expectedPolicyVersion: 1 } });
    expect(validateForumPluginArguments(findForumPluginTool("forum_vote_poll")!, vote.params!.arguments)).toBeNull();
    app.reply(vote, { structuredContent: { status: "pending_approval", approvalUrl: "https://forum.symbaiex.com/control-panel/agent-access" } }); await app.flush();
    expect(content.textContent).toContain("Awaiting review");
    expect(app.sent.filter(call => call.params?.name === "forum_get_thread")).toHaveLength(1);
    app.nodes.get("navigation")!.find("Feed")!.fire("click"); app.reply(app.latest("tools/call"), { structuredContent: { data: { page: [], isDone: true } } }); await app.flush();
    app.message({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { categorySlug: "general", threadSlug: "poll" } } });
    app.reply(app.latest("tools/call"), { structuredContent: { data: { ...payload, poll: { ...payload.poll, status: "closed", viewerCanVote: false, viewerCanSeeResults: true, totalVotes: 4, viewerOptionId: "option", options: [{ _id: "option", label: "Research", voteCount: 4, percent: 100 }] } } } }); await app.flush();
    expect(content.textContent).toContain("4 votes · Closed");
    expect(content.textContent).toContain("Your vote");
    expect(content.querySelector("meter")!.attributes.value).toBe("100");
    expect(content.find('Vote for “Research”')).toBeUndefined();
  });

  test("private message actions expose real identities, keep review explicit and preserve reply fields", async () => {
    const app = appHarness(); await app.connect(false);
    app.nodes.get("navigation")!.find("Inbox")!.fire("click");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { messages: [{ _id: "message", subject: "Research note" }] } } }); await app.flush();
    app.nodes.get("content")!.find("Research note")!.fire("click");
    const message = { _id: "message", subject: "Research note", body: "[b]Private[/b] notes", senderUsername: "Austin", recipientUsername: "Research agent", otherUsername: "Austin", sourceBox: "inbox", unread: true };
    app.reply(app.latest("tools/call"), { structuredContent: { data: { message } } }); await app.flush();
    const content = app.nodes.get("content")!;
    expect(content.textContent).toContain("To Research agent");
    expect(content.querySelector("strong")!.textContent).toBe("Austin");
    expect(content.textContent).not.toContain("[b]");
    expect(app.sent.some(call => call.params?.name === "forum_mark_private_message_read")).toBe(false);
    content.find("Mark as read")!.fire("click"); await app.flush();
    const read = app.latest("tools/call");
    expect(read.params).toMatchObject({ name: "forum_mark_private_message_read", arguments: { messageId: "message", expectedPolicyVersion: 1 } });
    app.reply(read, { structuredContent: { status: "pending_approval" } }); await app.flush();
    expect(content.textContent).toContain("Awaiting review");
    content.find("Reply to message")!.fire("click");
    expect(content.byName("recipientUsername")!.value).toBe("Austin");
    expect(content.byName("subject")!.value).toBe("Re: Research note");
    expect(app.sent.some(call => call.params?.name === "forum_send_private_message")).toBe(false);
  });

  test("updates theme from the host without losing the active forum draft", async () => {
    const app = appHarness();
    await app.connect();
    expect(app.documentElement.dataset.theme).toBe("dark");
    await app.beginPostDraft();
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
    expect(app.latest("tools/call").params?.name).toBe("forum_list_my_pending_forum_content");
    app.reply(app.latest("tools/call"), { structuredContent: { data: { threads: [], posts: [] } } }); await app.flush();
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
    expect(init.params).toMatchObject({ protocolVersion: "2026-01-26", appCapabilities: { availableDisplayModes: ["fullscreen"] } });
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
    app.nodes.get("navigation")!.find("Members & agents")!.fire("click");
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
    await app.beginPostDraft();
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
    await app.beginPostDraft();
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
    expect(app.latest("tools/call").params?.name).toBe("forum_status");
    expect(app.sent.some(call => call.method === "ui/open-link")).toBe(false);
  });

  test("distinguishes completed moderation submissions from published composer posts", async () => {
    for (const pending of [true, false]) {
      const app = appHarness();
      await app.connect();
      await app.beginPostDraft();
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
    await app.beginPostDraft();
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
    await app.beginPostDraft();
    app.nodes.get("content")!.find("Choose from ChatGPT")!.fire("click");
    await app.flush();
    expect(app.nodes.get("status")!.textContent).toContain("at most five attachments");
    expect(app.sent.some(message => message.params?.name === "forum_upload_attachments")).toBe(false);
  });

  test("validates local attachment size and type before uploading to ChatGPT", async () => {
    let uploaded = 0;
    const app = appHarness({ uploadFile: async () => { uploaded++; return { fileId: "file-local" }; }, getFileDownloadUrl: async () => ({ downloadUrl: "https://files.example.test" }) });
    await app.connect();
    await app.beginPostDraft();
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
    await app.beginPostDraft();
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
    const displayRequests = app.sent.filter(message => message.method === "ui/request-display-mode").length;
    app.message({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { availableDisplayModes: ["inline"], displayMode: "inline" } });
    expect(app.nodes.get("expand")!.hidden).toBe(true);
    app.nodes.get("expand")!.fire("click");
    await app.flush();
    expect(aliasCalls).toBe(0);
    expect(app.sent.filter(message => message.method === "ui/request-display-mode")).toHaveLength(displayRequests);
  });
});
