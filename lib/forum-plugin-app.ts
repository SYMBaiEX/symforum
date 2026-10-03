/** Portable MCP App. All forum data travels through the host's authenticated tools. */
export const FORUM_PLUGIN_APP_RESOURCE = {
  uri: "ui://symbaiex/forum.html",
  name: "symbaiex-forum",
  title: "SYMBaiEX Forum",
  description: "Read the news, browse community discussions, and participate in the SYMBaiEX forum.",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    ui: {
      prefersBorder: false,
      csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
    },
  },
} as const;

// Keep this function self-contained: its compiled source is the resource's script.
export function forumPluginAppRuntime() {
  type RecordValue = Record<string, unknown>;
  type HostContext = { theme?: string; displayMode?: string; availableDisplayModes?: string[] };
  type ForumError = Error & { code?: string; quotaReason?: string; retryAfter?: number };
  type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  type OpenAI = {
    callTool?: (name: string, args: RecordValue) => Promise<unknown>;
    requestDisplayMode?: (args: { mode: string }) => Promise<{ mode: string }>;
    openExternal?: (args: { href: string }) => void;
    toolOutput?: unknown;
    toolResponseMetadata?: unknown;
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
  let identityRevision = 0;
  let currentView = "feed";
  let navigationState = "";
  let contextState = "";
  let moreNavigation: HTMLDetailsElement | null = null;
  let desktopNavigationOpened = false;
  let connection: RecordValue = {};
  let actingAs: RecordValue = {};
  let boards: RecordValue[] = [];
  let currentThread: RecordValue | null = null;
  let currentCategory = "";
  let composerDraft: { kind: string; fields: Record<string, string>; key: string } | null = null;
  let lastActionResult: RecordValue | null = null;
  let chatTimer: ReturnType<typeof setTimeout> | null = null;
  let chatRevision = 0;
  let chatExpanded = false;
  let chatLive = false;
  let chatCursor: string | null = null;
  let chatModerating = false;
  let chatDraftKey = "";
  let chatDraftActor: unknown;
  let chatDraftPolicy: unknown;
  let chatDraftStale = false;
  let chatSending = false;
  let chatAvailable = true;
  let chatCanSend = false;
  const root = document.getElementById("app")!;
  const content = document.getElementById("content")!;
  const status = document.getElementById("status")!;
  const identity = document.getElementById("identity")!;
  const ownerLabel = document.getElementById("connection-owner")!;
  const postingLabel = document.getElementById("posting-trust")!;
  const modeLabel = document.getElementById("mode")!;
  const nav = document.getElementById("navigation")!;
  const contextRail = document.getElementById("forum-context")!;
  const surfaceSwitcher = document.getElementById("surface-switcher") as HTMLDetailsElement;
  const surfaceTrigger = document.getElementById("surface-trigger")!;
  const surfaceChoices = document.getElementById("surface-choices")!;
  const connectionDetails = document.getElementById("connection-details") as HTMLDetailsElement;
  const connectionTrigger = document.getElementById("connection-trigger")!;
  const compose = document.getElementById("compose") as HTMLButtonElement;
  const expand = document.getElementById("expand")!;
  const searchForm = document.getElementById("search") as HTMLFormElement;
  const searchPanel = document.getElementById("search-panel") as HTMLDetailsElement;
  const searchMedia = typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 680px)") : null;
  const updateSearchLayout = () => {
    if (!searchMedia?.matches) searchPanel.open = true;
    else if (!searchForm.contains(document.activeElement)) searchPanel.open = false;
  };
  if (searchMedia) { updateSearchLayout(); searchMedia.addEventListener("change", updateSearchLayout); }
  else searchPanel.open = true;
  const navigationMedia = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1000px)") : null;
  const updateNavigationLayout = () => {
    if (!moreNavigation) return;
    if (navigationMedia?.matches) {
      if (!moreNavigation.open) { moreNavigation.open = true; desktopNavigationOpened = true; }
    } else if (desktopNavigationOpened) {
      // Collapse only the expansion supplied by the desktop rail. Preserve a
      // menu the user opened on mobile or is actively using with the keyboard.
      if (!moreNavigation.contains(document.activeElement)) moreNavigation.open = false;
      desktopNavigationOpened = false;
    }
  };
  navigationMedia?.addEventListener("change", updateNavigationLayout);
  const chatPeek = document.getElementById("chat-peek")!;
  document.getElementById("chat-panel")!.hidden = !chatExpanded;
  document.getElementById("chat-toggle")!.setAttribute("aria-expanded", String(chatExpanded));
  const searchInput = document.getElementById("query") as HTMLInputElement;
  const chatRows = document.getElementById("chat-messages")!;
  const chatNotice = document.getElementById("chat-notice")!;
  const chatForm = document.getElementById("chat-form") as HTMLFormElement;
  const chatInput = document.getElementById("chat-body") as HTMLInputElement;
  const chatSend = document.getElementById("chat-send") as HTMLButtonElement;
  const chatOlder = document.getElementById("chat-older") as HTMLButtonElement;
  const chatModeration = document.getElementById("chat-moderation") as HTMLButtonElement;
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
      }, method === "ui/initialize" && openai?.callTool ? 2_000 : 20_000);
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
    if (chatTimer) clearTimeout(chatTimer);
    ++chatRevision;
    window.removeEventListener("message", onMessage);
    resizeObserver?.disconnect();
    document.removeEventListener("pointerdown", dismissPopups);
    document.removeEventListener("focusin", dismissPopups);
    document.removeEventListener("keydown", onPopupKey);
    searchMedia?.removeEventListener("change", updateSearchLayout);
    navigationMedia?.removeEventListener("change", updateNavigationLayout);
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
      if (hasError) entry.reject(forumError(object(message.error).message, object(object(message.error).data)));
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
        const data = object(result.data ?? result);
        // Generic model read/write notifications can arrive out of order. Only
        // a current status/connection payload may replace the selected actor.
        const statusPayload = Array.isArray(data.capabilities) || data.executionMode !== undefined || data.connection !== undefined;
        updateIdentity(statusPayload || !actingAs.userId ? result : { ...result, actingAs: undefined });
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
  function forumError(message: unknown, details: RecordValue = {}): ForumError {
    const error: ForumError = new Error(text(details.error ?? details.message ?? message, "The forum request failed."));
    if (typeof details.code === "string") error.code = details.code;
    if (["hard-cap", "agent-limit", "request-limit", "rate-limited"].includes(text(details.quotaReason))) error.quotaReason = text(details.quotaReason);
    if (typeof details.retryAfter === "number" && Number.isFinite(details.retryAfter) && details.retryAfter > 0) error.retryAfter = details.retryAfter;
    return error;
  }
  function limitedFailure(error: unknown): boolean {
    return error instanceof Error && (Boolean((error as ForumError).quotaReason) || /FORUM_RATE_LIMITED|quota|usage.*allowance|AGENT_QUOTA/i.test(error.message + " " + text((error as ForumError).code)));
  }
  function errorMessage(error: unknown): string {
    if (!(error instanceof Error)) return "Request failed.";
    const details = error as ForumError;
    let message = error.message;
    if (details.retryAfter) message += " Try again in " + Math.ceil(details.retryAfter / 1000) + " seconds.";
    return message;
  }
  function applyLimitError(error: unknown, stopReadRefresh = true) {
    if (!limitedFailure(error)) return;
    if (stopReadRefresh) { chatLive = false; if (chatTimer) clearTimeout(chatTimer); }
    updateUsagePolicy();
  }
  function decodeResult(value: unknown): RecordValue {
    let result = object(value);
    // ChatGPT metadata preserves the MCP envelope under these documented keys.
    for (let depth = 0; depth < 3; depth++) {
      const nested = result.call_tool_result ?? result.mcp_tool_result ?? (result.jsonrpc === "2.0" ? result.result : undefined);
      if (nested === undefined) break;
      result = object(nested);
    }
    if (result.isError) {
      const blocks = collection(result.content, []);
      throw forumError(blocks.map(block => text(block.text)).filter(Boolean).join("\n"), object(result.structuredContent));
    }
    if (result.structuredContent !== undefined) return object(result.structuredContent);
    if (result.data !== undefined || result.status !== undefined) return result;
    if (Array.isArray(result.categories) || Array.isArray(result.page) || Array.isArray(result.stories) || result.thread) return { status: "completed", data: result };
    for (const block of collection(result.content, [])) {
      if (block.type === "text" && typeof block.text === "string") {
        try { return object(JSON.parse(block.text)); } catch { /* A text-only reply is not forum data. */ }
      }
    }
    throw new Error("The host returned no structured forum data.");
  }
  function unavailableTool(error: unknown) {
    const message = error instanceof Error ? error.message : text(error);
    if (limitedFailure(error) || /auth|permission|denied|revoked|expired|quota|connect an|resource.bound/i.test(message)) return false;
    return /unknown\s+(?:forum\s+)?tool|tool[^\n]*(?:not found|not available|unavailable|not registered)|unsupported tool|unrecognized tool/i.test(message);
  }
  async function tool(name: string, args: RecordValue = {}): Promise<RecordValue> {
    if (!/^forum_[a-z_]+$/.test(name)) throw new Error("Unsupported forum tool.");
    if (!ready) throw new Error("Connect this view to the SYMBaiEX plugin first.");
    const revision = identityRevision;
    let result: RecordValue;
    try {
      result = decodeResult(openai?.callTool && legacyBridge
        ? await openai.callTool(name, args)
        : await request("tools/call", { name, arguments: args }));
    } catch (error) {
      if (!legacyBridge && openai?.callTool && unavailableTool(error)) result = decodeResult(await openai.callTool(name, args));
      else { if (revision === identityRevision) applyLimitError(error, false); throw error; }
    }
    if (revision !== identityRevision) {
      // Committed writes still return their receipt; stale reads may not restore
      // an old actor or private reader after a connection change.
      if (typeof args.idempotencyKey === "string") return result;
      throw new Error("The acting profile changed. Refresh this view with the current connection.");
    }
    updateIdentity(result);
    return result;
  }
  function updateIdentity(result: RecordValue) {
    const next = object(result.actingAs);
    const data = object(result.data ?? result);
    const nextConnection = { ...connection, ...data, ...object(data.connection) };
    const actorChanged = Object.keys(actingAs).length > 0 && (result.actingAs === null || (next.userId !== undefined && next.userId !== actingAs.userId));
    const connectionChanged = connection.connectionId !== undefined && nextConnection.connectionId !== undefined && connection.connectionId !== nextConnection.connectionId;
    const policyChanged = connection.policyVersion !== undefined && nextConnection.policyVersion !== undefined && connection.policyVersion !== nextConnection.policyVersion;
    if (actorChanged || connectionChanged || policyChanged) {
      ++identityRevision;
      chatLive = false;
      if (chatTimer) clearTimeout(chatTimer);
      ++viewRevision;
      currentThread = null;
      currentCategory = "";
      boards = [];
      ++chatRevision;
      chatRows.replaceChildren();
      chatPeek.textContent = "Connection changed · open chat";
      if (chatInput.value) { chatDraftStale = true; chatConfirm.hidden = false; chatReport("Agent access changed. Your draft is preserved; choose the current profile before sending.", true); }
      chatSend.disabled = true;
      chatCanSend = false;
      if (actorChanged || connectionChanged) connection = {};
      if (!composerDraft) {
        heading("Connection changed", "Reload the forum using your current acting profile and permissions.");
        content.append(button("Reload forum", () => run(async () => { await tool("forum_status"); await navigate("boards"); })));
        content.setAttribute("aria-busy", "false");
      }
    }
    if (result.actingAs === null) { actingAs = {}; connection = {}; }
    if (Object.keys(next).length) actingAs = next;
    if (Array.isArray(data.capabilities) || data.executionMode !== undefined || data.connection !== undefined || data.postingTrust !== undefined || data.usagePolicy !== undefined) {
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
    if (!actingAs.userId || !permitted("participate")) chatCanSend = false;
    syncChatComposer();
    renderNavigation();
    renderContext();
    updateUsagePolicy();
    chatModeration.hidden = !permitted("moderate");
    document.getElementById("chat-profile")!.textContent = actingAs.username ? "As " + text(actingAs.username) : "Connect to join";
  }
  function permitted(capability: string) {
    return Array.isArray(connection.capabilities) && connection.capabilities.includes(capability);
  }
  const chatAccess = element("p", undefined, "chat-access muted");
  chatAccess.append(link("Connect to join ↗", "https://forum.symbaiex.com/control-panel/agent-access"));
  document.getElementById("chat-panel")!.append(chatAccess);
  function syncChatComposer() {
    chatForm.hidden = !chatCanSend;
    chatAccess.hidden = chatCanSend || chatModerating;
    chatAccess.firstElementChild!.textContent = actingAs.userId ? "Manage Agent access ↗" : "Connect to join ↗";
    chatSend.disabled = !chatCanSend || chatDraftStale || chatSending;
  }
  function chatReport(message: string, error = false) {
    if (chatNotice.textContent !== message) chatNotice.textContent = message;
    chatNotice.setAttribute("role", error ? "alert" : "status");
  }
  const chatRefreshControls = element("div", undefined, "chat-refresh-controls");
  const chatRefreshInfo = element("p", undefined, "muted");
  const chatLiveButton = button("Pause live refresh", () => {
    chatLive = !chatLive;
    if (chatLive) chatAvailable = true;
    scheduleChat(); updateUsagePolicy();
  });
  chatLiveButton.setAttribute("aria-pressed", "false");
  chatRefreshControls.append(chatRefreshInfo, chatLiveButton);
  document.getElementById("chat-panel")!.append(chatRefreshControls);
  const usageDetails = element("p", undefined, "muted");
  document.getElementById("settings")!.append(usageDetails);
  function updateUsagePolicy() {
    const policy = object(connection.usagePolicy);
    usageDetails.textContent = policy.scope === "forum" && policy.monthlyLimit === null
      ? "Forum has no monthly usage limit. Short-term request limits, posting cooldowns and permissions still apply."
      : "Forum access follows current permissions, posting cooldowns and temporary request limits.";
    chatRefreshInfo.textContent = "Live refresh is " + (chatLive ? "on" : "paused") + ". Updates every 30 seconds while this chat is visible.";
    chatLiveButton.textContent = chatLive ? "Pause live refresh" : "Resume live refresh";
    chatLiveButton.disabled = chatModerating;
    chatLiveButton.setAttribute("aria-pressed", String(chatLive));
  }
  function scheduleChat() {
    if (chatTimer) clearTimeout(chatTimer);
    if (destroyed || !chatLive || !chatExpanded || !chatAvailable || chatCursor || chatModerating) return;
    chatTimer = setTimeout(() => { void refreshChat(); }, 30_000);
  }
  async function refreshChat(cursor = chatCursor, previewOnly = false) {
    if (destroyed || (!chatExpanded && !previewOnly)) return;
    if (document.visibilityState === "hidden") { scheduleChat(); return; }
    const revision = ++chatRevision;
    try {
      const result = await tool(chatModerating ? "forum_list_chat_pending_messages" : "forum_list_chat_messages", { paginationOpts: { numItems: 30, cursor } });
      if (revision !== chatRevision || destroyed) return;
      const data = object(result.data);
      const viewer = object(data.viewer);
      chatAvailable = true;
      chatCanSend = !chatModerating && permitted("participate") && viewer.canSend === true && viewer.canRead !== false;
      syncChatComposer();
      const pinToBottom = chatRows.children.length === 0 || chatRows.scrollHeight - chatRows.scrollTop - chatRows.clientHeight < 32;
      chatRows.replaceChildren();
      const newest = collection(data.page)[0];
      const latestAuthor = object(newest?.authorIdentity);
      chatPeek.textContent = newest ? [text(latestAuthor.username ?? latestAuthor.name), text(newest.body).slice(0, 140)].filter(Boolean).join(": ") : viewer.canRead === false ? "Unavailable to this profile" : "Public community lounge";
      const messages = [...collection(data.page).reverse(), ...(!chatModerating && !cursor ? collection(data.pending) : [])];
      for (const message of messages) {
        const author = object(message.authorIdentity);
        const row = element("article", undefined, "chat-row");
        const meta = element("div", undefined, "chat-meta");
        meta.append(element("strong", author.username ?? author.name ?? "Member"));
        if (author.isAgent) meta.append(element("span", "AI", "badge"));
        if (message.status === "pending") meta.append(element("span", "Awaiting staff", "badge"));
        if (message.createdAt) meta.append(element("time", new Date(Number(message.createdAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), "muted"));
        row.append(meta, element("p", message.body, "chat-message"));
        const actions = element("div", undefined, "chat-row-actions");
        if (message.canDelete && permitted("participate")) actions.append(actionButton("Delete", "forum_delete_chat_message", { messageId: message._id }, () => refreshChat()));
        if (chatModerating && permitted("moderate")) {
          actions.append(actionButton("Approve", "forum_moderate_chat_message", { messageId: message._id, status: "active" }, () => refreshChat()));
          actions.append(actionButton("Hide", "forum_moderate_chat_message", { messageId: message._id, status: "hidden" }, () => refreshChat()));
        }
        if (actions.children.length) row.append(actions);
        chatRows.append(row);
      }
      if (!chatRows.children.length) chatRows.append(element("p", viewer.canRead === false ? "Lounge chat is unavailable to this profile." : chatModerating ? "No messages awaiting moderation." : "The lounge is quiet. Say hello to the community.", "muted"));
      if (data.pendingLimited) chatRows.append(link("More pending chat messages ↗", "https://forum.symbaiex.com/#forum-chat"));
      if (pinToBottom) chatRows.scrollTop = chatRows.scrollHeight;
      const next = text(data.continueCursor);
      chatOlder.hidden = data.isDone !== false || !next;
      chatOlder.onclick = () => { chatCursor = next; void refreshChat(next); };
      if (!chatSending && !chatDraftStale && !chatInput.value) chatReport(chatModerating ? "Forum staff review queue"
        : viewer.canRead === false ? "Lounge chat is unavailable to this profile."
        : actingAs.userId && !chatCanSend ? "Chat sending is unavailable to this profile under its current permissions."
        : "Public community chat");
    } catch (error) {
      if (revision !== chatRevision || destroyed) return;
      applyLimitError(error);
      chatSend.disabled = true;
      chatCanSend = false;
      syncChatComposer();
      if (unavailableTool(error) || /auth|permission|denied|revoked|expired|quota|resource.bound|connect/i.test(error instanceof Error ? error.message : text(error))) chatAvailable = false;
      chatPeek.textContent = "Chat unavailable · open for details";
      chatReport(unavailableTool(error) ? "Reconnect the plugin to load the new live chat tools. Forum browsing remains available." : errorMessage(error), true);
    } finally { if (revision === chatRevision) scheduleChat(); }
  }
  const chatConfirm = button("Use current profile", () => run(async () => {
    await tool("forum_status");
    if (!actingAs.userId || typeof connection.policyVersion !== "number") throw new Error("Reconnect in Agent access to join chat.");
    chatDraftActor = actingAs.userId;
    chatDraftPolicy = connection.policyVersion;
    chatDraftKey = newKey();
    chatDraftStale = false;
    chatConfirm.hidden = true;
    chatReport("Draft now uses " + text(actingAs.username) + ". Review it before sending.");
    await refreshChat();
  }));
  chatConfirm.hidden = true;
  chatForm.append(chatConfirm);
  chatInput.addEventListener("input", () => {
    if (!chatDraftKey) { chatDraftActor = actingAs.userId; chatDraftPolicy = connection.policyVersion; }
    chatDraftKey = newKey();
  });
  chatForm.addEventListener("submit", event => {
    event.preventDefault();
    if (chatSending || chatSend.disabled || !chatInput.value.trim()) return;
    if (!chatDraftKey) { chatDraftActor = actingAs.userId; chatDraftPolicy = connection.policyVersion; chatDraftKey = newKey(); }
    const body = chatInput.value.trim();
    chatSending = true;
    chatSend.disabled = true;
    chatInput.disabled = true;
    void (async () => {
      try {
        if (chatDraftActor !== actingAs.userId || chatDraftPolicy !== connection.policyVersion) throw new Error("The acting profile or connection policy changed.");
        const result = await write("forum_send_chat_message", { body }, chatDraftKey, chatDraftPolicy);
        chatInput.value = "";
        chatDraftKey = "";
        await refreshChat();
        chatReport(result.status === "pending_approval" ? "Queued for owner review; not sent yet." : publicationStatus(result) === "pending_moderation" ? "Submitted for forum staff moderation; not public yet." : "Message sent.");
        if (result.status === "pending_approval") chatNotice.append(document.createTextNode(" "), link("Review ↗", text(result.approvalUrl, "https://forum.symbaiex.com/control-panel/agent-access")));
      } catch (error) {
        const message = errorMessage(error);
        if (/PLUGIN_POLICY_CHANGED|acting profile|connection policy/i.test(message)) {
          chatDraftStale = true;
          try { await tool("forum_status"); } catch { /* Keep the draft even if reconnect is needed. */ }
          chatConfirm.hidden = false;
          chatReport("Agent access changed. Your chat draft is preserved; choose the current profile before sending.", true);
        } else chatReport(message, true);
      } finally {
        chatSending = false;
        chatInput.disabled = false;
        syncChatComposer();
      }
    })();
  });
  document.getElementById("chat-toggle")!.addEventListener("click", () => {
    chatExpanded = !chatExpanded;
    chatLive = chatExpanded; updateUsagePolicy();
    document.getElementById("chat-panel")!.hidden = !chatExpanded;
    document.getElementById("chat-toggle")!.setAttribute("aria-expanded", String(chatExpanded));
    document.getElementById("chat-toggle")!.textContent = chatExpanded ? "Close chat" : "Open chat";
    ++chatRevision;
    if (chatTimer) clearTimeout(chatTimer);
    if (chatExpanded) void refreshChat();
  });
  document.getElementById("chat-latest")!.addEventListener("click", () => { chatCursor = null; chatModerating = false; void refreshChat(null, !chatExpanded); });
  chatModeration.addEventListener("click", () => { chatCursor = null; chatModerating = !chatModerating; chatLive = false; updateUsagePolicy(); void refreshChat(null); });
  const run = (action: () => Promise<unknown>) => { void action().catch(error => report(errorMessage(error), true)); };
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
    // Polling and unrelated tool receipts must not close More or remove a
    // focused control. Rebuild only when navigation or its authority changes.
    compose.hidden = !permitted("participate");
    root.dataset.view = currentView;
    const nextState = JSON.stringify([currentView, identityRevision, actingAs.userId, connection.connectionId, connection.policyVersion,
      ...["personal", "messages", "moderate", "administer", "participate"].map(permitted)]);
    if (nextState === navigationState) return;
    navigationState = nextState;
    nav.replaceChildren();
    const primary = element("div", undefined, "primary-navigation");
    const more = element("details", undefined, "navigation-more");
    moreNavigation = more;
    desktopNavigationOpened = navigationMedia?.matches === true;
    more.open = desktopNavigationOpened;
    const summaryNode = element("summary", "More");
    summaryNode.addEventListener("click", () => { desktopNavigationOpened = false; });
    const secondary = element("div", undefined, "secondary-navigation");
    secondary.setAttribute("aria-label", "Personal and forum tools");
    more.append(summaryNode, secondary);
    const items = [["feed", "Feed"], ["news", "News"], ["community", "Community"], ["boards", "Boards"], ["recent", "New posts"], ["members", "Members"], ["info", "Forum info"]];
    if (permitted("personal")) items.push(["bookmarks", "Saved"], ["notifications", "Notifications"], ["profile", "My profile"]);
    if (permitted("messages")) items.push(["inbox", "Inbox"]);
    if (permitted("moderate")) items.push(["staff", "Moderation"]);
    if (permitted("administer")) items.push(["admin", "Administration"]);
    let secondarySelected = false;
    for (const [index, [key, label]] of items.entries()) {
      const node = button(label, () => run(() => navigate(key)));
      const selected = currentView === key || key === "boards" && (currentView === "board" || currentView === "thread");
      node.setAttribute("aria-current", selected ? "page" : "false");
      if (index < 4) primary.append(node);
      else { secondary.append(node); if (selected) secondarySelected = true; }
    }
    summaryNode.setAttribute("aria-current", secondarySelected ? "page" : "false");
    nav.append(primary, more);
  }
  function renderContext() {
    const nextContext = JSON.stringify([identityRevision, actingAs.username, modeLabel.textContent, boards.map(board => [board._id, board.slug, board.name, board.kind])]);
    if (nextContext === contextState) return;
    contextState = nextContext;
    contextRail.replaceChildren();
    const about = element("section", undefined, "context-panel");
    about.append(element("h2", "SYMBaiEX community"), element("p", "Discuss the news, share what you know, and build alongside people and their agents.", "muted"));
    about.append(link("Community guidelines ↗", "https://forum.symbaiex.com/help"));
    contextRail.append(about);
    const visibleBoards = boards.filter(board => board.kind !== "section" && board.slug).slice(0, 8);
    if (visibleBoards.length) {
      const panel = element("section", undefined, "context-panel");
      panel.append(element("h2", "Explore communities"));
      for (const board of visibleBoards) {
        const control = button(text(board.name, "Board"), () => run(() => navigate("board", { categorySlug: board.slug, categoryName: board.name })), "context-board");
        panel.append(control);
      }
      contextRail.append(panel);
    }
    const access = element("section", undefined, "context-panel context-access");
    access.append(element("h2", actingAs.username ? "Your forum connection" : "Join the conversation"));
    access.append(element("p", actingAs.username ? text(actingAs.username) + " · " + text(modeLabel.textContent) : "Connect your profile to post, save discussions, and join the lounge.", "muted"));
    access.append(link("Agent access ↗", "https://forum.symbaiex.com/control-panel/agent-access"));
    contextRail.append(access);
  }
  function popupEntries(): Array<{ panel: HTMLDetailsElement; trigger: HTMLElement; enabled: boolean }> {
    return [
      { panel: surfaceSwitcher, trigger: surfaceTrigger, enabled: true },
      { panel: searchPanel, trigger: searchPanel.firstElementChild as HTMLElement, enabled: searchMedia?.matches === true },
      { panel: connectionDetails, trigger: connectionTrigger, enabled: true },
      ...(moreNavigation ? [{ panel: moreNavigation, trigger: moreNavigation.firstElementChild as HTMLElement, enabled: navigationMedia?.matches !== true }] : []),
    ];
  }
  function dismissPopups(event: Event) {
    for (const { panel, enabled } of popupEntries()) {
      if (enabled && panel.open && !panel.contains(event.target as Node)) panel.open = false;
    }
  }
  function onPopupKey(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    const entries = popupEntries().filter(entry => entry.enabled && entry.panel.open);
    const focused = entries.find(entry => entry.panel.contains(document.activeElement));
    if (focused) { focused.panel.open = false; focused.trigger.focus(); event.preventDefault(); }
    else if (entries.length) { for (const entry of entries) entry.panel.open = false; event.preventDefault(); }
  }
  function renderSurfaceChoices() {
    const forum = button("", () => {
      surfaceSwitcher.open = false;
      surfaceTrigger.focus();
      run(() => navigate("feed"));
    }, "surface-choice");
    forum.setAttribute("aria-label", "Forum");
    forum.setAttribute("aria-current", "page");
    forum.append(element("strong", "Forum"), element("span", "Conversations & community", "surface-description"), element("span", "Current", "surface-current"));
    const blog = link("", "https://www.symbaiex.com");
    blog.className = "surface-choice";
    blog.setAttribute("aria-label", "Blog");
    blog.append(element("strong", "Blog"), element("span", "Articles, research & news", "surface-description"));
    const nativeForum = link("Open forum website ↗", "https://forum.symbaiex.com");
    nativeForum.className = "surface-native-link";
    for (const external of [blog, nativeForum]) external.addEventListener("click", event => {
      if (!ready) { event.preventDefault(); report("Connecting to the host. Try this link again when the forum is ready."); return; }
      surfaceSwitcher.open = false; surfaceTrigger.focus();
    });
    surfaceChoices.replaceChildren(blog, forum, nativeForum);
  }
  function loadingView() {
    const loading = element("div", undefined, "loading-state");
    loading.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index++) {
      const panel = element("div", undefined, "loading-panel");
      panel.append(element("span", undefined, "loading-meta"), element("span", undefined, "loading-title"), element("span", undefined, "loading-copy"), element("span", undefined, "loading-action"));
      loading.append(panel);
    }
    content.replaceChildren(loading);
  }
  function heading(title: string, subtitle?: string) {
    content.replaceChildren();
    const header = element("header", undefined, "view-heading");
    const titleNode = element("h1", title);
    titleNode.tabIndex = -1;
    header.append(titleNode);
    if (subtitle) header.append(element("p", subtitle, "muted"));
    content.append(header);
    return titleNode;
  }
  function avatar(name: unknown) {
    const label = text(name, "Member");
    const initials = label.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? "").join("").toUpperCase();
    const node = element("span", initials || "M", "member-avatar");
    node.setAttribute("aria-hidden", "true");
    return node;
  }
  function empty(message = "Nothing to show yet.") { content.append(element("p", message, "empty")); }
  function summary(row: RecordValue) {
    const author = object(row.authorIdentity);
    return [text(author.name ?? row.author ?? row.senderUsername ?? row.username), author.isAgent ? "AI agent" : "", text(row.categoryName), row.replyCount !== undefined ? text(row.replyCount) + " replies" : "", row.status && row.status !== "active" ? text(row.status) : ""].filter(Boolean).join(" · ");
  }
  function threadTarget(row: RecordValue): RecordValue {
    const thread = object(row.thread);
    return {
      categorySlug: text(row.categorySlug ?? thread.categorySlug),
      threadSlug: text(row.threadSlug ?? row.slug ?? thread.slug),
    };
  }
  function section(title: string, detail?: string) {
    const panel = element("section", undefined, "forum-section");
    panel.setAttribute("aria-label", title);
    const bar = element("header", undefined, "section-bar");
    bar.append(element("h2", title));
    if (detail) bar.append(element("span", detail, "section-detail"));
    panel.append(bar);
    content.append(panel);
    return panel;
  }
  function activity(row: RecordValue) {
    const detail = element("div", undefined, "latest-activity");
    const author = text(row.lastPostAuthor ?? object(row.lastPostAuthorIdentity).name);
    const timestamp = Number(row.lastPostAt ?? row.updatedAt);
    detail.append(element("span", author && author !== "SYM-UNKNOWN" ? author : "Latest activity", "latest-author"));
    if (Number.isFinite(timestamp) && timestamp > 0) {
      const time = element("time", new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }), "muted");
      time.dateTime = new Date(timestamp).toISOString();
      detail.append(time);
    }
    return detail;
  }
  function appendThreadList(rows: RecordValue[], parent: HTMLElement = content) {
    const list = element("div", undefined, "rows discussion-list");
    for (const row of rows) {
      const record = { ...object(row.thread), ...row };
      const item = element("article", undefined, "row discussion-row");
      const target = threadTarget(row);
      const available = Boolean(target.categorySlug && target.threadSlug);
      const main = element("div", undefined, "discussion-main");
      const author = object(record.authorIdentity);
      const meta = element("div", undefined, "discussion-meta");
      const authorLine = element("p", summary({ ...record, replyCount: undefined }), "muted");
      const createdAt = Number(record.createdAt ?? record._creationTime);
      if (Number.isFinite(createdAt) && createdAt > 0) {
        const created = element("time", new Date(createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
        created.dateTime = new Date(createdAt).toISOString();
        authorLine.append(document.createTextNode(" · "), created);
      }
      meta.append(avatar(author.name ?? record.author ?? record.username), authorLine);
      main.append(meta);
      const open = button((record.pinned ? "◆ " : "") + text(record.title, "Discussion"), () => run(() => navigate("thread", target)), "row-title");
      open.disabled = !available;
      main.append(open);
      const excerpt = text(record.snippet ?? record.excerpt ?? record.body);
      if (excerpt) main.append(element("p", excerpt.slice(0, 420), "excerpt"));
      item.append(main);
      const footer = element("footer", undefined, "discussion-footer");
      const read = button(record.replyCount === undefined ? "Read discussion" : Number(record.replyCount) === 0 ? "Discuss" : Number(record.replyCount) === 1 ? "1 reply" : text(record.replyCount) + " replies", () => run(() => navigate("thread", target)), "discussion-action");
      read.disabled = !available;
      footer.append(read);
      const meaningfulViews = Number(record.viewCount) > 1 ? record.viewCount : undefined;
      if (record.replyCount !== undefined || meaningfulViews !== undefined) {
        const counts = element("dl", undefined, "discussion-counts");
        for (const [label, value] of [["Replies", record.replyCount], ["Views", meaningfulViews]] as const) {
          if (value === undefined) continue;
          const count = element("div");
          count.append(element("dt", label), element("dd", value));
          counts.append(count);
        }
        // The reply action exposes its count; retain labelled statistics for
        // assistive readers and visible views without repeating the reply count.
        counts.className += meaningfulViews === undefined ? " sr-only" : "";
        if (record.replyCount !== undefined && meaningfulViews !== undefined) counts.firstElementChild!.className = "sr-only";
        footer.append(counts);
      }
      if (currentView !== "feed" && currentView !== "community" && (record.lastPostAt || record.lastPostAuthor)) footer.append(activity(record));
      item.append(footer);
      list.append(item);
    }
    parent.append(list);
  }
  function renderThreadList(rows: RecordValue[], title: string, subtitle?: string) {
    heading(title, subtitle);
    if (!rows.length) return empty("No discussions found. Try a different search or start a conversation.");
    appendThreadList(rows, section("Discussions", rows.length + " on this page"));
  }
  function newsPath(story: RecordValue) {
    const slug = text(story.title).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 88).replace(/-+$/g, "") || "story";
    return "https://www.symbaiex.com/news/" + slug + "-" + encodeURIComponent(text(story.hnItemId));
  }
  function appendNews(stories: RecordValue[], compact = false, parent: HTMLElement = content) {
    const list = element("div", undefined, compact ? "rows news-preview" : "rows news-list");
    for (const [index, story] of stories.entries()) {
      const article = element("article", undefined, "row news-story");
      const rail = element("div", undefined, "news-rank");
      rail.setAttribute("aria-label", "Hacker News rank " + text(story.rank, String(index + 1)));
      rail.append(element("span", text(story.rank, String(index + 1)), "rank-number"));
      const points = element("span", story.hnScore === undefined ? "HN" : text(story.hnScore) + " pts", "rank-points");
      points.setAttribute("aria-label", story.hnScore === undefined ? "Hacker News" : text(story.hnScore) + " Hacker News points");
      rail.append(points);
      const main = element("div", undefined, "news-main");
      const headline = link(text(story.title, "News story"), newsPath(story));
      headline.className = "row-title";
      main.append(headline, element("p", [text(story.host, "Hacker News"), text(story.by)].filter(Boolean).join(" · "), "source"));
      const hn = [story.hnScore !== undefined ? text(story.hnScore) + " HN points" : "", story.hnCommentCount !== undefined ? text(story.hnCommentCount) + " HN comments" : ""].filter(Boolean);
      const local = object(story.platformStats);
      if (story.platformStatsStatus === "available" && Object.keys(local).length) hn.push(text(local.comments, "0") + " SYMBaiEX comments");
      main.append(element("p", hn.join(" · "), "muted"));
      article.append(rail, main);
      list.append(article);
    }
    parent.append(list);
  }
  function renderFeed(data: RecordValue, view: string, args: RecordValue, news: RecordValue | null) {
    const sort = args.sort === "new" ? "new" : "active";
    heading(view === "community" ? "Community" : "Feed", view === "community" ? "Conversations from people and their agents." : "News and discussions from SYMBaiEX.");
    const filters = element("div", undefined, "actions feed-filters");
    for (const [key, label] of [["active", "Active"], ["new", "New"]]) {
      const control = button(label, () => run(() => navigate(view, { sort: key })));
      control.setAttribute("aria-pressed", String(sort === key));
      filters.append(control);
    }
    content.querySelector("header")!.append(filters);
    const rows = collection(data);
    if (rows.length) appendThreadList(rows, section(view === "community" ? "Community discussions" : "Forum discussions", sort === "new" ? "Newest first" : "Latest activity"));
    else empty(data.isDone ? "No conversations here yet." : "No visible conversations on this page. Continue to see more.");
    if (news) {
      const stories = collection(news, ["stories"]).slice(0, 3);
      if (stories.length) {
        const newsSection = section("In the news", "Hacker News");
        newsSection.firstElementChild!.append(button("All news →", () => run(() => navigate("news"))));
        appendNews(stories, true, newsSection);
      }
    }
    const history = Array.isArray(args.history) ? args.history : [];
    if (history.length || (data.isDone === false && typeof data.continueCursor === "string")) {
      const controls = element("div", undefined, "pager");
      if (history.length) controls.append(button("← Previous", () => run(() => navigate(view, { sort, cursor: history.at(-1), history: history.slice(0, -1) }))));
      if (data.isDone === false && typeof data.continueCursor === "string") controls.append(button("More discussions →", () => run(() => navigate(view, { sort, cursor: data.continueCursor, history: [...history, args.cursor ?? null] }))));
      content.append(controls);
    }
  }
  function renderNews(data: RecordValue, args: RecordValue) {
    const snapshot = object(data.snapshot);
    heading("News", snapshot.snapshotDate ? "Hacker News · " + text(snapshot.snapshotDate) : "Hacker News on SYMBaiEX");
    const snapshots = collection(data, ["snapshots"]);
    if (snapshots.length) {
      const label = element("label", "Edition", "edition");
      const select = element("select");
      for (const row of snapshots) {
        const option = element("option", row.snapshotDate);
        option.value = text(row.snapshotDate);
        select.append(option);
      }
      select.value = text(args.snapshotDate ?? snapshot.snapshotDate);
      select.addEventListener("change", () => run(() => navigate("news", { snapshotDate: select.value })));
      label.append(select);
      content.append(label);
    }
    const stories = collection(data, ["stories"]);
    if (stories.length) appendNews(stories, false, section("Top stories", "HN activity · SYMBaiEX discussion"));
    else empty("No indexed stories in this edition yet.");
    if (data.limited) content.append(element("p", "Showing the stories available within this request. Open News on SYMBaiEX for more.", "muted"));
    content.append(link("Open News on SYMBaiEX ↗", "https://www.symbaiex.com/news"));
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
  function appendBoards(rows: RecordValue[], parent: HTMLElement) {
    const grid = element("div", undefined, "board-index");
    for (const board of rows) {
      const item = element("article", undefined, "board");
      const icon = element("span", undefined, "board-icon");
      icon.setAttribute("aria-hidden", "true");
      if (board.viewerUnread === true) icon.className += " unread";
      const description = element("div", undefined, "board-description");
      description.append(button(text(board.name, "Board"), () => run(() => navigate("board", { categorySlug: board.slug, categoryName: board.name })), "row-title"));
      if (board.description) description.append(element("p", board.description, "excerpt"));
      const children = collection(board.children, []);
      if (children.length) {
        const subforums = element("div", undefined, "subforums");
        subforums.append(element("span", "Subforums:", "muted"));
        for (const child of children) subforums.append(button(text(child.name, "Subforum"), () => run(() => navigate("board", { categorySlug: child.slug, categoryName: child.name })), "subforum-link"));
        description.append(subforums);
      }
      const counts = element("dl", undefined, "board-counts");
      for (const [label, value] of [["Threads", board.threadCount], ["Posts", board.postCount]] as const) {
        const count = element("div");
        count.append(element("dt", label), element("dd", text(value, "0")));
        counts.append(count);
      }
      item.append(icon, description, counts);
      const latest = object(board.lastThread);
      if (latest.title) {
        const latestPanel = element("div", undefined, "board-latest");
        latestPanel.append(button(text(latest.title), () => run(() => navigate("thread", { categorySlug: latest.categorySlug ?? board.slug, threadSlug: latest.slug })), "latest-title"), activity(latest));
        item.append(latestPanel);
      }
      grid.append(item);
    }
    parent.append(grid);
  }
  function renderBoards(rows: RecordValue[]) {
    heading("Forum boards", "Ideas, research, and conversations across the SYMBaiEX community.");
    if (!rows.length) return empty("No boards are visible to this connection.");
    const byId = new Map(rows.filter(board => board._id).map(board => [text(board._id), board]));
    const roots = rows.filter(board => !byId.has(text(board.parentCategoryId)));
    appendBoards(roots.map(board => {
      if (Array.isArray(board.children)) return board;
      const children = rows.filter(child => child.parentCategoryId && child.parentCategoryId === board._id);
      const latest = [board, ...children].reduce((current, candidate) => Number(candidate.lastPostAt ?? 0) > Number(current.lastPostAt ?? 0) ? candidate : current, board);
      return { ...board, children, threadCount: Number(board.threadCount ?? 0) + children.reduce((total, child) => total + Number(child.threadCount ?? 0), 0), postCount: Number(board.postCount ?? 0) + children.reduce((total, child) => total + Number(child.postCount ?? 0), 0), lastThread: latest.lastThread };
    }), section("Forum index", roots.length + " boards"));
  }
  function breadcrumbs(category: RecordValue, includeCategory = false) {
    const trail = element("nav", undefined, "breadcrumbs");
    trail.setAttribute("aria-label", "Forum breadcrumb");
    trail.append(button("Boards", () => run(() => navigate("boards"))));
    const ancestors = collection(category.ancestors, []);
    if (includeCategory && category.slug) ancestors.push(category);
    for (const ancestor of ancestors) {
      const separator = element("span", "/");
      separator.setAttribute("aria-hidden", "true");
      trail.append(separator);
      if (ancestor.isPostable !== false && ancestor.kind !== "section") trail.append(button(text(ancestor.name, "Board"), () => run(() => navigate("board", { categorySlug: ancestor.slug, categoryName: ancestor.name }))));
      else trail.append(element("span", ancestor.name));
    }
    content.prepend(trail);
  }
  function renderBoard(data: RecordValue, args: RecordValue) {
    const category = object(data.category);
    currentCategory = text(args.categorySlug);
    heading(text(category.name ?? args.categoryName, currentCategory), text(category.description));
    breadcrumbs(category);
    if (permitted("participate") && category.viewerCanCreateThread === true) content.append(button("Create post", () => openComposer("thread"), "primary"));
    const children = collection(category.children, []);
    if (children.length) appendBoards(children, section("Subforums", children.length + " boards"));
    const announcements = collection(data.announcements, []);
    if (announcements.length) {
      const panel = section("Announcements");
      for (const announcement of announcements) {
        const item = element("article", undefined, "row announcement-row");
        item.append(element("h3", announcement.title), element("p", announcement.body, "excerpt"));
        panel.append(item);
      }
    }
    const rules = object(data.rules);
    if (rules.body) {
      const disclosure = element("details", undefined, "board-rules");
      disclosure.append(element("summary", "Board rules"), element("p", rules.body, "post-body"));
      content.append(disclosure);
    }
    const rows = collection(data.threads ?? data);
    if (rows.length) appendThreadList(rows, section("Discussions", "Latest activity"));
    else empty("No discussions found. Try a different search or start a conversation.");
    pagination(data, Number(args.page ?? 1), next => run(() => navigate("board", { ...args, page: next })));
  }
  function renderPost(post: RecordValue, rootPost = false) {
    const article = element("article", undefined, "post");
    const author = element("div", undefined, "post-author");
    const authorIdentity = object(post.authorIdentity);
    author.append(avatar(authorIdentity.name ?? post.author ?? post.authorName), element("strong", authorIdentity.name ?? post.author ?? post.authorName ?? "Member"));
    if (authorIdentity.isAgent || post.isAgent) author.append(element("span", "AI agent", "badge"));
    else if (post.agentAssisted) author.append(element("span", "Agent assisted", "badge"));
    if (post.createdAt) author.append(element("span", new Date(Number(post.createdAt)).toLocaleString(), "muted"));
    if (rootPost) author.append(element("span", "Original post", "badge"));
    const body = element("div", undefined, "post-content");
    body.append(element("div", post.body ?? post.content, "post-body"));
    article.append(author, body);
    for (const attachment of collection(post.attachments, [])) {
      const label = text(attachment.filename ?? attachment.name, "Attachment");
      const url = text(attachment.url);
      if (safeForumUrl(url)) body.append(link(label, url));
      else body.append(element("span", label, "badge"));
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
    breadcrumbs({ ...object(data.category), slug: args.categorySlug, name: object(data.category).name ?? args.categorySlug }, true);
    const controls = element("div", undefined, "actions");
    controls.append(button("← Board", () => run(() => navigate("board", { categorySlug: args.categorySlug }))));
    const canonical = "https://forum.symbaiex.com/" + encodeURIComponent(text(args.categorySlug)) + "/" + encodeURIComponent(text(args.threadSlug));
    controls.append(link("Open on SYMBaiEX ↗", canonical));
    if (permitted("personal")) controls.append(actionButton(thread.viewerBookmarked ? "Unsave thread" : "Save thread", "forum_set_thread_bookmark", { threadId: thread._id, saved: !thread.viewerBookmarked }, () => navigate("thread", args)));
    if (permitted("participate") && thread.viewerCanReply !== false && thread.status !== "locked") controls.append(button("Reply", () => openComposer("reply"), "primary"));
    content.append(controls);
    const rules = object(data.rules);
    if (rules.body) content.append(element("aside", "Board rules: " + text(rules.body), "notice"));
    const posts = section("Conversation", text(thread.replyCount, "0") + " replies");
    if (Number(args.page ?? 1) === 1) posts.append(renderPost(thread, true));
    for (const reply of collection(data.replies)) posts.append(renderPost(reply));
    const page = Number(object(object(data.replies).pagination).page ?? args.page ?? 1);
    pagination(data.replies, page, next => run(() => navigate("thread", { ...args, page: next })));
    if (thread.status === "locked") content.append(element("p", "This discussion is locked.", "muted"));
    else if (!actingAs.userId) {
      const connectReply = element("p", undefined, "muted");
      connectReply.append(link("Connect your profile to reply. ↗", "https://forum.symbaiex.com/control-panel/agent-access"));
      content.append(connectReply);
    } else if (thread.viewerCanReply === false || !permitted("participate")) content.append(element("p", "Replies are unavailable for your connected profile.", "muted"));
    else if (permitted("participate")) {
      const replyBar = element("footer", undefined, "conversation-reply");
      replyBar.append(element("p", "Join the discussion as " + text(actingAs.username, "your connected profile"), "muted"), button("Reply to discussion", () => openComposer("reply"), "primary"));
      content.append(replyBar);
    }
  }
  function renderRecords(rows: RecordValue[], title: string, type: string, mailboxArgs: RecordValue = {}) {
    heading(title);
    if (!rows.length) return empty();
    const list = element("div", undefined, type === "member" ? "rows member-list" : "rows record-list");
    for (const row of rows) {
      const item = element("article", undefined, "row record-row " + type + "-row");
      if (type === "member") item.append(avatar(row.username ?? row.name));
      const titleText = text(row.title ?? row.subject ?? row.username ?? row.name ?? row.reason, "Forum item");
      if (type === "message") item.append(button(titleText, () => run(() => navigate("message", { messageId: row._id ?? row.messageId, box: mailboxArgs.box === "sent" || mailboxArgs.box === "trash" ? mailboxArgs.box : "inbox", page: mailboxArgs.page ?? 1 })), "row-title"));
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
    currentCategory = view === "board" || view === "thread" ? text(args.categorySlug) : "";
    compose.disabled = true;
    content.setAttribute("aria-busy", "true");
    loadingView();
    report("Loading forum…");
    try {
      let result: RecordValue;
      let render: () => void;
      if (view === "feed" || view === "community") {
        let compatible = false;
        const threads = await tool("forum_list_feed_threads", { sort: args.sort === "new" ? "new" : "active", communityOnly: view === "community", paginationOpts: { numItems: 12, cursor: typeof args.cursor === "string" ? args.cursor : null } }).catch(async error => {
          if (!unavailableTool(error)) throw error;
          compatible = true;
          return tool("forum_overview");
        });
        result = threads;
        render = () => {
          if (compatible) {
            const data = object(threads.data);
            if (view === "community") renderBoards(collection(data.categories));
            else renderThreadList(collection(data.newestThreads), "Forum discussions");
            content.prepend(element("p", "Your host has an older tool catalog. Reconnect the SYMBaiEX plugin to load the full feed. These existing forum tools remain available.", "notice"));
          } else renderFeed(object(threads.data), view, args, null);
        };
      } else if (view === "news") {
        result = await tool("forum_list_news_feed", { ...(typeof args.snapshotDate === "string" ? { snapshotDate: args.snapshotDate } : {}), limit: 30 });
        render = () => renderNews(object(result.data), args);
      } else if (view === "boards") {
        result = await tool("forum_list_categories");
        boards = collection(result.data);
        render = () => renderBoards(boards);
      } else if (view === "board") {
        result = await tool("forum_list_threads", { categorySlug: args.categorySlug, page: args.page ?? 1, pageSize: 20 });
        const data = object(result.data);
        render = () => renderBoard({ ...data, threads: data.threads ?? result.data }, args);
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
        const box = args.box === "sent" || args.box === "trash" ? args.box : "inbox";
        result = await tool("forum_get_private_message", { messageId: args.messageId, box });
        render = () => {
          const message = object(object(result.data).message ?? result.data);
          heading(text(message.subject, "Private message"), "Private to the selected acting profile");
          content.append(renderPost(message), button("← " + (box === "trash" ? "Trash" : box === "sent" ? "Sent" : "Inbox"), () => run(() => navigate("inbox", { box, page: args.page ?? 1 }))));
        };
      } else if (view === "profile") {
        result = await tool("forum_get_my_forum_profile");
        render = () => {
          const profile = object(object(result.data).profile ?? result.data);
          heading("My forum profile", text(actingAs.username));
          const profilePanel = section("Profile details");
          const fields = { bio: "About", signature: "Signature", location: "Location", website: "Website" };
          let hasDetails = false;
          for (const [key, label] of Object.entries(fields)) if (profile[key]) {
            hasDetails = true;
            const item = element("div", undefined, "row profile-field");
            item.append(element("h3", label), element("p", profile[key], "post-body"));
            profilePanel.append(item);
          }
          if (!hasDetails) profilePanel.append(element("p", "Add a bio or signature in your forum control panel.", "empty"));
          content.append(link("Edit profile and agent access ↗", "https://forum.symbaiex.com/control-panel/agent-access"));
        };
      } else if (view === "info") {
        const [announcements, help, calendar] = await Promise.all([tool("forum_list_announcements"), tool("forum_list_help_documents"), tool("forum_list_calendar_events", { month: new Date().toISOString().slice(0, 7) })]);
        result = announcements;
        render = () => {
          heading("Forum information");
          for (const [label, source] of [["Announcements", announcements], ["Help", help], ["Calendar", calendar]] as const) {
            const panel = section(label);
            const rows = collection(source.data);
            if (!rows.length) panel.append(element("p", "No items.", "empty"));
            for (const row of rows) {
              const item = element("article", undefined, "row info-row");
              item.append(element("h3", row.title ?? row.name), element("p", row.body ?? row.description, "post-body"));
              panel.append(item);
            }
          }
        };
      } else if (view === "admin") {
        result = await tool("forum_list_categories_admin");
        render = () => {
          renderBoards(collection(result.data));
          content.querySelector("h1")!.textContent = "Board administration";
          content.append(link("Open forum administration ↗", "https://forum.symbaiex.com/admin"));
        };
      } else {
        const names: Record<string, string> = { recent: "forum_list_recent_threads", bookmarks: "forum_list_my_thread_bookmarks", notifications: "forum_list_my_notifications", inbox: "forum_list_private_messages", members: "forum_list_members", staff: "forum_list_forum_threads" };
        const labels: Record<string, string> = { recent: "Recent discussions", bookmarks: "Saved discussions", notifications: "Notifications", inbox: "Private messages", members: "Community members", staff: "Pending moderation" };
        result = await tool(names[view] ?? names.recent, view === "staff" ? { status: "pending", limit: 30 } : view === "inbox" ? { box: args.box === "sent" || args.box === "trash" ? args.box : "inbox", page: args.page ?? 1, pageSize: 20 } : view === "recent" ? { mode: "new", now: Date.now(), page: args.page ?? 1, pageSize: 20 } : { limit: 30 });
        render = () => {
          const rows = collection(result.data);
          if (view === "recent" || view === "bookmarks") renderThreadList(rows, labels[view]);
          else renderRecords(rows, labels[view], view === "inbox" ? "message" : view === "notifications" ? "notification" : view === "members" ? "member" : "staff", args);
          if (view === "inbox") {
            content.querySelector("header")!.append(button("New message", () => openComposer("message"), "primary"));
            const folders = element("nav", undefined, "mailbox-folders"); folders.setAttribute("aria-label", "Mailbox folders");
            for (const [box, label] of [["inbox", "Inbox"], ["sent", "Sent"], ["trash", "Trash"]]) {
              const folder = button(label, () => run(() => navigate("inbox", { box })));
              folder.setAttribute("aria-current", (args.box ?? "inbox") === box ? "page" : "false"); folders.append(folder);
            }
            content.querySelector("header")!.append(folders);
            pagination(result.data, Number(args.page ?? 1), next => run(() => navigate("inbox", { box: args.box ?? "inbox", page: next })));
          }
          if (view === "recent") pagination(result.data, Number(args.page ?? 1), next => run(() => navigate("recent", { page: next })));
        };
      }
      if (revision !== viewRevision || destroyed) return;
      render();
      renderContext();
      if (lastActionResult) showActionResult(lastActionResult);
      else report("");
      const title = content.querySelector("h1");
      title?.focus({ preventScroll: true });
      if (view === "thread") void request("ui/update-model-context", { structuredContent: { selectedThread: args, actingAs }, content: [{ type: "text", text: "The user is reading " + text(currentThread?.title) + " in the SYMBaiEX forum." }] }).catch(() => {});
    } catch (error) {
      if (revision !== viewRevision || destroyed) return;
      heading("Forum request unavailable");
      const panel = element("section", undefined, "request-error");
      applyLimitError(error);
      const message = errorMessage(error);
      panel.append(element("p", message));
      const recovery = element("div", undefined, "actions");
      recovery.append(button("Try again", () => run(() => navigate(view, args)), "primary"), link("Open forum website ↗", "https://forum.symbaiex.com"));
      panel.append(recovery); content.append(panel);
      report(message, true);
    } finally {
      if (revision === viewRevision) { content.setAttribute("aria-busy", "false"); compose.disabled = false; }
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
  document.getElementById("settings")!.prepend(link("Agent access ↗", "https://forum.symbaiex.com/control-panel/agent-access"));
  renderSurfaceChoices();
  document.addEventListener("pointerdown", dismissPopups);
  document.addEventListener("focusin", dismissPopups);
  document.addEventListener("keydown", onPopupKey);
  renderNavigation();
  report("Connecting to your forum tools…");
  run(async () => {
    try {
      const result = object(await request("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "SYMBaiEX Forum", version: "1.6.2" }, appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] } }));
      if (result.protocolVersion !== "2026-01-26") throw new Error("This host does not support the forum UI protocol.");
      ready = true;
      applyContext(object(result.hostContext) as HostContext);
      notify("ui/notifications/initialized");
    } catch (error) {
      if (!openai?.callTool) throw error;
      ready = true;
      legacyBridge = true;
      applyContext({});
      // Host snapshots are optional hints; missing or unrelated metadata must
      // never prevent authoritative status and forum navigation from loading.
      for (const snapshot of [openai.toolResponseMetadata, openai.toolOutput]) {
        if (snapshot === undefined || snapshot === null) continue;
        try { updateIdentity(decodeResult(snapshot)); break; }
        catch { /* Try raw structured output, then continue with forum_status. */ }
      }
    }
    try { updateIdentity(await tool("forum_status")); } catch (error) {
      report(error instanceof Error ? error.message : "Connect your forum profile to enable posting.", true);
    }
    // An explicit host thread selection received during connection wins over
    // the default feed. Do not replace its reader with the launch route.
    if (currentView === "feed") await navigate("feed");
    chatPeek.textContent = "Open chat to read the lounge";
  });
}

// Portable copy of the native forum tokens from app/globals.css. The parity test
// checks both themes against that source; the sandbox cannot load site styles/fonts.
const FORUM_PLUGIN_APP_LIGHT_THEME = `--background:0 0% 93%;--foreground:0 0% 3%;--card:0 0% 96%;--primary:319 100% 40%;--primary-foreground:0 0% 100%;--muted:0 0% 88%;--muted-foreground:0 0% 30%;--accent:174 54% 67%;--border:0 0% 72%;--input:0 0% 72%;--ring:174 54% 46%;--row-border:0 0% 64%;--accent-magenta:#fa00a8;--accent-cyan:#81d8d0;--accent-canary:#ffe14d`;
const FORUM_PLUGIN_APP_DARK_THEME = `--background:0 0% 3%;--foreground:0 0% 98%;--card:0 0% 5%;--primary:319 100% 46%;--primary-foreground:0 0% 100%;--muted:0 0% 11%;--muted-foreground:0 0% 68%;--accent:174 54% 67%;--border:0 0% 18%;--input:0 0% 18%;--ring:174 54% 67%;--row-border:0 0% 22%`;

export const FORUM_PLUGIN_APP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SYMBaiEX Forum</title>
<style>
/* Native forum palette, open reading layout, and deliberate spacing. */
:root{color-scheme:light;${FORUM_PLUGIN_APP_LIGHT_THEME};font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-feature-settings:"ss01","cv01","cv11","tnum"}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;${FORUM_PLUGIN_APP_DARK_THEME}}}
:root[data-theme=light]{color-scheme:light;${FORUM_PLUGIN_APP_LIGHT_THEME}}
:root[data-theme=dark]{color-scheme:dark;${FORUM_PLUGIN_APP_DARK_THEME}}
*{box-sizing:border-box}body{margin:0;background:hsl(var(--background));color:hsl(var(--foreground))}
button,input,textarea,select{font:inherit}button,a,input,textarea,select{outline-offset:4px}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid hsl(var(--ring))}
button{cursor:pointer;color:hsl(var(--foreground));background:hsl(var(--muted)/.35);border:1px solid transparent;border-radius:2px;min-height:44px;padding:10px 14px;font-size:13px;font-weight:500;touch-action:manipulation}button:hover{background:hsl(var(--muted));color:hsl(var(--primary))}button:disabled{opacity:.55;cursor:not-allowed}[hidden]{display:none!important}
a{color:hsl(var(--foreground));text-underline-offset:3px;overflow-wrap:anywhere}a:hover{color:hsl(var(--primary))}h1,h2,h3{overflow-wrap:anywhere}h1{text-wrap:balance}h2{font-size:18px;line-height:1.4;margin:0 0 8px}h3{font-size:16px}p{margin:6px 0 12px}
#app{margin:0 auto;min-height:540px}.masthead{display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{font-weight:800;line-height:1;letter-spacing:-1px}.brand .brand-ai{color:hsl(var(--primary))}.brand .brand-forum{letter-spacing:-.4px;margin-left:5px;color:hsl(var(--muted-foreground))}.eyebrow{font:11px/1.4 ui-monospace,monospace;color:hsl(var(--muted-foreground))}.mast-actions,.actions,.pager{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.primary{background:hsl(var(--primary));color:hsl(var(--primary-foreground));font-weight:600}.primary:hover{filter:brightness(.94);background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
.workspace{display:block}#navigation button{background:transparent;color:hsl(var(--muted-foreground));padding:10px 12px}#navigation button:hover{background:hsl(var(--muted)/.55);color:hsl(var(--foreground))}.connection{display:flex;align-items:center;flex-wrap:wrap}.connection strong{overflow-wrap:anywhere;font-weight:600}.connection .eyebrow{margin:0}#mode,#connection-owner{color:hsl(var(--muted-foreground))}.posting-trust{display:flex;align-items:center;flex-wrap:wrap;width:100%;color:hsl(var(--muted-foreground))}.main{min-width:0}#search{display:flex}#query{flex:1;min-width:0;background:hsl(var(--muted)/.4);border-color:transparent}#search button{background:transparent}
input,textarea,select{display:block;width:100%;min-width:0;max-width:100%;background:hsl(var(--background));border:1px solid hsl(var(--input));border-radius:2px;padding:11px 12px;color:hsl(var(--foreground));min-height:44px}input::placeholder,textarea::placeholder{color:hsl(var(--muted-foreground))}textarea{resize:vertical}
.notice{background:hsl(var(--accent)/.08);overflow-wrap:anywhere}.notice:empty{display:none}.error{background:hsl(var(--primary)/.08)}.muted{color:hsl(var(--muted-foreground));font-size:12px;line-height:1.7}.source{color:hsl(var(--muted-foreground));font:11px/1.5 ui-monospace,monospace;margin-bottom:6px;overflow-wrap:anywhere}
.forum-section{min-width:0;border-radius:2px}.section-bar{display:flex;align-items:center;flex-wrap:wrap;border-radius:2px}.section-bar h2{margin:0;font-weight:600;letter-spacing:0}.section-detail{margin-left:auto;font:10px/1.5 ui-monospace,monospace;color:hsl(var(--muted-foreground))}.section-bar button{background:transparent;padding:4px 8px;margin-left:auto;min-height:44px;font-size:12px}.board-index,.rows{display:grid;gap:0;margin:0}.board,.row{min-width:0;background:transparent}.board{display:grid}.board-icon{color:hsl(var(--muted-foreground))}.board-description,.discussion-main,.news-main{min-width:0}.board-counts,.discussion-counts{display:flex;flex-direction:column;font:10px/1.5 ui-monospace,monospace;color:hsl(var(--muted-foreground))}.board-counts dd,.discussion-counts dd{margin:0;color:hsl(var(--foreground));font-variant-numeric:tabular-nums}.board-latest{min-width:0}.latest-title{text-align:left;background:transparent;padding:0;line-height:1.5;overflow-wrap:anywhere}.latest-title:hover{background:transparent}.latest-activity{display:flex;min-width:0;color:hsl(var(--muted-foreground))}.latest-author{overflow-wrap:anywhere}.subforums{display:flex;align-items:center;flex-wrap:wrap}.subforum-link{background:transparent;padding:0}.subforum-link:hover{background:transparent}.board .row-title,.row-title{text-align:left;font-family:inherit;text-transform:none;text-decoration:none;border:0;background:transparent;padding:0;overflow-wrap:anywhere}.row-title:hover{color:hsl(var(--primary));background:transparent}.row .row-title{display:block}.excerpt{color:hsl(var(--muted-foreground));overflow-wrap:anywhere;margin:4px 0 0}.discussion-row{display:grid}.discussion-main>.muted{margin:0}.news-story{display:grid}.news-rank{display:flex;flex-direction:column;align-items:center;gap:5px;font-family:ui-monospace,monospace;color:hsl(var(--muted-foreground))}.rank-number{font-size:15px;color:hsl(var(--foreground));font-variant-numeric:tabular-nums}.rank-points{font-size:9px;white-space:normal;overflow-wrap:anywhere;max-width:100%;text-align:center}.news-main>.source,.news-main>.muted{margin:0 0 4px;font-size:11px}.news-main .row-title{display:block;align-content:center}.news-preview .row-title{font-size:14px}.feed-filters button{background:transparent;color:hsl(var(--muted-foreground))}.edition{display:flex;gap:12px;align-items:center;color:hsl(var(--muted-foreground))}.edition select{width:auto}.breadcrumbs{display:flex;align-items:center;flex-wrap:wrap;color:hsl(var(--muted-foreground));font-size:12px}.breadcrumbs button{background:transparent;min-height:44px}.board-rules{padding:0 12px;background:hsl(var(--muted)/.18)}.board-rules summary{cursor:pointer;min-height:44px;align-content:center;font-size:12px}.board-rules summary:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:4px}.board-rules .post-body{font-size:13px;padding-bottom:14px}.announcement-row h3{font-size:14px;margin:0}.post{margin:0;min-width:0;background:transparent}.post-author{display:flex;flex-wrap:wrap;min-width:0;overflow-wrap:anywhere}.post-author .muted{font-size:10px}.post-content{min-width:0}.post-body{white-space:pre-wrap;overflow-wrap:anywhere}.post-content>a,.post-content>.badge{display:inline-block;margin-top:12px;margin-right:12px}.badge{font-family:ui-monospace,monospace;line-height:1.4;background:hsl(var(--accent)/.12);color:hsl(var(--muted-foreground));border-radius:2px}
.pager{justify-content:flex-start}.composer{display:grid;max-width:760px}.composer label{display:grid;gap:8px;font-size:13px}.composer .actions{margin-top:4px}.attachments{padding:12px 0}.empty{color:hsl(var(--muted-foreground))}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.chat-header{display:flex;align-items:center;flex-wrap:wrap}.chat-header h2{margin:0 auto 0 0;letter-spacing:0}.chat-messages{overflow-y:auto}.chat-row{display:grid}.chat-meta{display:flex;align-items:baseline;flex-wrap:wrap}.chat-meta strong{overflow-wrap:anywhere}.chat-meta time{font-size:10px}.chat-message{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.chat-row-actions{display:flex;gap:6px}.chat-form{display:flex;flex-wrap:wrap}.chat-form label+input{width:auto}.chat-access{margin:0;padding:0 10px 6px;font-size:11px}.chat-access a{display:inline-flex;align-items:center;min-height:44px}#chat-notice:empty{display:none}#chat-older{margin:4px 12px}#app[data-display-mode=fullscreen]{min-height:100vh}.main:has(.composer){padding-bottom:100px}
/* Community workspace: a reading lane, useful navigation, and honest activity. */
:root{font-family:"Geist",ui-sans-serif,system-ui,sans-serif;--community-backdrop:#f4f4f5;--community-panel:#fff;--community-hover:#f0f0f3;--community-primary:#fa00a8;--community-identity:#81d8d0;--community-text:#202026;--community-muted:#676771}
@media(prefers-color-scheme:dark){:root{--community-backdrop:#0c0c0e;--community-panel:#161618;--community-hover:#202027;--community-text:#f3f3f5;--community-muted:#a2a2ad}}
:root[data-theme=light]{--community-backdrop:#f4f4f5;--community-panel:#fff;--community-hover:#f0f0f3;--community-text:#202026;--community-muted:#676771}
:root[data-theme=dark]{--community-backdrop:#0c0c0e;--community-panel:#161618;--community-hover:#202027;--community-text:#f3f3f5;--community-muted:#a2a2ad}
body{background:var(--community-backdrop);color:var(--community-text)}button,a{color:inherit}.muted,.source{color:var(--community-muted)}button{border-radius:10px}button:hover{background:var(--community-hover)}.primary{border-radius:999px;background:var(--community-primary);color:#0c0c0e}.primary:hover{background:var(--community-primary);color:#0c0c0e}input,textarea,select{background:var(--community-panel);border-color:transparent;border-radius:10px}.badge{border-radius:5px}.notice{border-radius:10px;padding:12px;margin:0 0 12px}.empty{padding:24px 16px;background:var(--community-panel);border-radius:12px;font-size:13px}
#app{max-width:1440px;min-width:0;margin:auto}.masthead{position:sticky;top:0;z-index:20;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:24px;padding:14px 24px;background:var(--community-backdrop)}.brand{font-size:23px;white-space:nowrap;letter-spacing:-.8px}.brand .brand-ai{color:var(--community-primary)}.brand .brand-forum{display:block;font-size:12px;letter-spacing:0;font-weight:500;margin:5px 0 0}.mast-actions{gap:6px}.mast-actions>button{padding:10px 14px;font-size:12px}#expand{background:transparent;color:var(--community-muted)}.product-search{min-width:0;width:100%;max-width:680px;justify-self:center}.product-search>summary{display:none}#search{margin:0;gap:0;background:var(--community-hover);border-radius:999px;min-width:0;max-width:680px;width:100%;justify-self:center}#query{font-size:14px;border:0;border-radius:999px;background:transparent;padding:12px 18px}#search button{border-radius:999px;font-size:12px;padding:10px 16px}
.workspace{display:grid;grid-template-columns:minmax(0,1fr);gap:0;max-width:1320px;margin:auto}.sidebar{position:sticky;top:78px;z-index:15;background:var(--community-backdrop);padding:0 20px}#navigation{display:flex;align-items:stretch;gap:8px;padding:4px 0;flex-wrap:nowrap}.primary-navigation{display:flex;gap:4px;flex:1;min-width:0}.primary-navigation>button{min-width:68px}#navigation button{font-size:13px;color:var(--community-muted);border-radius:10px}#navigation button[aria-current=page]{background:var(--community-hover);color:var(--community-text);font-weight:650}#navigation button[aria-current=page]:before{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--community-primary);margin-right:7px}.navigation-more{position:relative;margin-left:auto}.navigation-more summary,.connection-details summary{cursor:pointer;list-style:none;min-height:44px;display:flex;align-items:center;padding:8px 12px;font-size:13px;font-weight:500;color:var(--community-muted)}.navigation-more summary:after{content:"⌄";margin-left:6px}.navigation-more summary::-webkit-details-marker,.connection-details summary::-webkit-details-marker{display:none}.navigation-more summary[aria-current=page]{color:var(--community-primary);background:var(--community-hover);border-radius:10px}.secondary-navigation{position:absolute;right:0;top:48px;min-width:210px;max-width:calc(100vw - 32px);max-height:65vh;overflow:auto;padding:8px;background:var(--community-panel);border-radius:12px;display:grid;z-index:30;outline:1px solid hsl(var(--border))}.secondary-navigation button{text-align:left}.navigation-more summary:focus-visible,.connection-details summary:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:2px}
.connection{margin:0;padding:4px 0 10px;gap:6px 10px;font-size:11px;min-height:42px}.connection>.eyebrow{display:none}.connection strong{font-size:12px}.connection strong:before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--community-identity);margin-right:7px}#mode{font-size:11px;color:var(--community-muted)}.connection-details{margin-left:auto;position:relative}.connection-details summary{min-height:36px;padding:4px 8px;font-size:11px}.connection-detail-panel{position:absolute;right:0;top:38px;width:280px;max-width:calc(100vw - 32px);padding:14px;background:var(--community-panel);outline:1px solid hsl(var(--border));border-radius:12px;z-index:30;display:grid;gap:8px}#settings{margin:0}.posting-trust{font-size:12px;gap:8px}.main{padding:10px 20px 48px;width:100%;max-width:720px;margin:auto;min-width:0}.context-rail{display:none}
.view-heading{display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;margin:12px 0 16px}.view-heading h1{font-size:26px;line-height:1.3;letter-spacing:-.035em;margin:0;flex:1 1 70%;font-weight:700}.view-heading h1:focus{outline:none}.view-heading>.muted{flex:1 1 100%;margin:0;font-size:12px}.view-heading>.primary{margin-left:auto}#app:is([data-view=feed],[data-view=community]) .view-heading h1{flex:1 1 0;font-size:24px}#app:is([data-view=feed],[data-view=community]) .view-heading>.muted{display:none}.view-heading>.feed-filters{margin:0;flex:0 0 auto}#app:is([data-view=feed],[data-view=community]) .forum-section[aria-label$="discussions"]>.section-bar{display:none}.forum-section{margin:10px 0;background:transparent;overflow:visible}.section-bar{background:transparent;padding:0 2px 8px;min-height:36px;gap:8px}.section-bar h2{font-size:13px;font-weight:650;color:var(--community-muted)}.section-bar button{font-size:12px}.section-detail{font-family:inherit;font-size:11px}.board-index,.rows{padding:0;gap:10px}.row,.board{background:var(--community-panel);border-radius:12px;padding:16px}.board{grid-template-columns:38px minmax(0,1fr);gap:6px 12px;align-items:start}.board-icon{width:36px;height:36px;padding:0;background:var(--community-hover);display:flex;align-items:center;justify-content:center;border-radius:10px}.board-icon:before{content:"";width:15px;height:12px;border:1.5px solid currentColor;border-radius:3px}.board-icon.unread{background:hsl(var(--primary)/.1);color:var(--community-primary)}.board .row-title{font-size:17px;min-height:32px;line-height:1.4;font-weight:650}.board-description>.excerpt{margin:2px 0 0;font-size:13px;line-height:1.65}.subforums{gap:0 10px;margin-top:4px}.subforum-link{font-size:12px;min-height:44px;color:var(--community-muted)}.board-counts{grid-column:2;flex-direction:row;gap:16px;margin:0}.board-counts div,.discussion-counts div{display:flex;flex-direction:row;gap:5px;align-items:baseline}.board-counts dd,.discussion-counts dd{font-size:11px;order:0}.board-counts dt,.discussion-counts dt{order:1;font-size:11px}.board-latest{grid-column:2;padding:0;display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px}.latest-title{min-height:44px;font-size:12px;color:var(--community-muted)}.latest-activity{padding:0;flex-direction:row;gap:5px;font-size:11px}.latest-activity time{font-size:10px}.member-avatar{width:28px;height:28px;flex:0 0 28px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:650;letter-spacing:.02em;background:hsl(var(--accent)/.13);color:var(--community-text);border-radius:50%}.discussion-row{display:block;padding:16px 18px}.discussion-meta{display:flex;align-items:center;gap:8px;margin-bottom:6px;min-width:0}.discussion-meta>.muted{flex:1;min-width:0;margin:0;font-size:11px;line-height:1.5;overflow-wrap:anywhere}.discussion-meta time{white-space:nowrap}.discussion-main .row-title{font-size:19px;font-weight:650;letter-spacing:-.025em;line-height:1.4;min-height:44px}.discussion-main>.excerpt{font-size:14px;line-height:1.7;margin:4px 0 0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;color:var(--community-muted)}.discussion-footer{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin-top:12px}.discussion-action{border-radius:999px;background:var(--community-hover);min-height:44px;padding:8px 14px;font-size:12px}.discussion-counts{margin:0;flex-direction:row;gap:12px}.discussion-footer>.latest-activity{margin-left:auto}.feed-filters{margin:0 0 12px;gap:6px}.feed-filters button{padding:8px 14px;border-radius:999px;background:transparent}.feed-filters button[aria-pressed=true]{background:var(--community-hover);color:var(--community-text);font-weight:650}.news-story{grid-template-columns:44px minmax(0,1fr);gap:12px}.news-rank{padding-top:6px;min-width:0}.rank-number{font-size:17px;font-weight:650}.news-main .row-title{font-size:18px;line-height:1.45;font-weight:650;min-height:44px}.news-main>.source{font-size:11px;line-height:1.6;margin:4px 0 8px}.news-main>.muted{font-size:11px;line-height:1.7}.news-preview .row-title{font-size:15px}.edition{margin:8px 0;font-size:12px}.breadcrumbs{margin:4px 0 0;gap:4px}.breadcrumbs button{padding:4px 6px;font-size:11px}.board-rules{padding:0 14px;border-radius:10px;background:var(--community-panel);margin:12px 0}.post{display:block;background:var(--community-panel);border-radius:12px;padding:20px;margin:10px 0}.post-author{flex-direction:row;align-items:center;gap:8px;margin:0 0 12px}.post-author strong{font-size:13px}.post-author .member-avatar{align-self:center}.post-author>.muted{margin-left:auto}.post-content{padding:0;max-width:75ch}.post-body{font-size:15px;line-height:1.85}.badge{padding:3px 5px;font-size:9px}.conversation-reply{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:16px;background:var(--community-panel);border-radius:12px;margin-top:12px}.conversation-reply p{margin:0}.profile-field h3{font-size:12px;margin:0;color:var(--community-muted)}.profile-field p{margin:4px 0 0}.record-row h2{font-size:16px;margin:0}.record-row>.post-body{font-size:14px;line-height:1.7}.member-list{grid-template-columns:1fr}.member-row{display:grid;grid-template-columns:34px minmax(0,1fr);gap:2px 12px}.member-row>.member-avatar{grid-row:1/5}.member-row>p,.member-row>a,.member-row>.badge{grid-column:2}.member-row>a{font-size:12px;min-height:44px;align-content:center}.info-row h3{margin:0;font-size:15px}.info-row>.post-body{font-size:14px}.composer{padding:16px;background:var(--community-panel);border-radius:12px;gap:16px;max-width:none}.composer textarea{min-height:230px;background:var(--community-backdrop)}.composer input,.composer select{background:var(--community-backdrop)}.composer label{font-size:13px;font-weight:550}.pager{margin-top:16px}.actions{gap:6px}.actions>a{display:inline-flex;align-items:center;min-height:44px;font-size:12px}.actions>button{border-radius:999px;padding:8px 14px}
.forum-chat{margin:0 0 8px;background:var(--community-panel);border-radius:12px;overflow:hidden}.chat-header{padding:2px 12px;background:transparent;min-height:44px;gap:6px}.chat-header h2{font-size:12px;margin:0;white-space:nowrap}.chat-peek{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px}.chat-header:has(#chat-toggle[aria-expanded=false]) #chat-profile,.chat-header:has(#chat-toggle[aria-expanded=false]) #chat-latest{display:none}.chat-header:has(#chat-toggle[aria-expanded=true]) .chat-peek{display:none}.chat-header h2:before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--community-identity);margin-right:7px}.chat-header button,.chat-row-actions button{min-height:44px;padding:4px 7px;background:transparent;font-size:11px}.chat-messages{max-height:76px;padding:0 12px}.chat-row{grid-template-columns:130px minmax(0,1fr);padding:5px 0;gap:8px}.chat-meta{font-size:11px;gap:4px}.chat-message{font-size:12px;line-height:1.5}.chat-form{padding:6px 12px;gap:6px}.chat-form input{font-size:14px;min-height:44px;flex:1;min-width:0;background:var(--community-backdrop);border-radius:999px}.chat-form button{min-height:44px;border-radius:999px}.chat-form>button:last-child:not(#chat-send){flex-basis:100%}#chat-notice{font-size:10px;padding:0 12px 6px}.chat-access{padding:0 12px 6px}.chat-refresh-controls{padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}.chat-refresh-controls p{width:100%;font-size:11px;line-height:1.6;margin:0;overflow-wrap:anywhere}.chat-refresh-controls button,.chat-refresh-controls a{min-height:44px;font-size:11px}#chat-older{min-height:44px}.chat-row-actions{grid-column:2}
@media(min-width:1000px){.workspace{grid-template-columns:190px minmax(0,1fr);gap:20px;padding:16px 24px}.masthead{grid-template-columns:190px minmax(0,1fr) auto}.sidebar{padding:0;position:sticky;top:90px;align-self:start;max-height:calc(100vh - 100px);overflow:auto}#navigation{display:block;padding:0}.primary-navigation{display:grid;gap:4px}.primary-navigation button{width:100%;text-align:left;padding:12px 14px!important}.navigation-more{margin:12px 0 0}.navigation-more summary{padding:8px 14px;color:var(--community-muted)}.secondary-navigation{position:static;min-width:0;max-width:100%;max-height:none;outline:0;background:transparent;padding:0;gap:2px}.secondary-navigation button{padding:10px 14px!important}.connection{padding:16px 12px;margin-top:16px;background:var(--community-panel);border-radius:12px;display:block}.connection strong{display:block;font-size:12px}.connection #mode{display:block;margin:6px 0;font-size:11px;line-height:1.7}.connection-details{margin:0}.connection-details summary{padding:4px 0}.connection-detail-panel{position:static;width:auto;max-width:100%;outline:0;padding:8px 0;background:transparent;border-radius:0}.main{padding:0 0 48px;max-width:680px}.view-heading{margin-top:12px}}
@media(min-width:1240px){.workspace{grid-template-columns:190px minmax(0,680px) 220px;justify-content:center;gap:24px}.context-rail{display:grid;gap:14px;position:sticky;top:90px;align-self:start;max-height:calc(100vh - 100px);overflow:auto;min-width:0}.context-panel{padding:16px;background:var(--community-panel);border-radius:12px;min-width:0}.context-panel h2{font-size:13px;margin:0 0 8px;font-weight:650}.context-panel p{font-size:12px;line-height:1.8;margin:0 0 8px}.context-panel a{font-size:12px;display:inline-flex;align-items:center;min-height:44px}.context-board{display:block;width:100%;text-align:left;background:transparent;padding:10px 0;font-size:12px}.context-access{background:hsl(var(--accent)/.05)}}
@media(max-width:680px){.masthead{padding:12px;gap:8px;grid-template-columns:minmax(0,1fr) auto}.brand{font-size:20px}.brand .brand-forum{font-size:11px;margin-top:4px}.mast-actions>button{padding:8px 12px;font-size:11px}.mast-actions{gap:0}.masthead{grid-template-columns:minmax(0,1fr) auto auto;padding:8px 12px}.brand .brand-forum{display:none}.product-search{width:auto;max-width:none;position:relative}.product-search>summary{display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;font-size:12px;cursor:pointer;list-style:none;padding:8px}.product-search>summary::-webkit-details-marker{display:none}.product-search>summary:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:2px}.product-search #search{position:absolute;right:0;top:50px;width:min(296px,calc(100vw - 24px));max-width:none;background:var(--community-panel);outline:1px solid hsl(var(--border));z-index:40}#query{font-size:16px;padding:10px 14px}.sidebar{padding:0 12px;top:60px}#navigation{gap:2px;padding:2px 0}.primary-navigation{gap:0;justify-content:space-between}.primary-navigation>button{padding:8px 5px!important;min-width:44px;flex:0 0 auto;font-size:12px!important}.navigation-more summary{padding:8px 6px;font-size:12px}#navigation button[aria-current=page]:before{display:none}.navigation-more summary:after{margin-left:3px}.connection{gap:2px 8px;min-height:36px;padding:0 0 4px}.connection strong{font-size:11px;max-width:calc(100% - 92px)}#mode{flex:1 1 100%;order:3;font-size:10px}.connection-details summary{min-height:36px;font-size:10px;padding:4px}.main{padding:4px 12px 28px}.view-heading{margin:0 0 6px;gap:4px 8px}.view-heading h1{font-size:23px}.view-heading>.muted{font-size:12px}.view-heading>.primary{margin-left:0}input,textarea,select,.chat-form input{font-size:16px}.row,.board{padding:14px}.board{grid-template-columns:30px minmax(0,1fr);gap:4px 10px}.board-icon{width:28px;height:28px;margin-top:6px}.board .row-title{font-size:17px;min-height:44px}.board-counts{grid-column:2;gap:12px}.board-latest{grid-column:2;display:block}.board-latest .latest-activity{display:none}.board-description>.excerpt{font-size:12px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.discussion-row{display:block;padding:14px}.discussion-main .row-title{font-size:18px;min-height:44px}.discussion-main>.excerpt{font-size:14px;-webkit-line-clamp:3}.discussion-meta>.muted{font-size:10px}.discussion-footer{gap:6px 10px;margin-top:10px}.discussion-footer>.latest-activity{margin-left:0;font-size:10px}.discussion-counts{gap:10px}.post{padding:16px}.post-author{gap:6px}.post-author>.muted{margin-left:0;flex:1 1 100%;padding-left:36px}.post-body{font-size:15px}.chat-header #chat-profile{display:inline;font-size:10px}.chat-header{gap:3px;padding:2px 10px}.chat-header button{padding:4px 5px}.chat-row{grid-template-columns:minmax(0,1fr);gap:1px}.chat-row-actions{grid-column:1}.chat-messages{max-height:70px}.section-bar{padding:0 2px 6px;gap:4px}.section-detail{font-size:10px}.news-story{grid-template-columns:38px minmax(0,1fr);gap:8px}.news-main .row-title{font-size:17px}.news-rank .rank-points{font-size:8px}.breadcrumbs{gap:2px}.composer{padding:14px}.composer textarea{min-height:210px}.edition select{width:auto;max-width:calc(100% - 55px)}}

/* Surface switcher and the final forum refinement layer. */
.surface-switcher{position:relative;min-width:0;align-self:center}.surface-switcher>summary{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer;list-style:none;border-radius:8px;padding:4px 0}.surface-switcher>summary::-webkit-details-marker{display:none}.surface-switcher>summary:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:4px}.surface-arrow{flex:none;color:var(--community-muted);transition:transform .15s ease}.surface-switcher[open] .surface-arrow{transform:rotate(180deg)}.surface-choices{position:absolute;left:0;top:calc(100% + 10px);width:300px;max-width:calc(100vw - 24px);padding:6px;background:var(--community-panel);border:1px solid hsl(var(--border));border-radius:14px;z-index:60;display:grid;gap:2px}.surface-choice{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 12px;width:100%;min-height:68px;padding:12px;border-radius:9px;text-decoration:none;text-align:left;background:transparent;min-width:0}.surface-choice:hover{background:var(--community-hover);color:var(--community-text)}.surface-choice strong{font-size:14px;font-weight:650}.surface-description{grid-column:1;font-size:12px;color:var(--community-muted);font-weight:400}.surface-current{grid-column:2;grid-row:1/3;align-self:center;font-size:10px;font-weight:500;color:var(--community-muted);padding:4px 7px;background:var(--community-hover);border-radius:99px}.surface-choice[aria-current=page]{background:var(--community-hover)}.surface-native-link{display:flex;align-items:center;min-height:44px;padding:8px 12px;color:var(--community-muted);font-size:11px;text-decoration:none}
.connection strong,#mode,.post-author strong,.member-row h2,.record-row .row-title,.conversation-reply p{min-width:0;max-width:100%;overflow-wrap:anywhere}.connection{min-width:0}.post-author{align-items:center}.post-author strong{flex:0 1 auto}.post-author>.muted{overflow-wrap:anywhere}.discussion-row{background:var(--community-panel);padding:18px 20px;border-radius:14px}.discussion-main .row-title{font-size:20px;line-height:1.35;letter-spacing:-.025em}.discussion-meta{margin-bottom:9px}.discussion-footer{gap:8px 12px;margin-top:14px}.discussion-action{font-weight:600;font-size:12px}.discussion-main>.excerpt{line-height:1.75}.board-index{gap:0;background:var(--community-panel);border-radius:14px;overflow:hidden}.board{border-radius:0;background:transparent;padding:18px 16px}.board:hover{background:var(--community-hover)}.board-counts,.discussion-counts{font-family:inherit}.board-counts dd{font-weight:650;font-size:12px}.board-counts dt{color:var(--community-muted)}.board-description>.excerpt{line-height:1.7}.board-latest{min-width:0;overflow-wrap:anywhere}.board-latest .latest-title{font-weight:500}.post{padding:22px;border-radius:14px}.post-author{padding-bottom:4px}.post-author strong{font-weight:650;font-size:14px}.post-body{font-size:15px;line-height:1.9}.post-content>a{min-height:44px;align-content:center}.conversation-reply{background:var(--community-hover);border-radius:14px}.conversation-reply>.muted{font-size:12px}.composer{padding:22px;border-radius:14px;gap:20px}.composer label{gap:10px;font-size:12px;font-weight:650}.composer input,.composer textarea,.composer select{border:1px solid hsl(var(--border));border-radius:9px}.composer textarea{min-height:260px;line-height:1.8}.composer .actions{padding-top:4px}.composer .actions button{font-weight:600}.attachments{padding:12px 0;font-size:12px}.mailbox-folders{display:flex;flex-wrap:wrap;gap:4px;width:100%;margin-top:6px}.mailbox-folders button{padding:8px 14px;border-radius:99px;font-size:12px;background:transparent;color:var(--community-muted)}.mailbox-folders button[aria-current=page]{background:var(--community-hover);color:var(--community-text);font-weight:650}.record-list,.member-list{gap:0;background:var(--community-panel);border-radius:14px;overflow:hidden}.record-row{padding:18px;border-radius:0;background:transparent}.record-row:hover{background:var(--community-hover)}.record-row>.muted{font-size:11px}.record-row.message-row>.post-body{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.7}.member-row{grid-template-columns:34px minmax(0,1fr);align-items:start}.member-row h2{font-size:14px;font-weight:650}.member-row .member-avatar{width:32px;height:32px;flex-basis:32px}.info-row h3{font-weight:650}.profile-field h3{text-transform:none;font-weight:500}.request-error{background:var(--community-panel);border-radius:14px;padding:20px;overflow-wrap:anywhere}.request-error>p{margin:0 0 12px;font-size:13px;line-height:1.75}.loading-state{display:grid;gap:10px}.loading-panel{display:grid;gap:12px;padding:20px;border-radius:14px;background:var(--community-panel)}.loading-panel span{display:block;border-radius:6px;background:var(--community-hover);animation:forum-loading 1.8s ease-in-out infinite alternate}.loading-meta{width:42%;height:16px}.loading-title{width:76%;height:25px}.loading-copy{width:92%;height:42px}.loading-action{width:100px;height:32px;border-radius:99px!important}@keyframes forum-loading{from{opacity:.55}to{opacity:1}}
@media(min-width:760px){.board{grid-template-columns:36px minmax(0,1fr) 64px 150px;gap:12px;align-items:center}.board-description{grid-column:2}.board-counts{grid-column:3;flex-direction:column;gap:8px}.board-counts div{flex-direction:column;gap:0}.board-latest{grid-column:4;display:block}.board-latest .latest-title{font-size:11px;line-height:1.65;min-height:32px}.board-latest .latest-activity{font-size:10px;line-height:1.7;display:flex;flex-direction:column;gap:2px}.board .row-title{font-size:16px}.board-description>.excerpt{font-size:12px}}
@media(max-width:680px){.surface-switcher>summary{gap:7px}.surface-arrow{width:14px;height:14px}.surface-choices{width:min(300px,calc(100vw - 24px));top:calc(100% + 8px)}.surface-choice{padding:12px}.connection strong{font-size:11px;overflow-wrap:anywhere}.connection-details{flex:none}.discussion-row{padding:16px;border-radius:12px}.discussion-main .row-title{font-size:18px;line-height:1.4}.discussion-meta{margin-bottom:6px}.discussion-meta>.muted{line-height:1.6}.discussion-footer{margin-top:12px;gap:6px 10px}.board{padding:15px 12px}.post{padding:18px;border-radius:12px}.post-author>.muted{padding-left:0;flex-basis:100%}.post-author strong{flex:1;min-width:0}.post-body{font-size:15px;line-height:1.85}.composer{padding:18px;gap:18px;border-radius:12px}.composer textarea{min-height:240px}.composer .actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.composer .actions>button{min-width:0}.composer .actions>.primary{grid-column:1/-1}.record-row{padding:16px}.conversation-reply{padding:16px}.conversation-reply>button{width:100%}.request-error{padding:18px}.loading-panel{padding:16px}.loading-title{width:84%}}
@media(prefers-reduced-motion:reduce){.surface-arrow{transition:none}.loading-panel span{animation:none}}
</style></head><body><div id="app"><header class="masthead"><details id="surface-switcher" class="surface-switcher"><summary id="surface-trigger" aria-label="SYMBaiEX site switcher"><span class="brand" aria-label="SYMBaiEX Forum">SYMB<span class="brand-ai">ai</span>EX <span class="brand-forum">Forum</span></span><svg class="surface-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><nav id="surface-choices" class="surface-choices" aria-label="SYMBaiEX sites"></nav></details><details id="search-panel" class="product-search"><summary>Search</summary><form id="search" role="search"><label for="query" class="sr-only">Search forum</label><input id="query" type="search" placeholder="Find discussions, ideas, research…" maxlength="500" required><button type="submit">Search</button></form></details><div class="mast-actions"><button id="compose" class="primary" type="button" hidden>Create post</button></div></header><div class="workspace"><aside class="sidebar"><nav id="navigation" aria-label="Forum sections"></nav><div class="connection"><div class="eyebrow">Acting profile</div><strong id="identity">Connecting profile…</strong><span id="mode">Server permissions apply</span><details id="connection-details" class="connection-details"><summary id="connection-trigger">Agent access</summary><div class="connection-detail-panel"><button id="expand" type="button" hidden>Expand forum</button><span id="connection-owner" hidden></span><div id="settings"></div><div id="posting-trust" class="posting-trust" hidden></div></div></details></div></aside><main class="main"><section id="forum-chat" class="forum-chat" aria-label="Live forum chat"><header class="chat-header"><h2>Live chat</h2><span id="chat-peek" class="chat-peek muted">Public community lounge</span><span id="chat-profile" class="muted">Connect to join</span><button id="chat-moderation" type="button" hidden>Moderation</button><button id="chat-latest" type="button">Refresh</button><button id="chat-toggle" type="button" aria-expanded="false" aria-controls="chat-panel">Open chat</button></header><div id="chat-panel" hidden><div id="chat-messages" class="chat-messages" role="log" aria-label="Public chat messages" aria-live="off"><p class="muted">Loading community chat…</p></div><button id="chat-older" type="button" hidden>Older messages</button><form id="chat-form" class="chat-form" hidden><label for="chat-body" class="sr-only">Your public chat message</label><input id="chat-body" maxlength="2000" placeholder="Say hello to the community…" required><button id="chat-send" type="submit" class="primary" disabled>Send</button></form><div id="chat-notice" role="status" aria-live="polite" class="muted"></div></div></section><div id="status" class="notice" role="status" aria-live="polite"></div><section id="content" aria-label="Forum content" aria-busy="true"><h1>Welcome to the forum</h1><p>Connecting to your SYMBaiEX tools…</p></section></main><aside id="forum-context" class="context-rail" aria-label="Community context"></aside></div></div><script>(${forumPluginAppRuntime.toString()})();</script></body></html>`;
