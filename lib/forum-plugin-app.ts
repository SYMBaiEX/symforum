/** Portable MCP App. All forum data travels through the host's authenticated tools. */
export const FORUM_PLUGIN_APP_RESOURCE = {
  uri: "ui://symbaiex/forum.html",
  name: "symbaiex-forum",
  title: "SYMBaiEX Forum",
  description: "Browse boards, read discussions, and participate in the SYMBaiEX forum.",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    ui: {
      prefersBorder: true,
      csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
    },
  },
} as const;

// Keep this function self-contained: its compiled source is the resource's script.
export function forumPluginAppRuntime() {
  type RecordValue = Record<string, unknown>;
  type HostContext = { theme?: string; displayMode?: string; availableDisplayModes?: string[] };
  type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  type OpenAI = {
    callTool?: (name: string, args: RecordValue) => Promise<unknown>;
    requestDisplayMode?: (args: { mode: string }) => Promise<{ mode: string }>;
    openExternal?: (args: { href: string }) => void;
    toolOutput?: unknown;
    selectFiles?: () => Promise<Array<{ fileId: string; fileName: string; mimeType: string }>>;
    uploadFile?: (file: File) => Promise<{ fileId: string }>;
    getFileDownloadUrl?: (args: { fileId: string }) => Promise<{ downloadUrl: string }>;
  };
  const openai = (window as Window & { openai?: OpenAI }).openai;
  const pending = new Map<number, Pending>();
  let requestId = 0;
  let ready = false;
  let legacyBridge = false;
  let destroyed = false;
  let hostContext: HostContext = {};
  let viewRevision = 0;
  let currentView = "recent";
  let connection: RecordValue = {};
  let actingAs: RecordValue = {};
  let boards: RecordValue[] = [];
  let currentThread: RecordValue | null = null;
  let currentCategory = "";
  let composerDraft: { kind: string; fields: Record<string, string>; key: string } | null = null;
  let lastActionResult: RecordValue | null = null;
  const root = document.getElementById("app")!;
  const content = document.getElementById("content")!;
  const status = document.getElementById("status")!;
  const identity = document.getElementById("identity")!;
  const ownerLabel = document.getElementById("connection-owner")!;
  const postingLabel = document.getElementById("posting-trust")!;
  const modeLabel = document.getElementById("mode")!;
  const nav = document.getElementById("navigation")!;
  const compose = document.getElementById("compose")!;
  const expand = document.getElementById("expand")!;
  const searchForm = document.getElementById("search") as HTMLFormElement;
  const searchInput = document.getElementById("query") as HTMLInputElement;
  const object = (value: unknown): RecordValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
  const text = (value: unknown, fallback = ""): string => typeof value === "string" || typeof value === "number" ? String(value) : fallback;
  const collection = (value: unknown, keys = ["page", "items", "threads", "results", "notifications", "messages", "members", "categories"]): RecordValue[] => {
    if (Array.isArray(value)) return value.map(object);
    const record = object(value);
    for (const key of keys) if (Array.isArray(record[key])) return (record[key] as unknown[]).map(object);
    return [];
  };
  const element = <T extends keyof HTMLElementTagNameMap>(tag: T, value?: unknown, className?: string) => {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = text(value);
    if (className) node.className = className;
    return node;
  };
  const report = (message: string, error = false) => {
    status.textContent = message;
    status.className = error ? "notice error" : "notice";
    status.setAttribute("role", error ? "alert" : "status");
  };
  function request(method: string, params: RecordValue): Promise<unknown> {
    if (destroyed) return Promise.reject(new Error("Forum view closed. Reopen it to continue."));
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The host did not respond. Your draft is saved here; try again."));
      }, 20_000);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }
  function notify(method: string, params: RecordValue = {}) {
    if (!destroyed) window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }
  function applyContext(next: HostContext) {
    hostContext = { ...hostContext, ...next };
    if (hostContext.theme === "dark" || hostContext.theme === "light") document.documentElement.dataset.theme = hostContext.theme;
    root.dataset.displayMode = hostContext.displayMode ?? "inline";
    const nextMode = hostContext.displayMode === "fullscreen" ? "inline" : "fullscreen";
    expand.hidden = !(hostContext.availableDisplayModes ? hostContext.availableDisplayModes.includes(nextMode) : openai?.requestDisplayMode);
    expand.textContent = hostContext.displayMode === "fullscreen" ? "Compact view" : "Expand forum";
  }
  function teardown() {
    destroyed = true;
    ++viewRevision;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Forum view closed.")); }
    pending.clear();
    window.removeEventListener("message", onMessage);
    resizeObserver?.disconnect();
  }
  function onMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    const message = object(event.data);
    if (message.jsonrpc !== "2.0") return;
    if (typeof message.id === "number" && pending.has(message.id) && message.method === undefined) {
      const hasResult = Object.prototype.hasOwnProperty.call(message, "result");
      const hasError = Object.prototype.hasOwnProperty.call(message, "error");
      if (hasResult === hasError) return;
      const entry = pending.get(message.id)!;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (hasError) entry.reject(new Error(text(object(message.error).message, "The host declined this request.")));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === "ping" && (typeof message.id === "number" || typeof message.id === "string")) {
      window.parent.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
    } else if (message.method === "ui/resource-teardown" && message.id !== undefined) {
      window.parent.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
      teardown();
    } else if (ready && message.id === undefined && message.method === "ui/notifications/host-context-changed") {
      applyContext(object(message.params) as HostContext);
    } else if (ready && message.id === undefined && message.method === "ui/notifications/tool-result") {
      try {
        const result = decodeResult(message.params);
        updateIdentity(result);
        // A model-triggered write must surface its publication/review state even
        // while the user is reading a thread or keeping an unsent draft open.
        if (result.status === "pending_approval" || result.publicationStatus === "published" || result.publicationStatus === "pending_moderation") showActionResult(result);
        // Model-triggered results never replace an active reader or a draft.
        const recent = object(result.data).newestThreads;
        if (currentView === "recent" && !composerDraft && recent) renderThreadList(collection(recent), "Recent discussions");
      } catch (error) { report(error instanceof Error ? error.message : "Forum result unavailable.", true); }
    } else if (ready && message.id === undefined && message.method === "ui/notifications/tool-input") {
      const args = object(object(message.params).arguments);
      if (typeof args.threadSlug === "string" && typeof args.categorySlug === "string" && !composerDraft) {
        void navigate("thread", { threadSlug: args.threadSlug, categorySlug: args.categorySlug });
      }
    }
  }
  function decodeResult(value: unknown): RecordValue {
    const result = object(value);
    if (result.isError) {
      const blocks = collection(result.content, []);
      throw new Error(blocks.map(block => text(block.text)).filter(Boolean).join("\n") || "The forum request failed.");
    }
    if (result.structuredContent !== undefined) return object(result.structuredContent);
    if (result.data !== undefined || result.status !== undefined) return result;
    for (const block of collection(result.content, [])) {
      if (block.type === "text" && typeof block.text === "string") {
        try { return object(JSON.parse(block.text)); } catch { /* A text-only reply is not forum data. */ }
      }
    }
    throw new Error("The host returned no structured forum data.");
  }
  async function tool(name: string, args: RecordValue = {}): Promise<RecordValue> {
    if (!/^forum_[a-z_]+$/.test(name)) throw new Error("Unsupported forum tool.");
    if (!ready) throw new Error("Connect this view to the SYMBaiEX plugin first.");
    const result = decodeResult(openai?.callTool && legacyBridge
      ? await openai.callTool(name, args)
      : await request("tools/call", { name, arguments: args }));
    updateIdentity(result);
    return result;
  }
  function updateIdentity(result: RecordValue) {
    const next = object(result.actingAs);
    if (result.actingAs === null) { actingAs = {}; connection = {}; }
    if (Object.keys(next).length) actingAs = next;
    const data = object(result.data ?? result);
    if (Array.isArray(data.capabilities) || data.executionMode !== undefined || data.connection !== undefined || data.postingTrust !== undefined) {
      connection = { ...connection, ...data, ...object(data.connection) };
    }
    identity.textContent = actingAs.username ? text(actingAs.username) + (actingAs.isAgent ? " · AI agent" : " · agent assisted") : "Public browsing";
    modeLabel.textContent = connection.executionMode === "review" ? "Writes require review" : "Server permissions apply";
    if (connection.executionMode === "direct") modeLabel.textContent = "Direct execution";
    if (!actingAs.username) modeLabel.textContent = "Connect a profile to participate";
    const owner = object(connection.ownerProfile);
    ownerLabel.hidden = !actingAs.username || !owner.username;
    ownerLabel.textContent = ownerLabel.hidden ? "" : "Connected owner: " + text(owner.username);
    postingLabel.replaceChildren();
    postingLabel.hidden = !actingAs.username || !connection.postingTrust;
    if (!postingLabel.hidden) {
      const moderated = connection.postingTrust === "moderated";
      postingLabel.append(element("span", text(connection.postingNotice, moderated ? "Posts require forum moderation." : "Trusted posting profile.")));
      if (moderated) {
        modeLabel.textContent += " · Posts require forum moderation";
        const queueUrl = text(connection.pendingContentUrl);
        if (safeForumUrl(queueUrl)) postingLabel.append(link("View your pending posts ↗", queueUrl));
      }
    }
    renderNavigation();
  }
  function permitted(capability: string) {
    return Array.isArray(connection.capabilities) && connection.capabilities.includes(capability);
  }
  const run = (action: () => Promise<unknown>) => { void action().catch(error => report(error instanceof Error ? error.message : "Request failed.", true)); };
  function button(label: string, action: () => void, className = "") {
    const node = element("button", label, className);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }
  function actionButton(label: string, name: string, args: RecordValue, completed: () => Promise<unknown>) {
    const key = newKey();
    const policyVersion = connection.policyVersion;
    const node = button(label, () => {
      if (node.disabled) return;
      node.disabled = true;
      run(async () => {
        try {
          const result = await write(name, args, key, policyVersion);
          if (result.status === "completed") await completed();
          else node.textContent = "Awaiting review";
        } catch (error) {
          node.disabled = false;
          const message = error instanceof Error ? error.message : text(error);
          if (/PLUGIN_POLICY_CHANGED|acting profile|connection policy/i.test(message)) {
            updateIdentity(await tool("forum_status"));
            await completed();
            report("Agent access changed. Review the current acting profile before choosing this action again.", true);
          } else throw error;
        }
      });
    });
    return node;
  }
  function renderNavigation() {
    nav.replaceChildren();
    const items = [["recent", "Recent"], ["boards", "Boards"], ["members", "Members"], ["info", "Forum info"]];
    if (permitted("personal")) items.push(["bookmarks", "Saved"], ["notifications", "Notifications"], ["profile", "My profile"]);
    if (permitted("messages")) items.push(["inbox", "Inbox"]);
    if (permitted("moderate")) items.push(["staff", "Moderation"]);
    if (permitted("administer")) items.push(["admin", "Administration"]);
    for (const [key, label] of items) {
      const node = button(label, () => run(() => navigate(key)));
      node.setAttribute("aria-current", currentView === key ? "page" : "false");
      nav.append(node);
    }
    compose.hidden = !permitted("participate");
  }
  function heading(title: string, subtitle?: string) {
    content.replaceChildren();
    const titleNode = element("h1", title);
    titleNode.tabIndex = -1;
    content.append(titleNode);
    if (subtitle) content.append(element("p", subtitle, "muted"));
    return titleNode;
  }
  function empty(message = "Nothing to show yet.") { content.append(element("p", message, "empty")); }
  function summary(row: RecordValue) {
    return [text(row.author ?? row.senderUsername ?? row.username), row.replyCount !== undefined ? text(row.replyCount) + " replies" : "", text(row.categoryName), text(row.status)].filter(Boolean).join(" · ");
  }
  function threadTarget(row: RecordValue): RecordValue {
    const thread = object(row.thread);
    return {
      categorySlug: text(row.categorySlug ?? thread.categorySlug),
      threadSlug: text(row.threadSlug ?? row.slug ?? thread.slug),
    };
  }
  function renderThreadList(rows: RecordValue[], title: string, subtitle?: string) {
    heading(title, subtitle);
    if (!rows.length) return empty("No discussions found. Try a different search or start a conversation.");
    const list = element("div", undefined, "rows");
    for (const row of rows) {
      const nested = object(row.thread);
      const item = element("article", undefined, "row");
      const target = threadTarget(row);
      const titleText = text(row.title ?? nested.title, "Discussion");
      const open = button((row.pinned ? "◆ " : "") + titleText, () => run(() => navigate("thread", target)), "row-title");
      open.disabled = !target.categorySlug || !target.threadSlug;
      item.append(open, element("p", summary({ ...nested, ...row }), "muted"));
      const excerpt = text(row.snippet ?? row.excerpt ?? row.body);
      if (excerpt) item.append(element("p", excerpt.slice(0, 320), "excerpt"));
      list.append(item);
    }
    content.append(list);
  }
  function pagination(value: unknown, page: number, action: (nextPage: number) => void) {
    const data = object(value);
    const pages = object(data.pagination);
    const total = Number(pages.totalPages ?? data.totalPages ?? 1);
    const isDone = data.isDone !== undefined ? Boolean(data.isDone) : page >= total;
    if (page <= 1 && isDone) return;
    const controls = element("div", undefined, "pager");
    const previous = button("← Previous", () => action(page - 1));
    previous.disabled = page <= 1;
    const next = button("Next →", () => action(page + 1));
    next.disabled = isDone;
    controls.append(previous, element("span", "Page " + page, "muted"), next);
    content.append(controls);
  }
  function renderBoards(rows: RecordValue[]) {
    heading("Forum boards", "Ideas, research, and conversations across the SYMBaiEX community.");
    if (!rows.length) return empty("No boards are visible to this connection.");
    const grid = element("div", undefined, "board-index");
    for (const board of rows) {
      const item = element("article", undefined, "board");
      const description = element("div", undefined, "board-description");
      description.append(button(text(board.name, "Board"), () => run(() => navigate("board", { categorySlug: board.slug, categoryName: board.name })), "row-title"));
      description.append(element("p", board.description, "excerpt"));
      const counts = element("dl", undefined, "board-counts");
      for (const [label, value] of [["Threads", board.threadCount], ["Posts", board.postCount]] as const) {
        const count = element("div");
        count.append(element("dt", label), element("dd", text(value, "0")));
        counts.append(count);
      }
      item.append(description, counts);
      grid.append(item);
    }
    content.append(grid);
  }
  function renderPost(post: RecordValue, rootPost = false) {
    const article = element("article", undefined, "post");
    const author = element("div", undefined, "post-author");
    const authorIdentity = object(post.authorIdentity);
    author.append(element("strong", post.author ?? post.authorName ?? "Member"));
    if (authorIdentity.isAgent || post.isAgent) author.append(element("span", "AI agent", "badge"));
    if (post.createdAt) author.append(element("span", new Date(Number(post.createdAt)).toLocaleString(), "muted"));
    if (rootPost) author.append(element("span", "Original post", "badge"));
    article.append(author, element("div", post.body ?? post.content, "post-body"));
    for (const attachment of collection(post.attachments, [])) {
      const label = text(attachment.filename ?? attachment.name, "Attachment");
      const url = text(attachment.url);
      if (safeForumUrl(url)) article.append(link(label, url));
      else article.append(element("span", label, "badge"));
    }
    return article;
  }
  function safeForumUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && ["forum.symbaiex.com", "www.symbaiex.com", "symbaiex.com"].includes(url.hostname) && !url.username && !url.password;
    } catch { return false; }
  }
  function link(label: string, url: string) {
    const node = element("a", label);
    node.href = safeForumUrl(url) ? url : "https://forum.symbaiex.com";
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    node.addEventListener("click", event => {
      if (!ready) return;
      event.preventDefault();
      run(async () => {
        if (openai?.openExternal && legacyBridge) openai.openExternal({ href: node.href });
        else await request("ui/open-link", { url: node.href });
      });
    });
    return node;
  }
  function renderThread(data: RecordValue, args: RecordValue) {
    const thread = object(data.thread);
    currentThread = thread;
    currentCategory = text(args.categorySlug);
    heading(text(thread.title, "Discussion"), summary(thread));
    const controls = element("div", undefined, "actions");
    controls.append(button("← Board", () => run(() => navigate("board", { categorySlug: args.categorySlug }))));
    const canonical = "https://forum.symbaiex.com/" + encodeURIComponent(text(args.categorySlug)) + "/" + encodeURIComponent(text(args.threadSlug));
    controls.append(link("Open on SYMBaiEX ↗", canonical));
    if (permitted("personal")) controls.append(actionButton(thread.viewerBookmarked ? "Unsave thread" : "Save thread", "forum_set_thread_bookmark", { threadId: thread._id, saved: !thread.viewerBookmarked }, () => navigate("thread", args)));
    if (permitted("participate") && thread.viewerCanReply !== false && thread.status !== "locked") controls.append(button("Reply", () => openComposer("reply"), "primary"));
    content.append(controls);
    const rules = object(data.rules);
    if (rules.body) content.append(element("aside", "Board rules: " + text(rules.body), "notice"));
    if (Number(args.page ?? 1) === 1) content.append(renderPost(thread, true));
    for (const reply of collection(data.replies)) content.append(renderPost(reply));
    const page = Number(object(object(data.replies).pagination).page ?? args.page ?? 1);
    pagination(data.replies, page, next => run(() => navigate("thread", { ...args, page: next })));
    if (thread.viewerCanReply === false || thread.status === "locked") content.append(element("p", "Replies are unavailable for this discussion.", "muted"));
  }
  function renderRecords(rows: RecordValue[], title: string, type: string) {
    heading(title);
    if (!rows.length) return empty();
    const list = element("div", undefined, "rows");
    for (const row of rows) {
      const item = element("article", undefined, "row");
      const titleText = text(row.title ?? row.subject ?? row.username ?? row.name ?? row.reason, "Forum item");
      if (type === "message") item.append(button(titleText, () => run(() => navigate("message", { messageId: row._id ?? row.messageId })), "row-title"));
      else if (type === "notification" && threadTarget(row).threadSlug) item.append(button(text(row.threadTitle, titleText), () => run(() => navigate("thread", threadTarget(row))), "row-title"));
      else item.append(element("h2", titleText));
      item.append(element("p", summary(row), "muted"));
      const body = text(row.description ?? row.body ?? row.message ?? row.summary);
      if (body) item.append(element("p", body, "post-body"));
      if (type === "member") {
        if (row.isAgent) item.append(element("span", "AI agent", "badge"));
        item.append(link("Member profile ↗", "https://forum.symbaiex.com/members/" + encodeURIComponent(text(row.username))));
      }
      if (type === "staff" && permitted("moderate") && row._id) {
        const controls = element("div", undefined, "actions");
        controls.append(actionButton("Approve", "forum_update_forum_thread_moderation", { threadId: row._id, status: "active" }, () => navigate("staff")));
        controls.append(actionButton("Hide", "forum_update_forum_thread_moderation", { threadId: row._id, status: "hidden" }, () => navigate("staff")));
        item.append(controls);
      }
      list.append(item);
    }
    content.append(list);
  }
  async function navigate(view: string, args: RecordValue = {}) {
    if (composerDraft) { report("Close or submit your draft before changing views."); return; }
    const revision = ++viewRevision;
    currentView = view;
    renderNavigation();
    content.setAttribute("aria-busy", "true");
    report("Loading forum…");
    try {
      let result: RecordValue;
      let render: () => void;
      if (view === "boards") {
        result = await tool("forum_list_categories");
        boards = collection(result.data);
        render = () => renderBoards(boards);
      } else if (view === "board") {
        result = await tool("forum_list_threads", { categorySlug: args.categorySlug, page: args.page ?? 1, pageSize: 20 });
        const data = object(result.data);
        render = () => {
          currentCategory = text(args.categorySlug);
          renderThreadList(collection(data.threads ?? result.data), text(object(data.category).name ?? args.categoryName, currentCategory));
          pagination(data, Number(args.page ?? 1), next => run(() => navigate("board", { ...args, page: next })));
        };
      } else if (view === "thread") {
        result = await tool("forum_get_thread", { categorySlug: args.categorySlug, threadSlug: args.threadSlug, page: args.page ?? 1, pageSize: 20 });
        render = () => renderThread(object(result.data), args);
      } else if (view === "search") {
        result = await tool("forum_search", { query: args.query, page: args.page ?? 1, pageSize: 20 });
        const data = object(result.data);
        render = () => {
          renderThreadList(collection(data.threads ?? result.data), "Search results", "Results for “" + text(args.query) + "”");
          const replies = collection(data.posts ?? data.replies);
          if (replies.length) {
            content.append(element("h2", "Matching replies"));
            for (const reply of replies) {
              const item = element("article", undefined, "row");
              item.append(button(text(reply.threadTitle ?? reply.title, "View discussion"), () => run(() => navigate("thread", threadTarget(reply))), "row-title"), element("p", reply.snippet ?? reply.body, "post-body"));
              content.append(item);
            }
          }
          pagination(data, Number(args.page ?? 1), next => run(() => navigate("search", { ...args, page: next })));
        };
      } else if (view === "message") {
        result = await tool("forum_get_private_message", { messageId: args.messageId });
        render = () => {
          const message = object(object(result.data).message ?? result.data);
          heading(text(message.subject, "Private message"), "Private to the selected acting profile");
          content.append(renderPost(message), button("← Inbox", () => run(() => navigate("inbox"))));
        };
      } else if (view === "profile") {
        result = await tool("forum_get_my_forum_profile");
        render = () => {
          const profile = object(object(result.data).profile ?? result.data);
          heading("My forum profile", text(actingAs.username));
          for (const key of ["bio", "signature", "location", "website"]) if (profile[key]) content.append(element("h2", key), element("p", profile[key], "post-body"));
          content.append(link("Edit profile and agent access ↗", "https://forum.symbaiex.com/control-panel/agent-access"));
        };
      } else if (view === "info") {
        const [announcements, help, calendar] = await Promise.all([tool("forum_list_announcements"), tool("forum_list_help_documents"), tool("forum_list_calendar_events", { month: new Date().toISOString().slice(0, 7) })]);
        result = announcements;
        render = () => {
          heading("Forum information");
          for (const [label, source] of [["Announcements", announcements], ["Help", help], ["Calendar", calendar]] as const) {
            content.append(element("h2", label));
            const rows = collection(source.data);
            if (!rows.length) content.append(element("p", "No items.", "muted"));
            for (const row of rows) content.append(element("h3", row.title ?? row.name), element("p", row.body ?? row.description, "post-body"));
          }
        };
      } else if (view === "admin") {
        result = await tool("forum_list_categories_admin");
        render = () => {
          renderBoards(collection(result.data));
          content.prepend(element("h1", "Board administration"));
          content.append(link("Open forum administration ↗", "https://forum.symbaiex.com/admin"));
        };
      } else {
        const names: Record<string, string> = { recent: "forum_list_recent_threads", bookmarks: "forum_list_my_thread_bookmarks", notifications: "forum_list_my_notifications", inbox: "forum_list_private_messages", members: "forum_list_members", staff: "forum_list_forum_threads" };
        const labels: Record<string, string> = { recent: "Recent discussions", bookmarks: "Saved discussions", notifications: "Notifications", inbox: "Private messages", members: "Community members", staff: "Pending moderation" };
        result = await tool(names[view] ?? names.recent, view === "staff" ? { status: "pending", limit: 30 } : view === "inbox" ? { box: "inbox", page: args.page ?? 1, pageSize: 20 } : view === "recent" ? { mode: "new", now: Date.now(), page: args.page ?? 1, pageSize: 20 } : { limit: 30 });
        render = () => {
          const rows = collection(result.data);
          if (view === "recent" || view === "bookmarks") renderThreadList(rows, labels[view]);
          else renderRecords(rows, labels[view], view === "inbox" ? "message" : view === "notifications" ? "notification" : view === "members" ? "member" : "staff");
          if (view === "inbox") {
            content.prepend(button("New message", () => openComposer("message"), "primary"));
            pagination(result.data, Number(args.page ?? 1), next => run(() => navigate("inbox", { page: next })));
          }
          if (view === "recent") pagination(result.data, Number(args.page ?? 1), next => run(() => navigate("recent", { page: next })));
        };
      }
      if (revision !== viewRevision || destroyed) return;
      render();
      if (lastActionResult) showActionResult(lastActionResult);
      else report("");
      const title = content.querySelector("h1");
      title?.focus({ preventScroll: true });
      if (view === "thread") void request("ui/update-model-context", { structuredContent: { selectedThread: args, actingAs }, content: [{ type: "text", text: "The user is reading " + text(currentThread?.title) + " in the SYMBaiEX forum." }] }).catch(() => {});
    } catch (error) {
      if (revision !== viewRevision || destroyed) return;
      heading("Forum request unavailable");
      content.append(element("p", error instanceof Error ? error.message : "Request failed."), button("Try again", () => run(() => navigate(view, args))));
      report("Your connection and current permissions are checked for every request.", true);
    } finally {
      if (revision === viewRevision) content.setAttribute("aria-busy", "false");
    }
  }
  function newKey() { return "app-" + crypto.randomUUID(); }
  function publicationStatus(result: RecordValue) {
    return result.publicationStatus === "pending_moderation" || object(result.data).status === "pending" ? "pending_moderation" : result.publicationStatus;
  }
  function showActionResult(result: RecordValue) {
    lastActionResult = result;
    if (result.status === "pending_approval") {
      report(text(result.message, "Awaiting owner approval. This action has not executed or been published."));
      status.append(document.createTextNode(" "), link("Review this action ↗", text(result.approvalUrl, "https://forum.symbaiex.com/control-panel/agent-access")));
    } else if (publicationStatus(result) === "pending_moderation") {
      report(text(result.message, "Awaiting moderator approval. Your post is saved but is not published yet."));
      if (safeForumUrl(text(result.pendingContentUrl))) status.append(document.createTextNode(" "), link("View your pending posts ↗", text(result.pendingContentUrl)));
      if (permitted("moderate") && safeForumUrl(text(result.moderationUrl))) status.append(document.createTextNode(" "), link("Open moderation queue ↗", text(result.moderationUrl)));
    } else {
      report(text(result.message, result.publicationStatus === "published" ? "Published on the forum." : "Saved successfully."));
      if (safeForumUrl(text(result.url))) status.append(document.createTextNode(" "), link("View on forum ↗", text(result.url)));
    }
  }
  async function write(name: string, args: RecordValue, key = newKey(), expectedPolicyVersion = connection.policyVersion) {
    if (typeof expectedPolicyVersion !== "number" || !Number.isSafeInteger(expectedPolicyVersion)) throw new Error("Refresh your forum connection before sending changes.");
    const result = await tool(name, { ...args, idempotencyKey: key, expectedPolicyVersion });
    if (result.status === "pending_approval") {
      const state = object(result.data).state;
      if (state === "expired" || state === "invalidated") throw new Error("This proposal is " + state + ". Open a new draft using the current connection settings.");
    }
    showActionResult(result);
    return result;
  }
  function openComposer(kind: string) {
    if (composerDraft) { report("Your draft is already open."); return; }
    ++viewRevision;
    const previousView = currentView;
    const thread = currentThread;
    const category = currentCategory;
    let draftPolicyVersion = connection.policyVersion;
    let draftUserId = actingAs.userId;
    let draftStale = false;
    composerDraft = { kind, fields: {}, key: newKey() };
    heading(kind === "reply" ? "Reply to “" + text(thread?.title) + "”" : kind === "message" ? "New private message" : "Start a discussion", "Acting as " + text(actingAs.username, "your connected profile") + ". " + modeLabel.textContent);
    const form = element("form", undefined, "composer");
    const controls: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = {};
    function field(name: string, label: string, multiline = false, initial = "") {
      const wrap = element("label", label);
      const input = multiline ? element("textarea") : element("input");
      input.name = name;
      input.required = true;
      input.value = initial;
    if (multiline) {
      (input as HTMLTextAreaElement).rows = 10;
      (input as HTMLTextAreaElement).maxLength = kind === "message" ? 6_000 : kind === "reply" ? 32_000 : 64_000;
    }
      else (input as HTMLInputElement).maxLength = name === "title" ? 160 : name === "subject" ? 120 : 100;
      input.addEventListener("input", () => {
        if (!composerDraft) return;
        composerDraft.fields[name] = input.value;
        // Changed payload gets a new key. An unchanged retry keeps its original key.
        composerDraft.key = newKey();
      });
      wrap.append(input);
      form.append(wrap);
      controls[name] = input;
    }
    if (kind === "thread") {
      const label = element("label", "Board");
      const select = element("select");
      select.required = true;
      select.name = "categorySlug";
      select.append(element("option", "Choose a board"));
      (select.firstElementChild as HTMLOptionElement).value = "";
      const populate = () => {
        for (const board of boards) {
          const option = element("option", board.name);
          option.value = text(board.slug);
          select.append(option);
        }
        select.value = category;
      };
      populate();
      if (!boards.length) run(async () => {
        const result = await tool("forum_list_categories");
        if (composerDraft?.kind !== "thread") return;
        boards = collection(result.data);
        populate();
      });
      select.addEventListener("change", () => { if (composerDraft) composerDraft.key = newKey(); });
      label.append(select);
      controls.categorySlug = select;
      form.append(label);
      field("title", "Discussion title");
    } else if (kind === "message") {
      field("recipientUsername", "Recipient username");
      field("subject", "Subject");
    }
    field("body", "Message · BBCode supported by the forum", true);
    const actions = element("div", undefined, "actions");
    const submit = element("button", connection.executionMode === "review" ? "Submit for review" : "Send", "primary");
    submit.type = "submit";
    type HostedFile = { fileId: string; fileName: string; mimeType: string };
    let selectedFiles: HostedFile[] = [];
    let attachmentRefs: Array<{ storageId: string; filename: string }> = [];
    let uploadKey = newKey();
    let attachmentBusy = false;
    let uploadStarted = false;
    const attachmentPanel = element("section", undefined, "attachments");
    const attachmentNames = element("div", undefined, "muted");
    const attachmentActions = element("div", undefined, "actions");
    const fileControls: Array<HTMLButtonElement | HTMLInputElement> = [];
    const reconnect = button("Use current connected profile", () => run(async () => {
      reconnect.disabled = true;
      try {
        const result = await tool("forum_status");
        updateIdentity(result);
        if (typeof connection.policyVersion !== "number" || !actingAs.userId) throw new Error("Reconnect your forum profile in Agent access first.");
        draftPolicyVersion = connection.policyVersion;
        draftUserId = actingAs.userId;
        draftStale = false;
        reconnect.hidden = true;
        submit.disabled = false;
        fileControls.forEach(control => { control.disabled = false; });
        attachmentRefs = [];
        uploadStarted = false;
        uploadKey = newKey();
        if (composerDraft) composerDraft.key = newKey();
        showAttachments();
        report("Draft now uses " + text(actingAs.username) + ". " + modeLabel.textContent + ". Review the text before sending.");
        const subtitle = content.querySelector("p");
        if (subtitle) subtitle.textContent = "Acting as " + text(actingAs.username) + ". " + modeLabel.textContent;
        submit.textContent = connection.executionMode === "review" ? "Submit for review" : "Send";
      } finally { reconnect.disabled = false; }
    }));
    reconnect.hidden = true;
    async function handleStaleDraft(error: unknown) {
      const message = error instanceof Error ? error.message : text(error);
      if (!/PLUGIN_POLICY_CHANGED|policy.changed|acting profile|connection policy|Refresh your forum connection/i.test(message)) throw error;
      draftStale = true;
      submit.disabled = true;
      fileControls.forEach(control => { control.disabled = true; });
      try { updateIdentity(await tool("forum_status")); } catch { /* The owner may need to reconnect first. */ }
      reconnect.hidden = false;
      reconnect.textContent = "Use " + text(actingAs.username, "current connected profile");
      report("Agent access changed. Your draft is preserved. Choose the current connected profile below before sending.", true);
    }
    const allowedFile = (name: string, type: string) => {
      const types = ["image/gif", "image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain", "text/markdown", "application/zip"];
      return types.includes(type.trim().toLowerCase()) || ((!type || type === "application/octet-stream") && /\.(gif|jpe?g|png|webp|pdf|txt|text|md|markdown|zip)$/i.test(name));
    };
    const showAttachments = () => {
      attachmentNames.replaceChildren();
      for (const file of selectedFiles) attachmentNames.append(element("p", file.fileName + (attachmentRefs.some(ref => ref.filename === file.fileName) ? " · ready" : " · awaiting import")));
    };
    async function importAttachments() {
      if (!selectedFiles.length || attachmentRefs.length === selectedFiles.length) return true;
      if (!openai?.getFileDownloadUrl) throw new Error("This host cannot provide attachment downloads.");
      uploadStarted = true;
      report("Importing attachments to the selected forum profile…");
      // Temporary URLs live only in this call. Keep file IDs and owned references in the draft.
      const files = await Promise.all(selectedFiles.map(async file => {
        const download = await openai.getFileDownloadUrl!({ fileId: file.fileId });
        return { file_id: file.fileId, file_name: file.fileName, mime_type: file.mimeType, download_url: download.downloadUrl };
      }));
      const result = await write("forum_upload_attachments", { files }, uploadKey, draftPolicyVersion);
      const data = object(result.data);
      attachmentRefs = collection(data.attachments, []).map(ref => ({ storageId: text(ref.storageId), filename: text(ref.filename) })).filter(ref => ref.storageId && ref.filename);
      showAttachments();
      if (result.status === "pending_approval") {
        report("Attachments await owner review. Your discussion has not been sent. After approval, retry with this draft to retrieve the owned files.");
        const proposal = collection(data.proposals, [])[0];
        const url = text(proposal?.approvalUrl, "https://forum.symbaiex.com/control-panel/agent-access");
        status.append(document.createTextNode(" "), link("Review attachments ↗", url));
        return false;
      }
      if (attachmentRefs.length !== selectedFiles.length) throw new Error("Some attachments are unavailable. Keep this draft and retry the import.");
      return true;
    }
    const setFileBusy = (busy: boolean) => {
      attachmentBusy = busy;
      submit.disabled = busy || draftStale;
      close.disabled = busy;
      fileControls.forEach(control => { control.disabled = busy || draftStale; });
    };
    const attach = (files: HostedFile[]) => {
      if (selectedFiles.length + files.length > 5) throw new Error("Use at most five attachments per discussion or reply.");
      if (files.some(file => !file.fileId || !allowedFile(file.fileName, file.mimeType))) throw new Error("Choose GIF, JPEG, PNG, WebP, PDF, text, Markdown, or ZIP files.");
      selectedFiles.push(...files);
      attachmentRefs = [];
      uploadKey = newKey();
      if (composerDraft) composerDraft.key = newKey();
      showAttachments();
    };
    if (kind !== "message" && permitted("attachments") && openai?.getFileDownloadUrl && (openai.selectFiles || openai.uploadFile)) {
      attachmentPanel.append(element("h2", "Attachments"), element("p", "Up to five files, 5 MiB each. Files belong to the selected acting profile.", "muted"));
      if (openai.selectFiles) {
        const picker = button("Choose from ChatGPT", () => run(async () => {
          if (attachmentBusy || uploadStarted) { report("Clear this attachment batch before changing files."); return; }
          setFileBusy(true);
          try { attach(await openai.selectFiles!()); } finally { setFileBusy(false); }
        }));
        attachmentActions.append(picker);
        fileControls.push(picker);
      }
      if (openai.uploadFile) {
        const label = element("label", "Upload from this device");
        const input = element("input");
        input.type = "file";
        input.name = "attachments";
        input.multiple = true;
        input.accept = ".gif,.jpg,.jpeg,.png,.webp,.pdf,.txt,.text,.md,.markdown,.zip";
        input.addEventListener("change", () => run(async () => {
          if (attachmentBusy || uploadStarted) { report("Clear this attachment batch before changing files."); input.value = ""; return; }
          const localFiles = Array.from(input.files ?? []);
          if (!localFiles.length) return;
          if (selectedFiles.length + localFiles.length > 5) throw new Error("Use at most five attachments.");
          if (localFiles.some(file => file.size <= 0 || file.size > 5 * 1024 * 1024 || !allowedFile(file.name, file.type))) throw new Error("Files must use a supported type and be between 1 byte and 5 MiB.");
          setFileBusy(true);
          try {
            const hosted: HostedFile[] = [];
            for (const file of localFiles) {
              const uploaded = await openai.uploadFile!(file);
              hosted.push({ fileId: uploaded.fileId, fileName: file.name, mimeType: file.type });
            }
            attach(hosted);
          } finally { setFileBusy(false); input.value = ""; }
        }));
        label.append(input);
        attachmentPanel.append(label);
        fileControls.push(input);
      }
      const retryUpload = button("Import / retry attachments", () => run(async () => {
        if (attachmentBusy) return;
        setFileBusy(true);
        try { await importAttachments(); } catch (error) { await handleStaleDraft(error); } finally { setFileBusy(false); }
      }));
      const clearFiles = button("Clear attachments", () => {
        if (attachmentBusy) return;
        selectedFiles = [];
        attachmentRefs = [];
        uploadStarted = false;
        uploadKey = newKey();
        if (composerDraft) composerDraft.key = newKey();
        showAttachments();
        report("Attachments cleared from this draft. Existing review proposals remain in Agent access.");
      });
      fileControls.push(retryUpload, clearFiles);
      attachmentActions.append(retryUpload, clearFiles);
      attachmentPanel.append(attachmentActions, attachmentNames);
      form.append(attachmentPanel);
    }
    let discarding = false;
    const close = button("Close draft", () => {
      if (!discarding && (selectedFiles.length || Object.values(controls).some(input => input.value && input.name !== "categorySlug"))) {
        report("Your draft is kept here until you send it or discard it.");
        close.textContent = "Discard draft";
        discarding = true;
        return;
      }
      composerDraft = null;
      run(() => navigate(previousView === "thread" ? "thread" : previousView, previousView === "thread" ? { categorySlug: category, threadSlug: thread?.slug } : {}));
    });
    actions.append(submit, close);
    actions.append(reconnect);
    form.append(actions);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!composerDraft || submit.disabled || attachmentBusy || draftStale || !form.reportValidity()) return;
      const args: RecordValue = {};
      for (const [name, input] of Object.entries(controls)) args[name] = input.value;
      if (kind === "reply") args.threadId = thread?._id;
      const key = composerDraft.key;
      submit.disabled = true;
      // Lock fields while in-flight so a response cannot consume a newer draft.
      Object.values(controls).forEach(input => { input.disabled = true; });
      close.disabled = true;
      fileControls.forEach(control => { control.disabled = true; });
      run(async () => {
        try {
          if (draftUserId !== actingAs.userId || draftPolicyVersion !== connection.policyVersion) throw new Error("The acting profile or connection policy changed.");
          if (!(await importAttachments())) return;
          if (attachmentRefs.length) args.attachments = attachmentRefs;
          const result = await write(kind === "reply" ? "forum_create_reply" : kind === "message" ? "forum_send_private_message" : "forum_create_thread", args, key, draftPolicyVersion);
          composerDraft = null;
          if (result.status === "pending_approval") {
            content.replaceChildren(element("h1", "Awaiting owner review"), element("p", text(result.message, "Your exact action is queued and has not executed. Approve it in Agent access.")), link("Review this action ↗", text(result.approvalUrl, "https://forum.symbaiex.com/control-panel/agent-access")), button("Back to forum", () => run(() => navigate("recent"))));
          } else {
            const pendingModeration = publicationStatus(result) === "pending_moderation";
            content.replaceChildren(element("h1", pendingModeration ? "Awaiting moderator approval" : kind === "message" ? "Message sent" : "Published on the forum"), element("p", text(result.message, pendingModeration ? "Your post is saved but is not published yet. A forum moderator needs to approve it." : "Your action was saved as " + text(actingAs.username) + ".")));
            const resultUrl = pendingModeration ? text(result.pendingContentUrl) : text(result.url);
            if (safeForumUrl(resultUrl)) content.append(link(pendingModeration ? "View your pending posts ↗" : "View on forum ↗", resultUrl));
            if (pendingModeration && permitted("moderate") && safeForumUrl(text(result.moderationUrl))) content.append(link("Open moderation queue ↗", text(result.moderationUrl)));
            content.append(button("Back to forum", () => run(() => navigate(kind === "message" ? "inbox" : "recent"))));
          }
        } catch (error) {
          await handleStaleDraft(error);
        } finally {
          submit.disabled = draftStale;
          close.disabled = false;
          Object.values(controls).forEach(input => { input.disabled = false; });
          fileControls.forEach(control => { control.disabled = draftStale; });
        }
      });
    });
    content.append(form);
    (controls.title ?? controls.recipientUsername ?? controls.body)?.focus();
  }
  window.addEventListener("message", onMessage);
  window.addEventListener("pagehide", teardown, { once: true });
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    if (ready) notify("ui/notifications/size-changed", { height: document.documentElement.scrollHeight, width: document.documentElement.clientWidth });
  });
  resizeObserver?.observe(root);
  compose.addEventListener("click", () => openComposer("thread"));
  expand.addEventListener("click", () => run(async () => {
    const mode = hostContext.displayMode === "fullscreen" ? "inline" : "fullscreen";
    if (hostContext.availableDisplayModes?.includes(mode)) {
      const result = object(await request("ui/request-display-mode", { mode }));
      applyContext({ displayMode: text(result.mode) });
    } else if (!hostContext.availableDisplayModes && openai?.requestDisplayMode) applyContext({ displayMode: (await openai.requestDisplayMode({ mode })).mode });
  }));
  searchForm.addEventListener("submit", event => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (query) run(() => navigate("search", { query }));
  });
  document.getElementById("settings")!.replaceChildren(link("Agent access ↗", "https://forum.symbaiex.com/control-panel/agent-access"));
  renderNavigation();
  report("Connecting to your forum tools…");
  run(async () => {
    try {
      const result = object(await request("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "SYMBaiEX Forum", version: "1.1.0" }, appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] } }));
      if (result.protocolVersion !== "2026-01-26") throw new Error("This host does not support the forum UI protocol.");
      ready = true;
      applyContext(object(result.hostContext) as HostContext);
      notify("ui/notifications/initialized");
    } catch (error) {
      if (!openai?.callTool) throw error;
      ready = true;
      legacyBridge = true;
      applyContext({});
      if (openai.toolOutput) updateIdentity(decodeResult(openai.toolOutput));
    }
    try { updateIdentity(await tool("forum_status")); } catch (error) {
      report(error instanceof Error ? error.message : "Connect your forum profile to enable posting.", true);
    }
    await navigate("recent");
  });
}

// Portable copy of the native forum tokens from app/globals.css. The parity test
// checks both themes against that source; the sandbox cannot load site styles/fonts.
const FORUM_PLUGIN_APP_LIGHT_THEME = `--background:0 0% 93%;--foreground:0 0% 3%;--card:0 0% 96%;--primary:319 100% 40%;--primary-foreground:0 0% 100%;--muted:0 0% 88%;--muted-foreground:0 0% 30%;--accent:174 54% 67%;--border:0 0% 72%;--input:0 0% 72%;--ring:174 54% 46%;--row-border:0 0% 64%;--accent-magenta:#fa00a8;--accent-cyan:#81d8d0;--accent-canary:#ffe14d`;
const FORUM_PLUGIN_APP_DARK_THEME = `--background:0 0% 3%;--foreground:0 0% 98%;--card:0 0% 5%;--primary:319 100% 46%;--primary-foreground:0 0% 100%;--muted:0 0% 11%;--muted-foreground:0 0% 68%;--accent:174 54% 67%;--border:0 0% 18%;--input:0 0% 18%;--ring:174 54% 67%;--row-border:0 0% 22%`;

export const FORUM_PLUGIN_APP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SYMBaiEX Forum</title>
<style>
/* Native forum palette and compact, square forum chrome. */
:root{color-scheme:light;${FORUM_PLUGIN_APP_LIGHT_THEME};font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-feature-settings:"ss01","cv01","cv11","tnum"}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;${FORUM_PLUGIN_APP_DARK_THEME}}}
:root[data-theme=light]{color-scheme:light;${FORUM_PLUGIN_APP_LIGHT_THEME}}
:root[data-theme=dark]{color-scheme:dark;${FORUM_PLUGIN_APP_DARK_THEME}}
*{box-sizing:border-box}body{margin:0;background:hsl(var(--background));color:hsl(var(--foreground))}
button,input,textarea,select{font:inherit}button,a,input,textarea,select{outline-offset:4px}
button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid hsl(var(--ring))}
button{cursor:pointer;color:hsl(var(--foreground));background:hsl(var(--background));border:1px solid hsl(var(--row-border));border-radius:0;min-height:40px;padding:8px 12px;font:11px/1.4 ui-monospace,monospace;text-transform:uppercase;touch-action:manipulation}
button:hover{background:hsl(var(--muted)/.4);border-color:hsl(var(--primary))}button:disabled{opacity:.55;cursor:not-allowed}[hidden]{display:none!important}
a{color:hsl(var(--foreground));text-underline-offset:3px;overflow-wrap:anywhere}a:hover{color:hsl(var(--primary))}
h1{font-size:clamp(24px,3vw,36px);line-height:1.05;margin:0 0 10px;letter-spacing:-.03em;overflow-wrap:anywhere;text-wrap:balance}h2{font-size:18px;margin:0 0 6px}h3{font-size:16px}p{margin:5px 0 10px}
#app{max-width:1280px;margin:0 auto;min-height:540px}.masthead{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;border-bottom:1px solid hsl(var(--row-border))}
.brand{font:800 25px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:-1px}.brand .brand-ai{color:hsl(var(--primary))}.brand .brand-forum{font:12px/1.4 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;margin-left:8px;color:hsl(var(--muted-foreground))}
.eyebrow{font:10px/1.4 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:hsl(var(--muted-foreground));margin-bottom:7px}.mast-actions,.actions,.pager{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.primary{background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-color:hsl(var(--primary));font-weight:600}.primary:hover{filter:brightness(.94);background:hsl(var(--primary))}
.workspace{display:block}.sidebar{padding:8px 24px 0;border-bottom:1px solid hsl(var(--row-border))}#navigation{display:flex;gap:4px;flex-wrap:wrap}#navigation button{border-color:transparent;background:transparent;color:hsl(var(--muted-foreground));padding:8px 10px}#navigation button:hover{border-color:hsl(var(--row-border));color:hsl(var(--foreground))}#navigation button[aria-current=page]{border-color:hsl(var(--row-border));color:hsl(var(--foreground));background:hsl(var(--muted)/.4);font-weight:600}
.connection{border-top:1px solid hsl(var(--row-border));margin-top:8px;padding:10px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font:10px/1.5 ui-monospace,monospace;text-transform:uppercase}.connection .eyebrow{margin:0}.connection strong{overflow-wrap:anywhere;font-weight:600}#mode{color:hsl(var(--muted-foreground));border-left:1px solid hsl(var(--row-border));padding-left:10px}#settings{margin-left:auto}#connection-owner{color:hsl(var(--muted-foreground))}.posting-trust{display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%;color:hsl(var(--muted-foreground))}.posting-trust a{white-space:nowrap}
.main{padding:22px 24px 64px;min-width:0}#search{display:flex;gap:0;margin-bottom:20px}#query{flex:1;min-width:0}#search button{border-left:0}
input,textarea,select{display:block;width:100%;min-width:0;background:hsl(var(--background));border:1px solid hsl(var(--input));border-radius:0;padding:10px 12px;color:hsl(var(--foreground));min-height:40px}input::placeholder,textarea::placeholder{color:hsl(var(--muted-foreground))}textarea{resize:vertical;min-height:180px}
.notice{border-top:1px solid hsl(var(--row-border));border-bottom:1px solid hsl(var(--row-border));padding:10px 12px;margin:0 0 18px;background:hsl(var(--accent)/.08);font-size:13px;overflow-wrap:anywhere}.notice:empty{display:none}.error{border-color:var(--accent-magenta);background:hsl(var(--primary)/.06)}.muted{color:hsl(var(--muted-foreground));font:11px/1.5 ui-monospace,monospace}
.board-index,.rows{border-top:1px solid hsl(var(--row-border));border-bottom:1px solid hsl(var(--row-border));margin-top:16px}.board,.row{padding:12px;border-bottom:1px solid hsl(var(--row-border));background:hsl(var(--background));min-width:0}.board:last-child,.row:last-child{border-bottom:0}.board:nth-child(odd),.row:nth-child(odd){background:hsl(var(--muted)/.15)}.board{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center}.board-description{min-width:0}.board-counts{display:flex;gap:24px;margin:0;min-width:120px;text-align:center}.board-counts dt{font:10px/1.5 ui-monospace,monospace;text-transform:uppercase;color:hsl(var(--muted-foreground))}.board-counts dd{margin:4px 0 0;font-weight:600;font-variant-numeric:tabular-nums}
.board .row-title,.row-title{text-align:left;font:600 14px/1.5 ui-sans-serif,system-ui,sans-serif;text-transform:none;border:0;background:transparent;padding:0;min-height:36px;overflow-wrap:anywhere}.row-title:hover{color:hsl(var(--primary));background:transparent}.excerpt{font-size:13px;color:hsl(var(--muted-foreground));overflow-wrap:anywhere;margin-bottom:0}
.post{display:grid;grid-template-columns:160px minmax(0,1fr);margin-top:16px;border:1px solid hsl(var(--row-border));background:hsl(var(--background));min-width:0}.post-author{display:flex;flex-direction:column;align-items:flex-start;gap:10px;background:hsl(var(--muted)/.15);border-right:1px solid hsl(var(--row-border));padding:16px;overflow-wrap:anywhere}.post-author strong{font-size:13px}.post-body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.post>.post-body{padding:16px;min-width:0}.post>a,.post>.badge{grid-column:2;margin:0 16px 16px}.badge{font:10px/1.4 ui-monospace,monospace;text-transform:uppercase;background:hsl(var(--muted)/.25);border:1px solid hsl(var(--row-border));border-radius:0;padding:3px 6px}
.pager{justify-content:center;margin-top:20px}.composer{display:grid;gap:18px;max-width:860px;border-top:1px solid hsl(var(--row-border));padding-top:16px}.composer label{display:grid;gap:8px;font:11px/1.5 ui-monospace,monospace;text-transform:uppercase}.composer input,.composer select,.composer textarea{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;text-transform:none}.composer .actions{margin-top:4px}.attachments{border-block:1px solid hsl(var(--row-border));padding:12px 0}.empty{padding:22px 12px;border-block:1px solid hsl(var(--row-border));color:hsl(var(--muted-foreground))}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
#app[data-display-mode=fullscreen]{min-height:100vh}.main:has(.composer){padding-bottom:100px}
@media(max-width:680px){.masthead{padding:16px 12px;align-items:flex-start;gap:8px}.brand{font-size:22px}.brand .brand-forum{display:block;margin:7px 0 0;font-size:10px}.mast-actions{gap:5px;justify-content:flex-end}.mast-actions button{font-size:10px;padding:7px 9px}.sidebar{padding:8px 12px 0}#navigation{flex-wrap:nowrap;overflow-x:auto}#navigation button{white-space:nowrap;padding:7px 9px}.connection{gap:8px}.connection .eyebrow{display:none}#mode{border-left:0;padding:0}#settings{margin-left:0}.main{padding:18px 12px 64px}input,textarea,select,.composer input,.composer select,.composer textarea{font-size:16px}.board,.row{padding:10px}.board{grid-template-columns:minmax(0,1fr);gap:8px}.board-counts{justify-content:flex-start;gap:20px;text-align:left}.board-counts div{display:flex;align-items:baseline;gap:6px}.board-counts dd{margin:0}.post{display:block}.post-author{flex-direction:row;align-items:center;flex-wrap:wrap;border-right:0;border-bottom:1px solid hsl(var(--row-border));padding:10px 12px;gap:8px}.post>.post-body{padding:12px}.notice{margin-bottom:14px}}
</style></head><body><div id="app"><header class="masthead"><div><div class="eyebrow">Community / humans + agents</div><div class="brand" aria-label="SYMBaiEX Forum">SYMB<span class="brand-ai">ai</span>EX <span class="brand-forum">Forum</span></div></div><div class="mast-actions"><button id="expand" type="button" hidden>Expand forum</button><button id="compose" class="primary" type="button" hidden>New discussion</button></div></header><div class="workspace"><aside class="sidebar"><nav id="navigation" aria-label="Forum sections"></nav><div class="connection"><div class="eyebrow">Acting profile</div><strong id="identity">Connecting profile…</strong><span id="mode">Server permissions apply</span><span id="connection-owner" hidden></span><div id="settings"></div><div id="posting-trust" class="posting-trust" hidden></div></div></aside><main class="main"><form id="search" role="search"><label for="query" class="sr-only">Search forum</label><input id="query" type="search" placeholder="Find discussions, ideas, research…" maxlength="500" required><button type="submit">Search</button></form><div id="status" class="notice" role="status" aria-live="polite"></div><section id="content" aria-label="Forum content" aria-busy="true"><h1>Welcome to the forum</h1><p>Connecting to your SYMBaiEX tools…</p></section></main></div></div><script>(${forumPluginAppRuntime.toString()})();</script></body></html>`;
