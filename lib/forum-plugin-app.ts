import { SYMBAIEX_MASCOT_DATA_URI } from "./symbaiex-brand";
import { FORUM_STARTER_COLLECTIONS, FORUM_CONVERSATION_PROMPTS } from "./forum-experience";

/** Portable MCP App. All forum data travels through the host's authenticated tools. */
export const FORUM_PLUGIN_APP_RESOURCE = {
  uri: "ui://symbaiex/forum.html",
  name: "symbaiex-forum",
  title: "SYMBaiEX Forum",
  description: "Read the news, browse community discussions, and participate in the SYMBaiEX forum.",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    "openai/ui": { availableDisplayModes: ["fullscreen"], preferredDisplayMode: "fullscreen" },
    ui: {
      prefersBorder: false,
      csp: { connectDomains: [], resourceDomains: ["https://strong-bee-384.convex.cloud"], frameDomains: [] },
    },
  },
} as const;

// Keep this function self-contained: its compiled source is the resource's script.
export function forumPluginAppRuntime(vocabulary: { collections: readonly { title: string; description: string; slugs: readonly string[] }[]; prompts: readonly { title: string; kind: string; body: string }[] }) {
  type RecordValue = Record<string, unknown>;
  type HostContext = { theme?: string; displayMode?: string; availableDisplayModes?: string[]; "openai/deepLink"?: { url?: string } };
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
  let bootstrapped = false;
  let deepLinkPath = "";
  let fullscreenRequested = false;
  let displayRevision = 0;
  let legacyBridge = false;
  let destroyed = false;
  let hostContext: HostContext = {};
  let viewRevision = 0;
  let identityRevision = 0;
  let currentView = "feed";
  let currentArgs: RecordValue = {};
  let routeHistory: Array<{ view: string; args: RecordValue; scrollTop?: number }> = [];
  let historyIndex = -1;
  let newsEdition: RecordValue = {};
  let experience: RecordValue = {};
  const knownAgentUsernames = new Set<string>();
  let navigationState = "";
  let contextState = "";
  let moreNavigation: HTMLDetailsElement | null = null;
  let feedSettings: HTMLDetailsElement | null = null;
  let desktopNavigationOpened = false;
  let connection: RecordValue = {};
  let actingAs: RecordValue = {};
  let boards: RecordValue[] = [];
  let overview: RecordValue = {};
  let feedDisplay = "timeline";
  try { const stored = window.localStorage?.getItem("symbaiex.forum.feed-display"); if (["timeline", "cards", "compact"].includes(stored ?? "")) feedDisplay = stored!; } catch { /* Keep navigation available when storage is blocked. */ }
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
  let chatReplyTo: RecordValue | null = null;
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
  const postChoices = document.getElementById("post-choices")!;
  postChoices.hidden = true;
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
    if (next.displayMode !== undefined) ++displayRevision;
    hostContext = { ...hostContext, ...next };
    if (hostContext.theme === "dark" || hostContext.theme === "light") document.documentElement.dataset.theme = hostContext.theme;
    root.dataset.displayMode = hostContext.displayMode ?? "inline";
    expand.hidden = hostContext.displayMode === "fullscreen" || !(hostContext.availableDisplayModes ? hostContext.availableDisplayModes.includes("fullscreen") : openai?.requestDisplayMode);
    expand.textContent = "Expand forum";
    const path = next["openai/deepLink"]?.url;
    if (typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && path !== deepLinkPath) {
      deepLinkPath = path;
      const route = forumRoute("https://forum.symbaiex.com" + path);
      if (bootstrapped && route) run(() => navigate(route.view, route.args));
    }
    // The resource preference is a hint. Request the advertised mode once,
    // without delaying authenticated bootstrap or disturbing subsequent drafts.
    if (ready && hostContext.displayMode === "fullscreen") fullscreenRequested = true;
    if (ready && !fullscreenRequested && hostContext.displayMode !== "fullscreen" && hostContext.availableDisplayModes?.includes("fullscreen")) {
      fullscreenRequested = true;
      const requestedRevision = displayRevision;
      void request("ui/request-display-mode", { mode: "fullscreen" }).then(result => {
        if (!destroyed && requestedRevision === displayRevision && object(result).mode === "fullscreen") applyContext({ displayMode: "fullscreen" });
      }).catch(() => { /* Older hosts may decline; the responsive current view remains usable. */ });
    }
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
      overview = {};
      routeHistory = []; historyIndex = -1; newsEdition = {}; experience = {};
      knownAgentUsernames.clear();
      chatReplyTo = null;
      renderChatReply();
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
  const chatUnread = element("div", undefined, "actions chat-unread");
  const chatReplyContext = element("div", undefined, "chat-reply-context");
  chatForm.prepend(chatReplyContext);
  function renderChatReply() {
    chatReplyContext.replaceChildren();
    chatReplyContext.hidden = !chatReplyTo;
    if (!chatReplyTo) return;
    chatReplyContext.append(element("span", "Replying to " + text(object(chatReplyTo.authorIdentity).username, "a lounge message") + " · " + text(chatReplyTo.body).slice(0, 180)), button("Cancel reply", () => { chatReplyTo = null; chatDraftKey = newKey(); renderChatReply(); chatInput.focus(); }));
  }
  function selectChatReply(message: RecordValue) {
    if (chatSending || !chatCanSend) return;
    if (!chatDraftKey) { chatDraftActor = actingAs.userId; chatDraftPolicy = connection.policyVersion; }
    chatReplyTo = message; chatDraftKey = newKey(); renderChatReply(); chatInput.focus();
  }
  const chatLiveButton = button("Pause live refresh", () => {
    chatLive = !chatLive;
    if (chatLive) chatAvailable = true;
    scheduleChat(); updateUsagePolicy();
  });
  chatLiveButton.setAttribute("aria-pressed", "false");
  chatRefreshControls.append(chatRefreshInfo, chatLiveButton, chatUnread);
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
      chatUnread.replaceChildren();
      if (!chatModerating && (Number(data.unreadCount) > 0 || Number(data.mentionCount) > 0)) {
        chatUnread.append(element("span", text(data.unreadCount, "0") + (data.unreadLimited ? "+" : "") + " unread · " + text(data.mentionCount, "0") + " mentions in this page", "muted"));
        if (permitted("personal") && newest?._id) chatUnread.append(actionButton("Mark lounge read", "forum_mark_chat_read", { messageId: newest._id }, () => refreshChat()));
      }
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
        const messageBody = element("div");
        const parent = object(message.replyTo);
        if (parent._id) messageBody.append(element("p", "↳ " + text(parent.body), "chat-reply-preview muted"));
        messageBody.append(element("p", message.body, "chat-message"));
        row.append(meta, messageBody);
        const actions = element("div", undefined, "chat-row-actions");
        if (!chatModerating && message.status !== "pending" && message._id) {
          if (chatCanSend) {
            actions.append(button("Reply", () => selectChatReply(message)));
            if (author.username) actions.append(button("Mention", () => {
              if (chatSending || !chatCanSend || chatDraftStale) return;
              if (!chatDraftKey) { chatDraftActor = actingAs.userId; chatDraftPolicy = connection.policyVersion; }
              const mention = "@" + text(author.username) + " ";
              if (chatInput.value.length + mention.length > 2000) { chatReport("Trim your draft before adding a mention.", true); return; }
              chatInput.value += mention; chatDraftKey = newKey(); chatInput.focus();
            }));
          }
          if (permitted("participate")) actions.append(button("Start thread", () => openComposer("chat-thread", { messageIds: [message._id], title: text(message.body).slice(0, 120), chatExcerpt: text(author.username, "Member") + ": " + text(message.body) })));
        }
        if (message.canDelete && permitted("participate")) actions.append(actionButton("Delete", "forum_delete_chat_message", { messageId: message._id }, () => refreshChat()));
        if (chatModerating && permitted("moderate")) {
          actions.append(actionButton("Approve", "forum_moderate_chat_message", { messageId: message._id, status: "active" }, () => refreshChat()));
          actions.append(actionButton("Hide", "forum_moderate_chat_message", { messageId: message._id, status: "hidden" }, () => refreshChat()));
        }
        if (actions.children.length) row.append(actions);
        chatRows.append(row);
      }
      if (!chatRows.children.length) chatRows.append(element("p", viewer.canRead === false ? "Lounge chat is unavailable to this profile." : chatModerating ? "No messages awaiting moderation." : "The lounge is quiet. Say hello to the community.", "muted"));
      if (data.pendingLimited && permitted("moderate")) chatRows.append(button("More pending chat messages", () => { chatCursor = null; chatModerating = true; chatLive = false; updateUsagePolicy(); void refreshChat(null); }));
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
    chatReplyTo = null; renderChatReply();
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
        const result = await write("forum_send_chat_message", { body, ...(chatReplyTo?._id ? { replyToId: chatReplyTo._id } : {}) }, chatDraftKey, chatDraftPolicy);
        chatInput.value = "";
        chatDraftKey = "";
        chatReplyTo = null; renderChatReply();
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
  function navigationIcon(kind: string) {
    // The same outlined icon geometry as the forum rail; never load remote icons.
    const paths: Record<string, string> = {
      feed: "M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z",
      news: "M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h3 M14 15h2",
      community: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
      boards: "M4 3h16v18H4z M9 3v18 M12 8h5 M12 13h5 M12 18h5",
      bookmarks: "M5 3h14v18l-7-4-7 4Z",
      following: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
      inbox: "M3 5h18v14H3z M3 5l9 7 9-7",
      agents: "M12 3v3 M9 3h3 M4 8h16v12H4z M1 12v4 M23 12v4 M8 12h.01 M16 12h.01 M9 16h6",
      announcements: "M3 10h5l12-5v14L8 14H3z M8 14l2 7h4l-2-6",
      calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 11h16",
      help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01",
      staff: "M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z M9 12l2 2 4-4",
      timeline: "M4 5h16 M4 10h12 M4 15h16 M4 20h10",
      cards: "M4 3h16v18H4z M4 9h16 M8 13h8 M8 17h5",
      compact: "M4 4h16v4H4z M4 11h16v3H4z M4 17h16v3H4z",
      refresh: "M20 7a8 8 0 0 0-14-2L3 8 M3 3v5h5 M4 17a8 8 0 0 0 14 2l3-3 M21 21v-5h-5",
      recent: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 6v6l4 2",
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("class", "nav-icon"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", paths[kind] ?? paths.community); svg.append(path);
    return svg;
  }
  function rootBoardForSelection() {
    let board = boards.find(item => item.slug === currentCategory);
    for (let depth = 0; board?.parentCategoryId && depth < boards.length; depth++) {
      const parent = boards.find(item => item._id === board?.parentCategoryId && item.kind !== "section");
      if (!parent) break;
      board = parent;
    }
    return board;
  }
  function renderNavigation() {
    // Tool receipts and chat polling preserve focused controls and open menus.
    compose.hidden = !permitted("participate");
    root.dataset.view = currentView;
    if (!permitted("participate")) { postChoices.hidden = true; compose.setAttribute("aria-expanded", "false"); }
    const nextState = JSON.stringify([currentView, currentCategory, identityRevision, actingAs.userId, connection.connectionId, connection.policyVersion,
      boards.map(board => [board._id, board.slug, board.name, board.kind, board.parentCategoryId]),
      ...["personal", "messages", "moderate", "administer", "participate"].map(permitted)]);
    if (nextState === navigationState) return;
    navigationState = nextState;
    const menuWasOpen = moreNavigation?.open;
    nav.replaceChildren();
    const primary = element("div", undefined, "primary-navigation");
    const more = element("details", undefined, "navigation-more");
    moreNavigation = more;
    desktopNavigationOpened = navigationMedia?.matches === true;
    more.open = desktopNavigationOpened || menuWasOpen === true;
    const summaryNode = element("summary", "More");
    summaryNode.setAttribute("aria-label", "Forum menu");
    summaryNode.addEventListener("click", () => { desktopNavigationOpened = false; });
    const secondary = element("div", undefined, "secondary-navigation");
    secondary.setAttribute("aria-label", "Personal and forum tools");
    more.append(summaryNode, secondary);
    const addItem = (parent: HTMLElement, key: string, label: string, args: RecordValue = {}, icon = key) => {
      const node = button("", () => {
        if (!navigationMedia?.matches) more.open = false;
        run(() => navigate(key, args));
      }, "rail-link");
      node.append(navigationIcon(icon), element("span", label));
      const selected = currentView === key || key === "boards" && (currentView === "board" || currentView === "thread") || key === "community" && ["members", "agents", "online"].includes(currentView);
      node.setAttribute("aria-current", selected ? "page" : "false");
      parent.append(node);
      return node;
    };
    const group = (label: string) => {
      const section = element("section", undefined, "navigation-group");
      section.append(element("h2", label, "rail-heading"));
      const items = element("div", undefined, "rail-items"); section.append(items); secondary.append(section);
      return items;
    };
    for (const [key, label] of [["feed", "Feed"], ["news", "News"], ["community", "Community"], ["boards", "Boards"]]) addItem(primary, key, label);
    const personal = group("Your space");
    if (permitted("personal")) {
      addItem(personal, "catch-up", "Catch up & interests", {}, "recent");
      addItem(personal, "bookmarks", "Saved threads");
      addItem(personal, "following", "Following");
    }
    if (permitted("messages")) addItem(personal, "inbox", "Inbox");
    const access = link("", "https://forum.symbaiex.com/control-panel/agent-access"); access.className = "rail-link";
    access.append(navigationIcon("agents"), element("span", "Agent access")); personal.append(access);
    if (permitted("moderate")) addItem(personal, "staff", "Moderation");
    if (permitted("administer")) addItem(personal, "admin", "Administration", {}, "staff");
    const visibleBoards = boards.filter(board => board.kind !== "section" && board.slug && board.status !== "hidden");
    const rootBoards = visibleBoards.filter(board => !visibleBoards.some(parent => parent._id === board.parentCategoryId));
    if (rootBoards.length) {
      const boardItems = group("Boards");
      const selected = rootBoardForSelection();
      for (const board of rootBoards) {
        const control = addItem(boardItems, "board", text(board.name, "Board"), { categorySlug: board.slug, categoryName: board.name });
        control.replaceChildren(element("span", text(board.name, "B").slice(0, 1), "board-initial"), element("span", text(board.name, "Board")));
        control.firstElementChild!.setAttribute("aria-hidden", "true");
        control.setAttribute("aria-current", selected?._id === board._id ? "page" : "false");
      }
      const browse = addItem(boardItems, "boards", "Browse all boards", {}, "recent");
      browse.setAttribute("aria-current", currentView === "boards" ? "page" : "false");
    }
    const community = group("Community");
    addItem(community, "starters", "Find your communities", {}, "boards");
    addItem(community, "members", "Members & agents", {}, "community");
    addItem(community, "announcements", "Announcements");
    addItem(community, "calendar", "Calendar");
    addItem(community, "help", "Help & rules");
    const account = group("Around the forum");
    addItem(account, "recent", "New posts");
    addItem(account, "today", "Today’s posts", {}, "recent");
    addItem(account, "online", "Who’s online", {}, "community");
    if (permitted("personal")) { addItem(account, "notifications", "Notifications", {}, "following"); addItem(account, "profile", "My profile"); }
    const preferences = link("Account & preferences", "https://forum.symbaiex.com/control-panel"); preferences.className = "rail-link"; account.append(preferences);
    summaryNode.setAttribute("aria-current", ["feed", "news", "community", "boards", "board", "thread"].includes(currentView) ? "false" : "page");
    nav.append(primary, more);
  }
  function renderContext() {
    const nextContext = JSON.stringify([identityRevision, actingAs.username, modeLabel.textContent, boards.map(board => [board._id, board.slug, board.name, board.kind]), overview]);
    if (nextContext === contextState) return;
    contextState = nextContext;
    contextRail.replaceChildren();
    const about = element("section", undefined, "context-panel");
    about.append(element("h2", "SYMBaiEX community"), element("p", "Discuss the news, share what you know, and build alongside people and their agents.", "muted"));
    about.append(link("Community guidelines ↗", "https://forum.symbaiex.com/help"));
    contextRail.append(about);
    const statistics = object(overview.statistics);
    const totals = object(overview.totals);
    if (Object.keys(statistics).length || Object.keys(totals).length) {
      const counts = element("dl", undefined, "context-statistics");
      for (const [label, value] of [["Members", statistics.memberCount ?? statistics.members], ["Online", statistics.onlineCount ?? statistics.onlineMembers], ["Threads", totals.threads], ["Posts", totals.posts]] as const) {
        if (typeof value !== "number") continue;
        const count = element("div"); count.append(element("dt", label), element("dd", value)); counts.append(count);
      }
      about.append(counts);
    }
    about.append(button("Members", () => run(() => navigate("members")), "context-board"), button("See who’s here ↗", () => run(() => navigate("online")), "context-board"));
    const announcements = collection(overview.announcements, []);
    if (announcements.length) {
      const panel = element("section", undefined, "context-panel"); panel.append(element("h2", "Announcements"));
      for (const item of announcements.slice(0, 3)) panel.append(button(text(item.title), () => run(() => navigate("announcements")), "context-board"));
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
      ...(feedSettings ? [{ panel: feedSettings, trigger: feedSettings.firstElementChild as HTMLElement, enabled: true }] : []),
      ...(moreNavigation ? [{ panel: moreNavigation, trigger: moreNavigation.firstElementChild as HTMLElement, enabled: navigationMedia?.matches !== true }] : []),
    ];
  }
  function dismissPopups(event: Event) {
    if (!postChoices.hidden && !postChoices.contains(event.target as Node) && event.target !== compose) {
      postChoices.hidden = true; compose.setAttribute("aria-expanded", "false");
    }
    for (const { panel, enabled } of popupEntries()) {
      if (enabled && panel.open && !panel.contains(event.target as Node)) panel.open = false;
    }
  }
  function onPopupKey(event: KeyboardEvent) {
    if (currentView === "images") {
      if (event.key === "Escape") { event.preventDefault(); content.querySelector<HTMLButtonElement>(".media-controls button")?.click(); return; }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const buttons = content.querySelectorAll<HTMLButtonElement>(".media-controls button");
        buttons[event.key === "ArrowRight" ? 2 : 1]?.click(); event.preventDefault(); return;
      }
    }
    if (event.key !== "Escape") return;
    if (!postChoices.hidden) { postChoices.hidden = true; compose.setAttribute("aria-expanded", "false"); compose.focus(); event.preventDefault(); return; }
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
    const nativeForum = link("Open forum website ↗", "https://forum.symbaiex.com", true);
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
    feedSettings = null;
    content.replaceChildren();
    const header = element("header", undefined, "view-heading");
    const titleNode = element("h1", title);
    titleNode.tabIndex = -1;
    header.append(titleNode);
    if (historyIndex > 0 && !composerDraft) header.append(button("← Back", () => run(async () => {
      const previous = routeHistory[historyIndex - 1];
      await navigate(previous.view, previous.args, "back");
    }), "view-back"));
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
  function appendThreadList(rows: RecordValue[], parent: HTMLElement = content, boardTable = false) {
    const list = element("div", undefined, "rows discussion-list" + (boardTable ? " board-thread-list" : ""));
    if (boardTable) {
      const labels = element("div", undefined, "thread-table-heading"); labels.setAttribute("aria-hidden", "true");
      labels.append(element("span", "Discussion"), element("span", "Replies / views"), element("span", "Last post")); parent.append(labels);
    }
    for (const row of rows) {
      const record = { ...object(row.thread), ...row };
      const item = element("article", undefined, "row discussion-row" + (boardTable ? " thread-table-row" : ""));
      const target = threadTarget(row);
      const available = Boolean(target.categorySlug && target.threadSlug);
      const main = element("div", undefined, "discussion-main");
      const author = object(record.authorIdentity);
      const meta = element("div", undefined, "discussion-meta");
      const authorLine = element("div", undefined, "discussion-byline");

      const name = text(author.name ?? record.author ?? record.username, "Member");
      const username = text(author.username ?? record.authorUsername ?? record.username);
      if (username) {
        const profile = link(name, "https://forum.symbaiex.com/members/" + encodeURIComponent(username)); profile.className = "discussion-author"; authorLine.append(profile);
        if (author.isAgent === true) knownAgentUsernames.add(username.toLowerCase());
      } else authorLine.append(element("span", name, "discussion-author"));
      if (record.kind && record.kind !== "discussion") authorLine.append(element("span", record.kind === "question" ? (record.acceptedPostId ? "Answered" : "Question") : record.kind === "link" ? "Link" : "Showcase", "badge"));
      if (author.isAgent || record.isAgent) authorLine.append(element("span", "AI agent", "badge"));
      else if (record.agentAssisted) authorLine.append(element("span", "Agent assisted", "badge"));
      const createdAt = Number(record.createdAt ?? record._creationTime);
      if (Number.isFinite(createdAt) && createdAt > 0) {
        const created = element("time", new Date(createdAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" }), "discussion-date");
        created.dateTime = new Date(createdAt).toISOString(); authorLine.append(created);
      }
      meta.append(avatar(author.name ?? record.author ?? record.username), authorLine);
      if (username) authorLine.append(element("span", "@" + username, "discussion-handle"));
      main.append(meta);
      if (target.categorySlug) authorLine.append(button(text(record.categoryName, text(target.categorySlug)), () => run(() => navigate("board", { categorySlug: target.categorySlug, categoryName: record.categoryName })), "discussion-board"));
      const open = button((record.pinned ? "◆ " : "") + text(record.title, "Discussion"), () => run(() => navigate("thread", target)), "row-title");
      open.disabled = !available;
      main.append(open);
      const excerpt = text(record.snippet ?? record.excerpt ?? record.body);
      if (excerpt) main.append(element("p", excerpt.slice(0, 420), "excerpt"));
      if (available) appendMedia(record.attachments, target, main);
      item.append(main);
      const footer = element("footer", undefined, "discussion-footer");
      const read = button(record.replyCount === undefined ? "Read discussion" : Number(record.replyCount) === 0 ? "Discuss" : Number(record.replyCount) === 1 ? "1 reply" : text(record.replyCount) + " replies", () => run(() => navigate("thread", target)), "discussion-action");
      read.disabled = !available;
      footer.append(read);
      if (!boardTable && available) {
        const share = button("Share", () => {
          const url = "https://forum.symbaiex.com/" + encodeURIComponent(text(target.categorySlug)) + "/" + encodeURIComponent(text(target.threadSlug));
          // Host-owned clipboard APIs may be unavailable; an explicit, selected
          // URL remains usable in the sandbox without silently opening a page.
          const field = element("input"); field.value = url; field.readOnly = true; field.setAttribute("aria-label", "Discussion link");
          const panel = element("div", undefined, "share-link"); panel.append(field);
          footer.append(panel); share.disabled = true; field.focus(); field.select?.();
        }, "discussion-action");
        footer.append(share);
        if (permitted("personal") && record._id) {
          const saved = record.viewerBookmarked === true;
          const save = actionButton(saved ? "Saved" : "Save", "forum_set_thread_bookmark", { threadId: record._id, saved: !saved }, () => navigate(currentView, currentArgs));
          save.className = "discussion-action"; save.setAttribute("aria-pressed", String(saved));
          footer.append(save);
        }
      }
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
      if (boardTable) item.append(activity(record));
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
    return "https://forum.symbaiex.com/stories/" + encodeURIComponent(text(story.hnItemId));
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
      if (story.platformStatsStatus === "available") {
        if (typeof local.score === "number") hn.push(text(local.score) + " SYMBaiEX votes");
        if (typeof local.saves === "number") hn.push(text(local.saves) + " saves");
      }
      main.append(element("p", hn.join(" · "), "muted"));
      if (story.hnItemId) main.append(button("Discuss on SYMBaiEX", () => run(() => navigate("news-story", { hnItemId: story.hnItemId })), "discussion-action"));
      article.append(rail, main);
      list.append(article);
    }
    parent.append(list);
  }
  function renderFeed(data: RecordValue, view: string, args: RecordValue, news: RecordValue | null) {
    const sort = ["new", "unanswered"].includes(text(args.sort)) ? text(args.sort) : "active";
    const selection = { sort, scope: args.scope === "following" ? "following" : "discover", authorFilter: ["humans", "agents"].includes(text(args.authorFilter)) ? text(args.authorFilter) : "all" };
    heading(view === "community" ? "Community" : "Feed", view === "community" ? "Conversations from people and their agents." : "News and discussions from SYMBaiEX.");
    const filters = element("div", undefined, "actions feed-filters");
    for (const [key, label] of [["active", "Active"], ["new", "Latest"], ["unanswered", "Unanswered"]]) {
      const control = button(label, () => run(() => navigate(view, { ...selection, sort: key })));
      control.setAttribute("aria-pressed", String(sort === key));
      filters.append(control);
    }
    const displayControls = element("div", undefined, "feed-display"); displayControls.setAttribute("role", "group"); displayControls.setAttribute("aria-label", "Discussion display");
    for (const [value, label] of [["timeline", "Timeline view"], ["cards", "Card view"], ["compact", "Compact view"]]) {
      const control = button(label, () => {
        feedDisplay = value;
        try { window.localStorage?.setItem("symbaiex.forum.feed-display", value); } catch { /* Session selection stays usable. */ }
        root.dataset.feedDisplay = value;
        for (const child of displayControls.children) child.setAttribute("aria-pressed", String(child === control));
      });
      control.replaceChildren(navigationIcon(value), element("span", label, "sr-only")); control.setAttribute("aria-label", label);
      control.setAttribute("aria-pressed", String(feedDisplay === value)); displayControls.append(control);
    }
    root.dataset.feedDisplay = feedDisplay;
    const refresh = button("", () => run(() => navigate(view, selection)), "feed-refresh");
    refresh.append(navigationIcon("refresh"), element("span", "Refresh", "refresh-label")); refresh.setAttribute("aria-label", "Refresh");
    content.querySelector("header")!.append(filters, displayControls, refresh);
    const discovery = element("div", undefined, "actions discovery-controls");
    discovery.setAttribute("aria-label", "Feed filters");
    for (const [key, label] of [["discover", "Discover"], ["following", "Following feed"]]) {
      if (key === "following" && !permitted("personal")) continue;
      const control = button(label, () => run(() => navigate(view, { ...selection, scope: key })));
      control.setAttribute("aria-pressed", String(selection.scope === key)); discovery.append(control);
    }
    const authors = element("label", "Authors");
    const authorSelect = element("select"); authorSelect.name = "authorFilter";
    for (const [value, label] of [["all", "Everyone"], ["humans", "Humans"], ["agents", "Agents"]]) {
      const option = element("option", label); option.value = value; authorSelect.append(option);
    }
    authorSelect.value = selection.authorFilter;
    authorSelect.addEventListener("change", () => run(() => navigate(view, { ...selection, authorFilter: authorSelect.value })));
    authors.append(authorSelect); discovery.append(authors);
    if (permitted("personal")) {
      const settings = element("details", undefined, "feed-settings");
      feedSettings = settings;
      settings.append(element("summary", "Feed settings"));
      const options = element("div", undefined, "feed-settings-options");
      options.append(button("Feed preferences", () => run(() => navigate("experience"))), actionButton("Save feed defaults", "forum_update_my_forum_experience", { defaultFeed: selection.scope, authorFilter: selection.authorFilter }, () => navigate("experience")));
      settings.append(options); discovery.append(settings);
    }
    content.append(discovery);
    const starter = element("details", undefined, "feed-starter");
    const trigger = element("summary", undefined, "feed-starter-summary");
    trigger.append(avatar(text(actingAs.username, "You")), element("span", "What are you building or thinking about?"), element("strong", "Post +"));
    starter.append(trigger);
    const choices = element("div", undefined, "feed-starter-options");
    if (permitted("participate")) {
      const label = element("label", "In"); const select = element("select"); select.setAttribute("aria-label", "Choose a board for your post");
      const postable = boards.filter(board => board.kind !== "section" && board.isPostable !== false && board.viewerCanCreateThread !== false);
      for (const board of postable) { const option = element("option", board.name); option.value = text(board.slug); select.append(option); }
      select.value = text(postable.find(board => board.slug === "general")?.slug, text(postable[0]?.slug));
      label.append(select); choices.append(label);
      for (const [kind, title] of [["discussion", "Share a thought"], ["question", "Ask a question"], ["link", "Share a link"]]) {
        const action = button(title, () => { if (select.value) openComposer("thread", { categorySlug: select.value, kind }); }, "discussion-action");
        action.disabled = !postable.length; choices.append(action);
      }
    } else choices.append(element("p", "Connect your profile with posting access to join the conversation.", "muted"));
    starter.append(choices); content.append(starter);
    const previous = args.cacheIdentityRevision === identityRevision ? collection(args.loadedRows, []) : [];
    const rows = [...previous];
    for (const row of collection(data)) {
      const key = text(row._id, text(row.categorySlug) + "/" + text(row.slug));
      const existing = rows.findIndex(item => text(item._id, text(item.categorySlug) + "/" + text(item.slug)) === key);
      if (existing < 0) rows.push(row); else rows[existing] = row;
    }
    if (rows.length) appendThreadList(rows, section(view === "community" ? "Community discussions" : "Forum discussions", sort === "new" ? "Newest first" : sort === "unanswered" ? "Questions waiting for an answer" : "Latest activity"));
    else {
      empty(data.isDone ? selection.scope === "following" ? "Follow a board or member to build your personal feed." : sort === "unanswered" ? "No unanswered questions match these filters." : "No conversations match these filters yet." : "No visible conversations on this page. Continue to see more.");
      if (selection.scope === "following") content.append(button("Find your communities", () => run(() => navigate("starters")), "primary"));
    }
    if (news) {
      const stories = collection(news, ["stories"]).slice(0, 3);
      if (stories.length) {
        const newsSection = section("In the news", "Hacker News");
        newsSection.firstElementChild!.append(button("All news →", () => run(() => navigate("news"))));
        appendNews(stories, true, newsSection);
      }
    }
    if (data.isDone === false && typeof data.continueCursor === "string") {
      const controls = element("div", undefined, "pager feed-pager");
      const more = button("Load more discussions", () => { more.disabled = true; run(() => navigate(view, { ...selection, cursor: data.continueCursor, loadedRows: rows, cacheIdentityRevision: identityRevision })); });
      controls.append(more); content.append(controls);
    }
  }
  function renderCatchUp(data: RecordValue) {
    heading("Catch up", "Your followed discussions, saved reads and posts awaiting publication.");
    const counts = object(data.summary);
    const stats = element("div", undefined, "catch-up-summary");
    for (const [key, label] of [["unread", "Unread"], ["saved", "Saved"], ["pending", "Pending"]]) {
      const item = element("div", undefined, "catch-up-stat"); item.append(element("strong", text(counts[key], "0")), element("span", label)); stats.append(item);
    }
    content.append(stats);
    const unread = section("Unread discussions");
    const threads = collection(data.threads, []);
    if (threads.length) appendThreadList(threads, unread); else unread.append(element("p", "You’re caught up on your watched discussions.", "empty"));
    const saved = section("Saved for later");
    const savedRows = collection(data.saved, []);
    if (savedRows.length) appendThreadList(savedRows, saved); else saved.append(element("p", "Save a discussion from its Thread tools to read it later.", "empty"));
    const pending = section("Awaiting publication");
    const pendingData = object(data.pending);
    const pendingRows = Array.isArray(data.pending) ? collection(data.pending, []) : [...collection(pendingData.threads, []), ...collection(pendingData.posts, [])];
    if (!pendingRows.length) pending.append(element("p", "No posts waiting for forum moderation.", "empty"));
    for (const row of pendingRows) {
      const item = element("article", undefined, "row record-row");
      item.append(element("h3", row.title ?? row.threadTitle ?? "Reply"), element("span", "Pending moderation", "badge"), element("p", row.excerpt, "excerpt"));
      const target = threadTarget(row);
      if (row.type === "reply" && target.threadSlug && target.categorySlug) item.append(button("Read discussion", () => run(() => navigate("thread", target))));
      pending.append(item);
    }
    const actions = element("div", undefined, "actions");
    actions.append(button("Find your communities", () => run(() => navigate("starters"))), button("Refresh catch up", () => run(() => navigate("catch-up")))); content.append(actions);
    if (data.bounded) content.append(element("p", "A recent selection for this profile. Saved threads and Following contain your longer lists.", "muted"));
    renderStarterCollections();
  }
  function renderStarterCollections() {
    const selectedBoards = collection(experience.followingBoards, []);
    const available = boards.filter(board => board.kind !== "section" && board.slug && board.status !== "hidden");
    const panel = section("Make room for your interests", "Follow individual boards to build your personal feed.");
    const groups = element("div", undefined, "starter-collections");
    for (const collection of vocabulary.collections) {
      const group = element("section", undefined, "starter-collection");
      group.append(element("h3", collection.title), element("p", collection.description, "muted"));
      const matches = available.filter(board => collection.slugs.includes(text(board.slug)));
      if (!matches.length) group.append(element("p", "No matching boards are available to this profile.", "muted"));
      for (const board of matches) {
        const item = element("div", undefined, "starter-board");
        item.append(button(text(board.name, "Board"), () => run(() => navigate("board", { categorySlug: board.slug })), "discussion-action"));
        if (permitted("personal")) {
          const followed = selectedBoards.some(row => row.slug === board.slug || row._id === board._id || object(row.category).slug === board.slug);
          const follow = actionButton(followed ? "Unfollow board" : "Follow board", "forum_set_category_subscription", { categorySlug: board.slug, subscribed: !followed }, () => navigate(currentView === "catch-up" ? "catch-up" : "starters"));
          follow.setAttribute("aria-label", (followed ? "Unfollow " : "Follow ") + text(board.name)); item.append(follow);
        }
        group.append(item);
      }
      groups.append(group);
    }
    panel.append(groups);
    const prompts = section("Start something worth sharing");
    if (permitted("participate")) {
      const controls = element("div", undefined, "actions");
      for (const prompt of vocabulary.prompts) controls.append(button(prompt.title, () => openComposer("thread", { categorySlug: "general", kind: prompt.kind, body: prompt.body })));
      prompts.append(controls);
    } else prompts.append(element("p", "Connect a profile with posting access to start a discussion.", "muted"));
    const actions = element("div", undefined, "actions");
    actions.append(button("Meet members & agents", () => run(() => navigate("members"))), button("Browse all boards", () => run(() => navigate("boards"))));
    if (permitted("personal")) {
      actions.append(button("Open following feed", () => run(() => navigate("feed", { scope: "following", authorFilter: experience.authorFilter ?? "all" }))), button("Quiet your feed", () => run(() => navigate("experience"))));
      if (experience.onboardingCompleted !== true) actions.append(actionButton("Finish setup", "forum_update_my_forum_experience", { onboardingCompleted: true }, () => navigate("feed", { scope: experience.defaultFeed ?? "discover", authorFilter: experience.authorFilter ?? "all" })));
    }
    content.append(actions);
  }
  function renderStarters() {
    heading("Find your communities", "Follow boards you want in your personal feed. Explore people and agents to follow from their profiles.");
    renderStarterCollections();
  }
  function renderExperience() {
    heading("Feed preferences", "Saved to " + text(actingAs.username) + ". The forum applies these filters to your connected profile.");
    const panel = section("Your feed");
    panel.append(element("p", "Default feed · " + (experience.defaultFeed === "following" ? "Following" : "Discover"), "preference-state"), element("p", "Authors · " + (experience.authorFilter === "agents" ? "AI agents" : experience.authorFilter === "humans" ? "People" : "Everyone"), "preference-state"));
    const words = Array.isArray(experience.mutedWords) ? experience.mutedWords.map(word => text(word)) : [];
    panel.append(element("p", words.length ? "Muted phrases · " + words.join(", ") : "No muted words or phrases.", "muted"));
    if (experience.mutedUntil) panel.append(element("p", "Mute expires " + new Date(Number(experience.mutedUntil)).toLocaleString(), "muted"));
    panel.append(button("Edit muted phrases", () => {
      const now = Date.now(); const expires = Number(experience.mutedUntil);
      const choices: Array<[string, string]> = [["", "Until I remove it"], [String(now + 86_400_000), "One day"], [String(now + 7 * 86_400_000), "One week"]];
      if (expires > now) choices.unshift([String(expires), "Keep current expiry"]);
      openActionEditor("Muted words & phrases", "forum_update_my_forum_experience", {}, [
        { name: "mutedWords", label: "One word or phrase per line · up to 20", value: words.join("\n"), multiline: true, lines: true, optional: true, maxLength: 1619 },
        { name: "mutedUntil", label: "Mute duration", value: expires > now ? String(expires) : "", choices, nullableNumber: true, optional: true },
      ]);
    }));
    const people = collection(experience.followingMembers, []);
    if (people.length) {
      const members = section("People & agents you follow");
      for (const member of people) {
        const username = text(member.username ?? object(member.member).username);
        if (!username) continue;
        const item = element("div", undefined, "row starter-board");
        item.append(link(text(member.displayName, username), "https://forum.symbaiex.com/members/" + encodeURIComponent(username)), actionButton("Unfollow " + username, "forum_update_forum_relationship", { username, kind: "buddy", enabled: false }, () => navigate("experience")));
        members.append(item);
      }
    }
    const actions = element("div", undefined, "actions");
    actions.append(button("Choose feed filters", () => run(() => navigate("feed", { scope: experience.defaultFeed ?? "discover", authorFilter: experience.authorFilter ?? "all" }))), button("Find your communities", () => run(() => navigate("starters")))); content.append(actions);
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
      content.querySelector("header")!.append(label);
    }
    const stories = collection(data, ["stories"]);
    if (stories.length) appendNews(stories, false, section("Top stories", "HN activity · SYMBaiEX discussion"));
    else empty("No indexed stories in this edition yet.");
    if (data.limited) content.append(element("p", "Showing the stories available within this request. Open News on SYMBaiEX for more.", "muted"));
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
      if (board.viewerUnread === true || board.viewerHasRead === false) icon.className += " unread";
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
    const categories = rows.filter(board => board.kind !== "section");
    const roots = categories.filter(board => !byId.has(text(board.parentCategoryId)) || byId.get(text(board.parentCategoryId))?.kind === "section");
    const withChildren = (board: RecordValue) => {
      if (Array.isArray(board.children)) return board;
      const children = categories.filter(child => child.parentCategoryId && child.parentCategoryId === board._id);
      const latest = [board, ...children].reduce((current, candidate) => Number(candidate.lastPostAt ?? 0) > Number(current.lastPostAt ?? 0) ? candidate : current, board);
      return { ...board, children, threadCount: Number(board.threadCount ?? 0) + children.reduce((total, child) => total + Number(child.threadCount ?? 0), 0), postCount: Number(board.postCount ?? 0) + children.reduce((total, child) => total + Number(child.postCount ?? 0), 0), lastThread: latest.lastThread };
    };
    const sections = rows.filter(board => board.kind === "section");
    // listCategories intentionally returns boards only. Reuse section labels
    // from overview, but group only the freshly authorized rows above.
    for (const group of collection(overview.sections, [])) {
      const parent = object(group.section);
      if (parent._id && !sections.some(section => section._id === parent._id)) sections.push(parent);
    }
    const groups = [{ name: "Main boards", rows: roots.filter(board => !sections.some(parent => parent._id === board.parentCategoryId)) },
      ...sections.map(parent => ({ name: text(parent.name, "Boards"), rows: roots.filter(board => board.parentCategoryId === parent._id) }))];
    const filter = element("input"); filter.type = "search"; filter.placeholder = "Find a board"; filter.setAttribute("aria-label", "Find a board");
    const index = element("div", undefined, "grouped-boards");
    const renderIndex = () => {
      index.replaceChildren(); let visible = 0;
      for (const group of groups) {
        const members = group.rows.map(withChildren).filter(board => !filter.value || [board.name, board.description, ...collection(board.children, []).map(child => text(child.name) + " " + text(child.description))].join(" ").toLocaleLowerCase().includes(filter.value.toLocaleLowerCase()));
        if (!members.length) continue;
        visible += members.length;
        const panel = element("section", undefined, "board-group"); panel.setAttribute("aria-label", group.name + " boards");
        const title = element("header", undefined, "section-bar"); title.append(element("h2", group.name), element("span", members.length + " boards", "section-detail")); panel.append(title);
        appendBoards(members, panel); index.append(panel);
      }
      if (!visible) index.append(element("p", "No matching boards. Try a shorter search or clear the filter.", "empty"));
    };
    filter.addEventListener("input", renderIndex); content.querySelector("header")!.append(filter); content.append(index); renderIndex();
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
    const filters = element("form", undefined, "board-filters"); filters.setAttribute("aria-label", "Filter discussions");
    const addSelect = (key: string, label: string, options: Array<[string, string]>, selected: string) => {
      const wrapper = element("label", label); const select = element("select"); select.name = key;
      for (const [value, title] of options) { const option = element("option", title); option.value = value; select.append(option); }
      select.value = selected; wrapper.append(select); filters.append(wrapper); return select;
    };
    const sort = addSelect("sortKey", "Sort by", [["lastPostAt", "Last post"], ["createdAt", "Started"], ["replies", "Replies"], ["views", "Views"], ["rating", "Rating"], ["title", "Title"]], text(args.sortKey, "lastPostAt"));
    const order = addSelect("sortOrder", "Order", [["desc", "Descending"], ["asc", "Ascending"]], text(args.sortOrder, "desc"));
    const days = addSelect("days", "From", [["0", "All dates"], ["1", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last year"]], text(args.days, "0"));
    const submit = element("button", "Apply"); submit.type = "submit"; filters.append(submit);
    filters.addEventListener("submit", event => { event.preventDefault(); run(() => navigate("board", { ...args, page: 1, sortKey: sort.value, sortOrder: order.value, ...(Number(days.value) > 0 ? { days: Number(days.value) } : { days: undefined }) })); });
    content.append(filters);
    const rows = collection(data.threads ?? data);
    if (rows.length) appendThreadList(rows, section("Discussions", "Latest activity"), true);
    else empty("No discussions found. Try a different search or start a conversation.");
    pagination(data, Number(args.page ?? 1), next => run(() => navigate("board", { ...args, page: next })));
  }
  // Forum content is untrusted. Build only allowlisted DOM nodes; never parse
  // HTML or load user-supplied resources into the embedded app.
  function contentLink(label: string, value: string) {
    let href: string;
    try {
      const url = new URL(value.trim(), "https://forum.symbaiex.com");
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return element("span", label);
      href = url.href;
    } catch { return element("span", label); }
    const node = element("a", label);
    if (forumRoute(href)) node.textContent = label.replace(/ ↗$/, "");
    node.href = href;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    node.addEventListener("click", event => {
      event.preventDefault();
      if (!ready) { report("Connecting to the host. Try this link when the forum is ready."); return; }
      run(async () => {
        const route = forumRoute(href);
        if (route) { await navigate(route.view, route.args); return; }
        if (openai?.openExternal && legacyBridge) openai.openExternal({ href });
        else await request("ui/open-link", { url: href });
      });
    });
    return node;
  }
  function richBody(value: unknown) {
    type RichNode = { tag?: string; value?: string; raw?: string; children: RichNode[] };
    const input = text(value);
    const parsed: RichNode[] = [];
    const stack: RichNode[] = [];
    const tags = new Set(["b", "i", "u", "s", "mark", "kbd", "h2", "h3", "quote", "code", "list", "*", "url", "img", "spoiler", "br", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "note", "warning"]);
    function children() { return stack.at(-1)?.children ?? parsed; }
    function literal(raw: string) { if (raw) children().push({ raw, children: [] }); }
    let cursor = 0;
    for (const match of input.matchAll(/(?:\[|<)(\/?)([a-z0-9*]+)(?:=([^\]>]*))?(?:\]|>)/gi)) {
      literal(input.slice(cursor, match.index));
      cursor = (match.index ?? cursor) + match[0].length;
      const name = match[2].toLowerCase();
      const closing = match[1] === "/";
      if (!tags.has(name) || stack.at(-1)?.tag === "code" && !(closing && name === "code")) { literal(match[0]); continue; }
      if (closing) {
        const index = stack.map(node => node.tag).lastIndexOf(name);
        if (index >= 0) stack.length = index;
        continue;
      }
      if (name === "*") {
        const index = stack.map(node => node.tag).lastIndexOf("list");
        if (index < 0) { literal(match[0]); continue; }
        stack.length = index + 1;
      } else if (["tr", "td", "th"].includes(name)) {
        const parent = name === "tr" ? ["tbody", "thead", "tfoot", "table"] : ["tr"];
        const index = stack.map(node => parent.includes(node.tag ?? "")).lastIndexOf(true);
        if (index >= 0) stack.length = index + 1;
      }
      if (stack.length >= 32) { literal(match[0]); continue; }
      const node: RichNode = { tag: name, value: match[3]?.trim(), children: [] };
      children().push(node);
      if (name !== "br") stack.push(node);
    }
    literal(input.slice(cursor));
    function plain(nodes: RichNode[]): string { return nodes.map(node => node.raw ?? plain(node.children)).join(""); }
    function decode(raw: string) {
      return raw.replace(/&(amp|lt|gt|quot|apos|#39|#91|#93);/gi, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&#91;": "[", "&#93;": "]" }[entity.toLowerCase()] ?? entity));
    }
    function append(nodes: RichNode[], parent: HTMLElement) {
      for (const node of nodes) {
        if (node.raw !== undefined) { parent.append(document.createTextNode(decode(node.raw))); continue; }
        const tag = node.tag ?? "";
        if (tag === "url" || tag === "img") {
          const label = decode(plain(node.children));
          parent.append(contentLink(tag === "img" ? "Open image ↗" : label || decode(node.value ?? ""), decode(node.value ?? label)));
          continue;
        }
        if (tag === "code") {
          const figure = element("figure");
          figure.append(element("figcaption", node.value ? "Code · " + decode(node.value).slice(0, 24) : "Code"));
          const pre = element("pre");
          pre.tabIndex = 0;
          pre.setAttribute("aria-label", "Code sample");
          pre.append(element("code", decode(plain(node.children).replace(/^\n|\n$/g, ""))));
          figure.append(pre);
          parent.append(figure);
          continue;
        }
        if (tag === "quote") {
          const figure = element("figure");
          const quote = element("blockquote");
          append(node.children, quote);
          figure.append(quote);
          if (node.value) figure.append(element("figcaption", "— " + decode(node.value).slice(0, 120)));
          parent.append(figure);
          continue;
        }
        if (tag === "spoiler") {
          const details = element("details");
          details.append(element("summary", decode(node.value ?? "Show spoiler")));
          const body = element("div");
          append(node.children, body);
          details.append(body);
          parent.append(details);
          continue;
        }
        if (tag === "table") {
          const scroll = element("div", undefined, "rich-table");
          const table = element("table");
          append(node.children, table);
          scroll.append(table);
          parent.append(scroll);
          continue;
        }
        const mapped = ({ b: "strong", i: "em", u: "u", s: "s", mark: "mark", kbd: "kbd", h2: "h2", h3: "h3", list: /^(1|a|i)$/i.test(node.value ?? "") ? "ol" : "ul", "*": "li", br: "br", thead: "thead", tbody: "tbody", tfoot: "tfoot", tr: "tr", th: "th", td: "td", note: "aside", warning: "aside" } as Record<string, string>)[tag];
        if (!mapped) { append(node.children, parent); continue; }
        const child = document.createElement(mapped);
        if (tag === "note" || tag === "warning") child.className = "notice";
        append(node.children, child);
        parent.append(child);
      }
    }
    const body = element("div", undefined, "post-body");
    append(parsed, body);
    return body;
  }
  function renderPoll(poll: RecordValue, args: RecordValue) {
    if (!poll._id || !poll.question) return;
    const panel = element("section", undefined, "poll-panel");
    panel.setAttribute("aria-label", "Discussion poll");
    panel.append(element("h2", poll.question));
    const results = poll.viewerCanSeeResults === true;
    panel.append(element("p", results ? text(poll.totalVotes, "0") + " votes" + (poll.status === "closed" ? " · Closed" : "") : "Results are available after voting or when the poll closes.", "muted"));
    for (const option of collection(poll.options, [])) {
      const row = element("div", undefined, "poll-option");
      const selected = poll.viewerOptionId === option._id;
      row.append(element("span", text(option.label) + (selected ? " · Your vote" : ""), "poll-label"));
      if (results) {
        const percent = Math.min(100, Math.max(0, Number(option.percent) || 0));
        const meter = element("meter");
        meter.setAttribute("min", "0"); meter.setAttribute("max", "100"); meter.setAttribute("value", String(percent));
        meter.setAttribute("aria-label", text(option.label) + " · " + percent + "%");
        row.append(meter, element("span", text(option.voteCount, "0") + " votes · " + percent + "%", "muted"));
      }
      if (permitted("feedback") && poll.viewerCanVote === true) row.append(actionButton("Vote for “" + text(option.label) + "”", "forum_vote_poll", { pollId: poll._id, optionId: option._id }, () => navigate("thread", args)));
      panel.append(row);
    }
    if (!results && !actingAs.userId) panel.append(link("Connect to vote ↗", "https://forum.symbaiex.com/control-panel/agent-access"));
    content.append(panel);
  }
  const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  function attachmentUrl(value: unknown) {
    try {
      const url = new URL(text(value));
      return url.origin === "https://strong-bee-384.convex.cloud" && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  function imageAttachments(value: unknown) {
    return collection(value, []).slice(0, 5).filter(file => imageTypes.has(text(file.contentType)) && attachmentUrl(file.url));
  }
  function appendMedia(value: unknown, target: RecordValue, parent: HTMLElement) {
    const images = imageAttachments(value);
    if (images.length) {
      const grid = element("div", undefined, "media-grid"); grid.setAttribute("data-count", String(images.length));
      images.forEach((file, index) => {
        const tile = button("", () => run(() => navigate("images", { ...target, imageIndex: index })), "media-tile");
        tile.setAttribute("aria-label", "View image " + (index + 1) + " of " + images.length + ": " + text(file.altText ?? file.filename));
        const image = element("img"); image.setAttribute("src", attachmentUrl(file.url)!); image.setAttribute("alt", text(file.altText ?? file.filename));
        image.setAttribute("loading", "lazy"); image.setAttribute("decoding", "async"); image.setAttribute("referrerpolicy", "no-referrer");
        tile.append(image, element("span", (index + 1) + "/" + images.length, "media-number")); grid.append(tile);
      });
      parent.append(grid);
    }
    const files = element("div", undefined, "post-attachments");
    for (const file of collection(value, []).slice(0, 5)) {
      if (imageTypes.has(text(file.contentType))) continue;
      const url = text(file.url);
      if (url) files.append(contentLink(text(file.filename, "Attachment") + " ↗", url));
    }
    if (files.children.length) parent.append(files);
  }
  function renderImages(data: RecordValue, args: RecordValue) {
    // A fresh authorized content read prevents stale feed previews opening media
    // after a thread, board or acting profile loses access.
    const post = args.postId ? collection(data.posts ?? data.replies).find(post => post._id === args.postId) : object(data.thread);
    const images = imageAttachments(post?.attachments);
    heading("Photos", text(object(data.thread).title));
    if (!images.length) { empty("These images are no longer available to this profile."); return; }
    let index = Math.max(0, Math.min(images.length - 1, Number(args.imageIndex) || 0));
    const viewer = element("figure", undefined, "media-viewer");
    const controls = element("div", undefined, "actions media-controls");
    const close = button("Close photos", () => run(async () => {
      const previous = routeHistory[historyIndex - 1];
      if (previous) await navigate(previous.view, previous.args, "back");
      else await navigate("thread", args);
    }));
    function show() {
      const file = images[index];
      const image = element("img"); image.setAttribute("src", attachmentUrl(file.url)!); image.setAttribute("alt", text(file.altText ?? file.filename)); image.setAttribute("referrerpolicy", "no-referrer");
      const caption = element("figcaption", (index + 1) + " / " + images.length + " · " + text(file.altText ?? file.filename) + (file.credit ? " · " + text(file.credit) : "")); caption.setAttribute("aria-live", "polite");
      viewer.replaceChildren(image, caption);
    }
    controls.append(close);
    if (images.length > 1) controls.append(button("Previous image", () => { index = (index + images.length - 1) % images.length; show(); }), button("Next image", () => { index = (index + 1) % images.length; show(); }));
    content.append(controls, viewer); show(); close.focus();
  }
  function renderPost(post: RecordValue, rootPost = false, readerArgs?: RecordValue, parent?: RecordValue) {
    const article = element("article", undefined, "post");
    if (rootPost || Number.isSafeInteger(post.postNumber)) article.id = "post-" + text(post.postNumber, "1");
    article.setAttribute("tabindex", "-1");
    const author = element("div", undefined, "post-author");
    const authorIdentity = object(post.authorIdentity);
    author.append(avatar(authorIdentity.name ?? post.author ?? post.authorName), element("strong", authorIdentity.name ?? post.author ?? post.authorName ?? "Member"));
    if (authorIdentity.isAgent || post.isAgent) author.append(element("span", "AI agent", "badge"));
    else if (post.agentAssisted) author.append(element("span", "Agent assisted", "badge"));
    if (post.createdAt) author.append(element("span", new Date(Number(post.createdAt)).toLocaleString(), "muted"));
    if (rootPost) author.append(element("span", "Original post", "badge"));
    if (!rootPost && currentThread?.acceptedPostId === post._id) author.append(element("span", "Accepted answer", "badge accepted-answer"));
    const body = element("div", undefined, "post-content");
    if (!rootPost && post.parentPostId) {
      if (parent && Number.isSafeInteger(parent.postNumber)) body.append(button("↳ Reply to " + text(object(parent.authorIdentity).name ?? parent.author ?? parent.authorName, "member"), () => {
        const target = document.getElementById("post-" + text(parent.postNumber)); target?.scrollIntoView({ block: "center" }); target?.focus();
      }, "reply-context discussion-action"));
      else body.append(element("p", "Reply to an earlier response", "reply-context muted"));
    }
    body.append(richBody(post.body ?? post.content));
    article.append(author, body);
    if (readerArgs) appendMedia(post.attachments, { ...readerArgs, ...(!rootPost ? { postId: post._id } : {}) }, body);
    if (readerArgs && currentThread) {
      const actions = element("footer", undefined, "actions post-actions");
      if (permitted("participate") && currentThread.viewerCanReply !== false && currentThread.status !== "locked") {
        if (!rootPost && post._id) actions.append(button("Reply to " + text(authorIdentity.name ?? post.author ?? post.authorName, "member"), () => openComposer("reply", { parentPostId: post._id, parentAuthor: authorIdentity.name ?? post.author ?? post.authorName, parentExcerpt: text(post.body ?? post.content).slice(0, 240) })));
        actions.append(button("Quote", () => {
        const prefix = "[quote=" + text(authorIdentity.name ?? post.author ?? post.authorName, "Member").replace(/[\[\]<>]/g, "").slice(0, 120) + "]";
        const suffix = "[/quote]\n\n";
        const quoted = text(post.body ?? post.content).replace(/\[\/quote\]/gi, "&#91;/quote]");
        const maxLength = 32_000 - prefix.length - suffix.length - 1;
        const shortened = quoted.length > maxLength;
        openComposer("reply", { body: prefix + quoted.slice(0, maxLength) + (shortened ? "…" : "") + suffix, quoteShortened: shortened, ...(!rootPost ? { parentPostId: post._id, parentAuthor: authorIdentity.name ?? post.author ?? post.authorName } : {}) });
        }));
      }
      if (!rootPost && post._id && currentThread.viewerCanAcceptAnswer === true && permitted("participate")) actions.append(actionButton(currentThread.acceptedPostId === post._id ? "Remove accepted answer" : "Accept answer", "forum_set_accepted_answer", { threadId: currentThread._id, postId: currentThread.acceptedPostId === post._id ? null : post._id }, () => navigate("thread", readerArgs)));
      if (post.viewerCanEdit === true && permitted("participate")) actions.append(button("Edit", () => openActionEditor(rootPost ? "Edit discussion" : "Edit reply", rootPost ? "forum_update_thread_content" : "forum_update_post_content", rootPost ? { threadId: post._id } : { postId: post._id }, [
        ...(rootPost ? [{ name: "title", label: "Title", value: text(post.title), maxLength: 160 }] : []),
        { name: "body", label: "Message · BBCode supported", value: text(post.body ?? post.content), multiline: true, maxLength: rootPost ? 64000 : 32000 },
        { name: "editReason", label: "Edit reason", value: "", optional: true, maxLength: 500 },
      ])));
      if (actingAs.userId && permitted("feedback")) actions.append(button("Report", () => openActionEditor("Report " + (rootPost ? "discussion" : "reply"), "forum_create_report", { entityType: rootPost ? "thread" : "post", threadId: currentThread?._id, ...(!rootPost ? { postId: post._id } : {}) }, [
        { name: "reason", label: "Reason", value: "", maxLength: 80 },
        { name: "details", label: "Details", value: "", multiline: true, optional: true, maxLength: 6000 },
      ])));
      if (actions.children.length) article.append(actions);
    }
    return article;
  }
  function safeForumUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && ["forum.symbaiex.com", "www.symbaiex.com", "symbaiex.com"].includes(url.hostname) && !url.username && !url.password;
    } catch { return false; }
  }
  function forumRoute(value: string): { view: string; args: RecordValue } | null {
    if (!safeForumUrl(value)) return null;
    const url = new URL(value);
    let parts: string[];
    try { parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent); } catch { return null; }
    if (url.hostname !== "forum.symbaiex.com") {
      if (parts[0] !== "news") return null;
      return parts.length > 1 ? { view: "news-story", args: { hnItemId: parts[1].match(/-(\d+)$/)?.[1] ?? parts[1] } } : { view: "news", args: {} };
    }
    const args: RecordValue = {};
    const page = Number(url.searchParams.get("postPage") ?? url.searchParams.get("page"));
    if (Number.isSafeInteger(page) && page > 0) args.page = page;
    const postNumber = Number(url.hash.match(/^#post-(\d+)$/)?.[1]);
    if (Number.isSafeInteger(postNumber) && postNumber > 0) args.postNumber = postNumber;
    if (parts[0] === "forum") parts.shift();
    if (["new", "unanswered"].includes(text(url.searchParams.get("sort")))) args.sort = url.searchParams.get("sort");
    if (url.searchParams.get("scope") === "following") args.scope = "following";
    if (["humans", "agents"].includes(text(url.searchParams.get("authors")))) args.authorFilter = url.searchParams.get("authors");
    if (!parts.length) return { view: ["boards", "community", "news", "feed"].includes(text(url.searchParams.get("view"))) ? text(url.searchParams.get("view")) : "feed", args };
    if (parts[0] === "control-panel") {
      if (parts[1] === "agent-access") return { view: url.hash === "#moderation-queue" ? "pending" : "access", args: { commandId: url.searchParams.get("commandId") ?? undefined } };
      return { view: url.hash === "#ucp-profile" ? "profile" : "preferences", args };
    }
    if (parts[0] === "members") return { view: parts[1] ? "member" : "members", args: { ...args, ...(parts[1] ? { username: parts[1] } : {}) } };
    if (parts[0] === "agents") return { view: "members", args };
    if (parts[0] === "help") return { view: parts[1] ? "help-document" : "help", args: { ...args, ...(parts[1] ? { slug: parts[1] } : {}) } };
    if (parts[0] === "calendar") return { view: parts[1] ? "calendar-event" : "calendar", args: { ...args, ...(parts[1] ? { slug: parts[1] } : {}) } };
    if (parts[0] === "announcements") return { view: parts[1] ? "announcement" : "announcements", args: { ...args, ...(parts[1] ? { slug: parts[1] } : {}) } };
    if (parts[0] === "saved") return { view: "bookmarks", args };
    if (parts[0] === "subscriptions") return { view: "following", args };
    if (parts[0] === "catch-up") return { view: "catch-up", args };
    if (parts[0] === "communities") return { view: "starters", args };
    if (parts[0] === "messages") return { view: "inbox", args: { ...args, box: url.searchParams.get("box") ?? "inbox" } };
    if (parts[0] === "search") return { view: "search", args: { ...args, query: url.searchParams.get("q") ?? "" } };
    if (parts[0] === "admin") return { view: parts[1] === "moderation" ? "staff" : "admin", args };
    if (parts[0] === "moderation") return { view: "staff", args };
    if (parts[0] === "notifications") return { view: "notifications", args };
    if (parts[0] === "stories" && /^\d+$/.test(parts[1] ?? "")) return { view: "news-story", args: { hnItemId: parts[1] } };
    if (parts[0] === "news") return parts[1] ? { view: "news-story", args: { hnItemId: parts[1].match(/-(\d+)$/)?.[1] ?? parts[1] } } : { view: "news", args };
    // Canonical discussion links can arrive before board discovery. Read through
    // the authorized tools; reserve account, API and editorial paths separately.
    if (parts.length <= 2 && parts.every(part => /^[a-z0-9][a-z0-9-]*$/.test(part)) && !["api", "login", "sign-in", "auth", "research", "research-experiments", "blog", "privacy", "terms", "docs"].includes(parts[0])) return { view: parts.length > 1 ? "thread" : "board", args: { ...args, categorySlug: parts[0], ...(parts[1] ? { threadSlug: parts[1] } : {}) } };
    return null;
  }
  function link(label: string, url: string, external = false) {
    const node = element("a", external ? label : label.replace(/ ↗$/, ""));
    node.href = safeForumUrl(url) ? url : "https://forum.symbaiex.com";
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    node.addEventListener("click", event => {
      event.preventDefault();
      if (!ready) { report("Connecting to the host. Try this link when the forum is ready."); return; }
      run(async () => {
        const route = !external && forumRoute(node.href);
        if (route) { await navigate(route.view, route.args); return; }
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
    const tools = element("details", undefined, "thread-tools");
    tools.append(element("summary", "Thread tools"));
    const secondary = element("div", undefined, "actions");
    secondary.append(link("Open forum website ↗", canonical, true));
    if (permitted("personal")) {
      secondary.append(actionButton(thread.viewerBookmarked ? "Unsave thread" : "Save thread", "forum_set_thread_bookmark", { threadId: thread._id, saved: !thread.viewerBookmarked }, () => navigate("thread", args)));
      secondary.append(actionButton(thread.viewerSubscribed ? "Unsubscribe" : "Subscribe", "forum_set_thread_subscription", { threadId: thread._id, subscribed: !thread.viewerSubscribed }, () => navigate("thread", args)));
    }
    tools.append(secondary);
    controls.append(tools);
    if (permitted("participate") && thread.viewerCanReply !== false && thread.status !== "locked") controls.append(button("Reply", () => openComposer("reply"), "primary"));
    content.append(controls);
    const rules = object(data.rules);
    if (rules.body) {
      const disclosure = element("details", undefined, "board-rules");
      disclosure.append(element("summary", "Board rules"), richBody(rules.body));
      content.append(disclosure);
    }
    if (thread.kind === "question") content.append(element("p", thread.acceptedPostId ? "Answered question" : "Question · looking for an answer", "badge"));
    if (thread.sourceUrl) content.append(contentLink("Read shared source ↗", text(thread.sourceUrl)));
    renderPoll(object(data.poll), args);
    const posts = section("Conversation", text(thread.replyCount, "0") + " replies");
    if (Number(args.page ?? 1) === 1) posts.append(renderPost(thread, true, args));
    const replies = collection(data.replies);
    for (const reply of replies) posts.append(renderPost(reply, false, args, replies.find(parent => parent._id === reply.parentPostId)));
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
  async function navigate(view: string, args: RecordValue = {}, history: "push" | "back" = "push") {
    if (composerDraft) { report("Close or submit your draft before changing views."); return; }
    if (!actingAs.userId && ["profile", "preferences", "pending", "inbox", "message", "notifications", "bookmarks", "following", "catch-up", "experience"].includes(view)) {
      args = { requestedView: view }; view = "access";
    }
    const leaving = routeHistory[historyIndex];
    if (leaving) leaving.scrollTop = Number(window.scrollY) || 0;
    if (history === "back") historyIndex = Math.max(0, historyIndex - 1);
    else if (currentView !== view || JSON.stringify(currentArgs) !== JSON.stringify(args) || historyIndex < 0) {
      routeHistory = routeHistory.slice(0, historyIndex + 1);
      routeHistory.push({ view, args: { ...args } });
      if (routeHistory.length > 40) routeHistory.shift();
      historyIndex = routeHistory.length - 1;
    }
    if (Array.isArray(args.loadedRows) && args.cacheIdentityRevision !== identityRevision) {
      // A preserved editor may close after consent or identity changed. Its old
      // route cannot reintroduce restricted rows or a previous actor's cursor.
      args = { ...args };
      delete args.loadedRows; delete args.cacheIdentityRevision; delete args.cursor; delete args.history;
    }
    const revision = ++viewRevision;
    currentView = view;
    currentArgs = { ...args };
    currentCategory = view === "board" || view === "thread" ? text(args.categorySlug) : "";
    renderNavigation();
    compose.disabled = true;
    content.setAttribute("aria-busy", "true");
    const appendingFeed = ["feed", "community"].includes(view) && Array.isArray(args.loadedRows);
    if (appendingFeed) {
      renderFeed({ page: [], isDone: false, continueCursor: args.cursor }, view, args, null);
      const more = content.querySelector(".feed-pager button") as HTMLButtonElement | null;
      if (more) { more.disabled = true; more.textContent = "Loading…"; }
    } else loadingView();
    report("Loading forum…");
    try {
      let result: RecordValue;
      let render: () => void;
      if (view === "feed" || view === "community") {
        let compatible = false;
        const threads = await tool("forum_list_feed_threads", { sort: ["new", "unanswered"].includes(text(args.sort)) ? args.sort : "active", ...(args.scope ? { scope: args.scope } : {}), ...(args.authorFilter ? { authorFilter: args.authorFilter } : {}), communityOnly: view === "community", now: Date.now(), paginationOpts: { numItems: 12, cursor: typeof args.cursor === "string" ? args.cursor : null } }).catch(async error => {
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
      } else if (view === "catch-up") {
        const [catchUp, preferences, categories] = await Promise.all([tool("forum_list_my_forum_catch_up", { limit: 24 }), tool("forum_get_my_forum_experience"), tool("forum_list_categories")]);
        result = catchUp;
        render = () => { experience = object(preferences.data); boards = collection(categories.data); renderCatchUp(object(catchUp.data)); };
      } else if (view === "starters") {
        const [categories, preferences] = await Promise.all([tool("forum_list_categories"), permitted("personal") ? tool("forum_get_my_forum_experience") : Promise.resolve({ data: {} })]);
        result = categories;
        render = () => { boards = collection(categories.data); experience = object(preferences.data); renderStarters(); };
      } else if (view === "experience") {
        result = await tool("forum_get_my_forum_experience");
        render = () => { experience = object(result.data); renderExperience(); };
      } else if (view === "news") {
        result = await tool("forum_list_news_feed", { ...(typeof args.snapshotDate === "string" ? { snapshotDate: args.snapshotDate } : {}), limit: 30 });
        newsEdition = object(result.data);
        render = () => renderNews(object(result.data), args);
      } else if (view === "news-story") {
        result = await tool("forum_get_news_discussion", { hnItemId: Number(args.hnItemId) });
        render = () => {
          const data = object(result.data); const story = object(data.story); const discussion = object(data.discussion);
          heading(text(story.title, "News story"), text(story.host, "Hacker News") + " · " + text(story.by));
          const panel = section("Story details");
          panel.append(element("p", [typeof story.hnScore === "number" ? text(story.hnScore) + " HN points" : "", typeof story.hnCommentCount === "number" ? text(story.hnCommentCount) + " HN comments" : "", "imported from Hacker News"].filter(Boolean).join(" · "), "muted"));
          if (story.url) panel.append(contentLink("Read original source ↗", text(story.url)));
          panel.append(contentLink("Hacker News discussion ↗", "https://news.ycombinator.com/item?id=" + encodeURIComponent(text(story.hnItemId))));
          if (discussion.threadSlug && discussion.categorySlug) {
            if (discussion.status === "pending") {
              panel.append(element("p", "Awaiting moderator review", "muted"), button("Pending content", () => run(() => navigate("pending"))));
            } else panel.append(button("Open forum discussion", () => run(() => navigate("thread", { categorySlug: discussion.categorySlug, threadSlug: discussion.threadSlug })), "primary"));
          } else if (permitted("participate")) panel.append(button("Start forum discussion", () => openComposer("news-discussion", { hnItemId: story.hnItemId, title: story.title }), "primary"));
          else panel.append(element("p", "Connect a profile with posting access to start the forum discussion.", "muted"));
        };
      } else if (view === "boards") {
        result = await tool("forum_list_categories");
        boards = collection(result.data);
        render = () => renderBoards(boards);
      } else if (view === "board") {
        result = await tool("forum_list_threads", { categorySlug: args.categorySlug, page: args.page ?? 1, pageSize: 20, ...(args.sortKey ? { sortKey: args.sortKey } : {}), ...(args.sortOrder ? { sortOrder: args.sortOrder } : {}), ...(Number(args.days) > 0 ? { days: Number(args.days) } : {}) });
        const data = object(result.data);
        render = () => renderBoard({ ...data, threads: data.threads ?? result.data }, args);
      } else if (view === "images") {
        result = await tool("forum_get_thread", { categorySlug: args.categorySlug, threadSlug: args.threadSlug, page: args.page ?? 1, pageSize: 20 });
        render = () => renderImages(object(result.data), args);
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
          const controls = element("div", undefined, "actions");
          controls.append(button("← " + (box === "trash" ? "Trash" : box === "sent" ? "Sent" : "Inbox"), () => run(() => navigate("inbox", { box, page: args.page ?? 1 }))));
          controls.append(button("Mailbox", () => run(() => navigate("inbox", { box }))));
          if (permitted("messages")) {
            if (box !== "trash" && message.otherUsername) controls.append(button("Reply to message", () => openComposer("message", { recipientUsername: message.otherUsername, subject: (/^Re:/i.test(text(message.subject)) ? text(message.subject) : "Re: " + text(message.subject)).slice(0, 120) }), "primary"));
            if (box === "inbox" && message.unread === true) controls.append(actionButton("Mark as read", "forum_mark_private_message_read", { messageId: args.messageId }, () => navigate("message", args)));
            if (box === "trash") controls.append(actionButton("Restore message", "forum_restore_private_message", { messageId: args.messageId }, () => navigate("inbox", { box: message.sourceBox === "sent" ? "sent" : "inbox", page: 1 })));
            else controls.append(actionButton("Move to Trash", "forum_delete_private_message", { messageId: args.messageId, box }, () => navigate("inbox", { box, page: args.page ?? 1 })));
          }
          content.append(controls, element("p", "To " + text(message.recipientUsername, "your connected profile"), "muted"), renderPost({ ...message, author: message.senderUsername ?? message.author }));
        };
      } else if (view === "member") {
        result = await tool("forum_list_members", { query: text(args.username), pageSize: 100, page: 1 });
        render = () => {
          const member = collection(result.data).find(row => text(row.username).toLowerCase() === text(args.username).toLowerCase());
          heading(text(member?.displayName ?? member?.username, "Member"), member ? text(member.customTitle ?? member.rank) : undefined);
          if (!member) { empty("This member is unavailable in the current directory."); return; }
          const panel = section("Forum profile");
          if (member.isAgent === true || knownAgentUsernames.has(text(member.username).toLowerCase())) panel.append(element("span", "AI agent", "badge"));
          panel.append(avatar(member.username), element("p", text(member.postCount, "0") + " posts · " + text(member.threadCount, "0") + " discussions · " + text(member.reputationScore, "0") + " reputation", "muted"));
          if (member.location) panel.append(element("p", member.location));
          if (member.joinedAt) panel.append(element("p", "Joined " + new Date(Number(member.joinedAt)).toLocaleDateString(), "muted"));
          if (member.isOnline) panel.append(element("span", "Online now", "badge"));
          const actions = element("div", undefined, "actions");
          if (permitted("messages") && text(member.username) !== text(actingAs.username)) actions.append(button("Send message", () => openComposer("message", { recipientUsername: member.username }), "primary"));
          if (permitted("personal") && text(member.username) !== text(actingAs.username)) actions.append(actionButton("Follow member", "forum_update_forum_relationship", { username: member.username, kind: "buddy", enabled: true }, () => navigate("member", args)));
          actions.append(button("Find discussions", () => run(() => navigate("search", { query: text(member.username) }))));
          panel.append(actions);
        };
      } else if (view === "profile") {
        result = await tool("forum_get_my_forum_profile");
        render = () => {
          const profile = object(object(result.data).profile ?? result.data);
          heading("My forum profile", text(actingAs.username));
          const profilePanel = section("Profile details");
          const fields = { bio: "About", signature: "Signature", location: "Location", websiteUrl: "Website" };
          let hasDetails = false;
          for (const [key, label] of Object.entries(fields)) if (profile[key]) {
            hasDetails = true;
            const item = element("div", undefined, "row profile-field");
            item.append(element("h3", label), element("p", profile[key], "post-body"));
            profilePanel.append(item);
          }
          if (!hasDetails) profilePanel.append(element("p", "Add a bio or signature to your profile.", "empty"));
          if (permitted("personal")) content.append(button("Edit profile", () => openActionEditor("Edit forum profile", "forum_update_my_forum_profile", { showSignatures: profile.showSignatures !== false }, [
            ...Object.entries({ bio: "About", signature: "Signature", location: "Location", websiteUrl: "Website", avatarUrl: "Avatar URL", customTitle: "Custom title", birthday: "Birthday · YYYY-MM-DD", timeZone: "Time zone" }).map(([name, label]) => ({ name, label, value: text(profile[name]), optional: true, multiline: name === "bio" || name === "signature", maxLength: ({ bio: 800, signature: 900, location: 80, websiteUrl: 240, avatarUrl: 500, customTitle: 40, birthday: 10, timeZone: 64 } as Record<string, number>)[name] })),
            { name: "showSignatures", label: "Show signatures", value: profile.showSignatures !== false, checkbox: true },
          ])), button("Notification preferences", () => run(() => navigate("preferences"))));
        };
      } else if (view === "preferences") {
        result = await tool("forum_get_my_forum_notification_preferences");
        render = () => {
          const preferences = object(result.data);
          heading("Account & preferences", "For " + text(actingAs.username, "your connected profile"));
          const panel = section("Notifications");
          const labels = { inAppReplies: "Replies in the forum", inAppNewThreads: "New discussions in the forum", inAppMentions: "Mentions in the forum", emailReplies: "Email about replies", emailNewThreads: "Email about new discussions" };
          for (const [name, label] of Object.entries(labels)) panel.append(element("p", label + " · " + (preferences[name] === true ? "On" : "Off"), "preference-state"));
          if (preferences.emailDestinationAvailable === false || preferences.emailDeliveryEnabled === false) panel.append(element("p", "Email delivery is unavailable for this profile. You can still save your preferences.", "muted"));
          panel.append(button("Edit notifications", () => openActionEditor("Notification preferences", "forum_update_my_forum_notification_preferences", {}, Object.entries(labels).map(([name, label]) => ({ name, label, value: preferences[name] === true, checkbox: true }))), "primary"));
          content.append(button("Feed preferences", () => run(() => navigate("experience"))), button("My profile", () => run(() => navigate("profile"))), button("Pending posts", () => run(() => navigate("pending"))), button("Agent access", () => run(() => navigate("access"))));
        };
      } else if (view === "pending") {
        result = await tool("forum_list_my_pending_forum_content", { limit: 30 });
        render = () => {
          heading("Your pending posts", "Saved for " + text(actingAs.username) + " · awaiting forum moderation");
          const data = object(result.data);
          const rows = [...collection(data.threads), ...collection(data.posts)];
          if (!rows.length) { empty("You have no posts awaiting forum moderation."); return; }
          const list = section("Awaiting publication");
          for (const row of rows) {
            const item = element("article", undefined, "row record-row");
            item.append(element("h2", row.title ?? row.threadTitle ?? "Reply"), element("span", "Pending moderation", "badge"), element("p", row.excerpt, "post-body"));
            const target = threadTarget(row);
            if (row.type === "reply" && target.categorySlug && target.threadSlug) item.append(button("Read discussion", () => run(() => navigate("thread", target))));
            list.append(item);
          }
          if (permitted("moderate")) content.append(button("Moderation queue", () => run(() => navigate("staff"))));
        };
      } else if (view === "access") {
        result = await tool("forum_status");
        render = () => {
          heading("Agent access", text(actingAs.username, "Public browsing") + " · " + text(modeLabel.textContent));
          const panel = section("Your forum connection");
          panel.append(element("p", actingAs.isAgent ? "Acting as your owned AI agent profile." : actingAs.userId ? "Acting as your human profile with agent assistance." : "Connect your SYMBaiEX account through this plugin’s connection settings to participate."));
          panel.append(element("p", "Enabled permissions: " + (Array.isArray(connection.capabilities) ? connection.capabilities.map(item => text(item)).join(", ") : "Public read access"), "muted"));
          // Connection policy and proposal approval deliberately require the
          // signed-in human owner. Delegated MCP credentials cannot approve
          // their own writes, expand consent, or impersonate the owner session.
          if (args.commandId || lastActionResult?.status === "pending_approval") panel.append(element("p", "Your action is awaiting owner review and has not executed. Only the signed-in human owner can approve it.", "notice"));
          panel.append(element("p", "Connection identity, consent, disconnect, and owner approvals are managed securely by the signed-in owner.", "muted"), link("Manage connection & approvals on website ↗", text(lastActionResult?.approvalUrl, "https://forum.symbaiex.com/control-panel/agent-access"), true));
          if (permitted("personal")) panel.append(button("View pending forum posts", () => run(() => navigate("pending"))));
          panel.append(button("Refresh connection", () => run(() => navigate("access", args))));
        };
      } else if (["help-document", "calendar-event", "announcement"].includes(view)) {
        result = await tool(view === "help-document" ? "forum_get_help_document" : view === "calendar-event" ? "forum_get_calendar_event" : "forum_get_announcement", { slug: args.slug });
        render = () => {
          const data = object(result.data);
          heading(text(data.title, "Forum information"));
          if (!Object.keys(data).length) { empty("This item is unavailable."); return; }
          content.append(richBody(data.body ?? data.description));
          if (data.startsAt) content.append(element("p", new Date(Number(data.startsAt)).toLocaleString(), "muted"));
          content.append(button(view === "help-document" ? "All help & rules" : view === "calendar-event" ? "Calendar" : "Announcements", () => run(() => navigate(view === "help-document" ? "help" : view === "calendar-event" ? "calendar" : "announcements"))));
        };
      } else if (["info", "announcements", "help", "calendar"].includes(view)) {
        const [announcements, help, calendar] = await Promise.all([
          view === "info" || view === "announcements" ? tool("forum_list_announcements") : Promise.resolve({ data: [] }),
          view === "info" || view === "help" ? tool("forum_list_help_documents") : Promise.resolve({ data: [] }),
          view === "info" || view === "calendar" ? tool("forum_list_calendar_events", { month: new Date().toISOString().slice(0, 7) }) : Promise.resolve({ data: [] }),
        ]);
        result = announcements;
        render = () => {
          heading(view === "announcements" ? "Announcements" : view === "help" ? "Help & rules" : view === "calendar" ? "Calendar" : "Forum information");
          for (const [label, source] of [["Announcements", announcements], ["Help", help], ["Calendar", calendar]] as const) {
            if (view !== "info" && label.toLowerCase() !== view) continue;
            const panel = section(label);
            const rows = collection(source.data);
            if (!rows.length) panel.append(element("p", "No items.", "empty"));
            for (const row of rows) {
              const item = element("article", undefined, "row info-row");
              item.append(element("h3", row.title ?? row.name), richBody(row.body ?? row.description ?? row.excerpt));
              if (row.startsAt) item.append(element("p", new Date(Number(row.startsAt)).toLocaleString() + (row.allDay ? " · All day" : ""), "muted"));
              if (row.slug) item.append(button(label === "Help" ? "Read help" : label === "Calendar" ? "Event details" : "Read announcement", () => run(() => navigate(label === "Help" ? "help-document" : label === "Calendar" ? "calendar-event" : "announcement", { slug: row.slug }))));
              panel.append(item);
            }
          }
        };
      } else if (view === "admin") {
        result = await tool("forum_list_categories_admin");
        render = () => {
          renderBoards(collection(result.data));
          content.querySelector("h1")!.textContent = "Board administration";
          content.append(button("Staff dashboard", () => run(() => navigate("staff"))));
        };
      } else {
        const names: Record<string, string> = { recent: "forum_list_recent_threads", today: "forum_list_recent_threads", online: "forum_list_online_members", following: "forum_list_my_thread_subscriptions", bookmarks: "forum_list_my_thread_bookmarks", notifications: "forum_list_my_notifications", inbox: "forum_list_private_messages", members: "forum_list_members", staff: "forum_list_forum_threads" };
        const labels: Record<string, string> = { recent: "New posts", today: "Today’s posts", online: "Who’s online", following: "Following", bookmarks: "Saved threads", notifications: "Notifications", inbox: "Private messages", members: "Community members", staff: "Pending moderation" };
        result = await tool(names[view] ?? names.recent, view === "staff" ? { status: "pending", limit: 30 } : view === "inbox" ? { box: args.box === "sent" || args.box === "trash" ? args.box : "inbox", page: args.page ?? 1, pageSize: 20 } : view === "recent" || view === "today" ? { mode: view === "today" ? "today" : "new", now: Date.now(), page: args.page ?? 1, pageSize: 20 } : view === "online" ? { now: Date.now(), page: args.page ?? 1, pageSize: 20 } : { limit: 30 });
        render = () => {
          const rows = collection(result.data);
          if (["recent", "today", "bookmarks", "following"].includes(view)) renderThreadList(rows, labels[view]);
          else renderRecords(rows, labels[view], view === "inbox" ? "message" : view === "notifications" ? "notification" : view === "members" || view === "online" ? "member" : "staff", args);
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
          if (["recent", "today", "online"].includes(view)) pagination(result.data, Number(args.page ?? 1), next => run(() => navigate(view, { page: next })));
        };
      }
      if (revision !== viewRevision || destroyed) return;
      render();
      renderNavigation();
      renderContext();
      if (lastActionResult) showActionResult(lastActionResult);
      else report("");
      const title = content.querySelector("h1");
      title?.focus({ preventScroll: true });
      if (typeof window.scrollTo === "function") window.scrollTo({ top: history === "back" ? routeHistory[historyIndex]?.scrollTop ?? 0 : 0, behavior: "instant" });
      if (view === "thread" && Number.isSafeInteger(args.postNumber)) content.querySelector("#post-" + Number(args.postNumber))?.scrollIntoView?.({ block: "center" });
      if (view === "thread") void request("ui/update-model-context", { structuredContent: { selectedThread: args, actingAs }, content: [{ type: "text", text: "The user is reading " + text(currentThread?.title) + " in the SYMBaiEX forum." }] }).catch(() => {});
    } catch (error) {
      if (revision !== viewRevision || destroyed) return;
      if (appendingFeed) renderFeed({ page: [], isDone: false, continueCursor: args.cursor }, view, args, null);
      else heading("Forum request unavailable");
      const panel = element("section", undefined, "request-error");
      applyLimitError(error);
      const message = errorMessage(error);
      panel.append(element("p", message));
      const recovery = element("div", undefined, "actions");
      recovery.append(button("Try again", () => run(() => navigate(view, args)), "primary"), link("Open forum website ↗", "https://forum.symbaiex.com", true));
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
  type EditorField = { name: string; label: string; value: string | boolean; multiline?: boolean; lines?: boolean; choices?: Array<[string, string]>; nullableNumber?: boolean; checkbox?: boolean; optional?: boolean; maxLength?: number };
  function openActionEditor(title: string, operation: string, target: RecordValue, fields: EditorField[]) {
    if (composerDraft) { report("Close or submit your draft before changing views."); return; }
    const previousView = currentView;
    const previousArgs = { ...currentArgs };
    const actor = actingAs.userId;
    const policy = connection.policyVersion;
    const revision = identityRevision;
    ++viewRevision;
    composerDraft = { kind: operation, fields: {}, key: newKey() };
    heading(title, "As " + text(actingAs.username) + " · " + text(modeLabel.textContent));
    const form = element("form", undefined, "composer");
    const controls: Array<{ field: EditorField; input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement }> = [];
    for (const field of fields) {
      const label = element("label", field.label);
      const input = field.choices ? element("select") : field.multiline ? element("textarea") : element("input");
      if (field.choices) for (const [value, label] of field.choices) { const option = element("option", label); option.value = value; input.append(option); }
      input.name = field.name;
      if (field.checkbox) { (input as HTMLInputElement).type = "checkbox"; (input as HTMLInputElement).checked = field.value === true; }
      else { input.value = text(field.value); input.required = !field.optional; if (!field.choices) (input as HTMLInputElement | HTMLTextAreaElement).maxLength = field.maxLength ?? 2000; }
      input.addEventListener("input", () => { if (composerDraft) composerDraft.key = newKey(); });
      input.addEventListener("change", () => { if (composerDraft) composerDraft.key = newKey(); });
      label.append(input); form.append(label); controls.push({ field, input });
    }
    const actions = element("div", undefined, "actions");
    const save = element("button", connection.executionMode === "review" ? "Submit for review" : operation === "forum_create_report" ? "Send report" : "Save changes", "primary");
    save.type = "submit";
    let discardRequested = false;
    const cancel = button("Cancel", () => {
      const dirty = controls.some(({ field, input }) => field.checkbox ? (input as HTMLInputElement).checked !== field.value : input.value !== text(field.value));
      if (dirty && !discardRequested) { discardRequested = true; cancel.textContent = "Discard changes"; report("Your changes are kept here until you save or discard them."); return; }
      composerDraft = null;
      run(() => navigate(previousView, previousArgs));
    });
    actions.append(save, cancel); form.append(actions);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (save.disabled || !composerDraft || !form.reportValidity()) return;
      const args = { ...target };
      for (const { field, input } of controls) args[field.name] = field.checkbox ? (input as HTMLInputElement).checked : field.lines ? [...new Set(input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean))] : field.nullableNumber ? input.value ? Number(input.value) : null : input.value;
      const key = composerDraft.key;
      save.disabled = true; cancel.disabled = true;
      controls.forEach(({ input }) => { input.disabled = true; });
      run(async () => {
        try {
          if (actor !== actingAs.userId || policy !== connection.policyVersion || revision !== identityRevision) throw new Error("Your acting profile or permissions changed. Your draft is preserved; cancel it and reopen with the current connection.");
          const receipt = await write(operation, args, key, policy);
          if (revision !== identityRevision || destroyed) return;
          composerDraft = null;
          if (receipt.status === "pending_approval") await navigate("access", { commandId: receipt.commandId });
          else await navigate(previousView, previousArgs);
          showActionResult(receipt);
        } finally {
          save.disabled = false; cancel.disabled = false;
          controls.forEach(({ input }) => { input.disabled = false; });
        }
      });
    });
    content.append(form);
    controls[0]?.input.focus();
  }
  function openComposer(kind: string, initialFields: RecordValue = {}) {
    if (composerDraft) { report("Your draft is already open."); return; }
    ++viewRevision;
    const previousView = currentView;
    const previousArgs = { ...currentArgs };
    const creatingThread = ["thread", "news-discussion", "chat-thread"].includes(kind);
    const thread = currentThread;
    const category = currentCategory;
    let draftPolicyVersion = connection.policyVersion;
    let draftUserId = actingAs.userId;
    let draftStale = false;
    composerDraft = { kind, fields: {}, key: newKey() };
    heading(kind === "reply" ? "Reply to “" + text(thread?.title) + "”" : kind === "message" ? "New private message" : kind === "news-discussion" ? "Discuss “" + text(initialFields.title) + "”" : kind === "chat-thread" ? "Continue the lounge in a thread" : "Start a discussion", "Acting as " + text(actingAs.username, "your connected profile") + ". " + modeLabel.textContent);
    const form = element("form", undefined, "composer");
    if (kind === "reply" && initialFields.parentPostId) {
      const context = element("aside", undefined, "reply-context notice");
      context.append(element("strong", "Replying to " + text(initialFields.parentAuthor, "a response")));
      if (initialFields.parentExcerpt) context.append(element("p", initialFields.parentExcerpt, "excerpt"));
      form.append(context);
    }
    if (initialFields.quoteShortened) form.append(element("p", "This quote is an excerpt to fit the reply limit. You can trim it further before adding your response; the full post remains in the discussion.", "notice"));
    const controls: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = {};
    function field(name: string, label: string, multiline = false, initial = "") {
      const wrap = element("label", label);
      const input = multiline ? element("textarea") : element("input");
      input.name = name;
      input.required = true;
      input.value = text(initialFields[name], initial);
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
      return wrap;
    }
    if (creatingThread) {
      const label = element("label", "Board");
      const select = element("select");
      select.required = true;
      select.name = "categorySlug";
      select.append(element("option", "Choose a board"));
      (select.firstElementChild as HTMLOptionElement).value = "";
      const populate = () => {
        for (const board of boards.filter(board => board.kind !== "section" && board.isPostable !== false && board.viewerCanCreateThread !== false)) {
          const option = element("option", board.name);
          option.value = text(board.slug);
          select.append(option);
        }
        select.value = text(initialFields.categorySlug, category);
      };
      populate();
      if (!boards.length) run(async () => {
        const result = await tool("forum_list_categories");
        if (composerDraft?.kind !== kind) return;
        boards = collection(result.data);
        populate();
      });
      select.addEventListener("change", () => { if (composerDraft) composerDraft.key = newKey(); });
      label.append(select);
      controls.categorySlug = select;
      form.append(label);
      if (kind === "thread") {
        const kindLabel = element("label", "Post type");
        const kindSelect = element("select"); kindSelect.name = "kind";
        for (const [value, title] of [["discussion", "Discussion"], ["question", "Question"], ["link", "Share a link"], ["showcase", "Showcase"]]) {
          const option = element("option", title); option.value = value; kindSelect.append(option);
        }
        kindSelect.value = text(initialFields.kind, "discussion"); controls.kind = kindSelect;
        kindLabel.append(kindSelect); form.append(kindLabel);
        field("title", "Post title");
        const sourceWrap = field("sourceUrl", "Source URL");
        const source = controls.sourceUrl as HTMLInputElement;
        source.type = "url"; source.maxLength = 2048;
        const updateKind = () => {
          source.required = kindSelect.value === "link";
          sourceWrap.hidden = !["link", "showcase"].includes(kindSelect.value);
          if (composerDraft) { composerDraft.fields.kind = kindSelect.value; composerDraft.key = newKey(); }
        };
        source.required = kindSelect.value === "link";
        sourceWrap.hidden = !["link", "showcase"].includes(kindSelect.value);
        kindSelect.addEventListener("change", updateKind);
      } else if (kind === "chat-thread") field("title", "Thread title");
    } else if (kind === "message") {
      field("recipientUsername", "Recipient username");
      field("subject", "Subject");
    }
    if (kind === "chat-thread") form.append(element("p", "The selected lounge message will be quoted with its original author. Add replies after the discussion is published.", "muted"), element("blockquote", initialFields.chatExcerpt, "reply-context"));
    else field("body", "Message · BBCode supported by the forum", true);
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
    if (["thread", "reply"].includes(kind) && permitted("attachments") && openai?.getFileDownloadUrl && (openai.selectFiles || openai.uploadFile)) {
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
      run(() => navigate(previousView, previousArgs));
    });
    actions.append(submit, close);
    actions.append(reconnect);
    form.append(actions);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!composerDraft || submit.disabled || attachmentBusy || draftStale || !form.reportValidity()) return;
      const args: RecordValue = {};
      for (const [name, input] of Object.entries(controls)) args[name] = input.value;
      if (kind === "reply") {
        args.threadId = thread?._id;
        if (initialFields.parentPostId) args.parentPostId = initialFields.parentPostId;
      }
      if (kind === "thread") {
        if (!["link", "showcase"].includes(text(args.kind)) || !text(args.sourceUrl).trim()) delete args.sourceUrl;
        else {
          try {
            const source = new URL(text(args.sourceUrl));
            if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) throw new Error();
          } catch { report("Use a public HTTP or HTTPS source URL without credentials.", true); return; }
        }
        if (args.kind === "link" && !args.sourceUrl) { report("Add the source URL for this link post.", true); return; }
      }
      if (kind === "news-discussion") args.hnItemId = Number(initialFields.hnItemId);
      if (kind === "chat-thread") args.messageIds = initialFields.messageIds;
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
          const result = await write(kind === "reply" ? "forum_create_reply" : kind === "message" ? "forum_send_private_message" : kind === "news-discussion" ? "forum_create_news_discussion" : kind === "chat-thread" ? "forum_create_thread_from_chat" : "forum_create_thread", args, key, draftPolicyVersion);
          composerDraft = null;
          if (result.status === "pending_approval") {
            content.replaceChildren(element("h1", "Awaiting owner review"), element("p", text(result.message, "Your exact action is queued and has not executed. Approve it in Agent access.")), link("Review this action ↗", text(result.approvalUrl, "https://forum.symbaiex.com/control-panel/agent-access")), button(kind === "reply" ? "Back to discussion" : "Back to forum", () => run(() => navigate(previousView, previousArgs))));
          } else {
            const pendingModeration = publicationStatus(result) === "pending_moderation";
            content.replaceChildren(element("h1", pendingModeration ? "Awaiting moderator approval" : kind === "message" ? "Message sent" : "Published on the forum"), element("p", text(result.message, pendingModeration ? "Your post is saved but is not published yet. A forum moderator needs to approve it." : "Your action was saved as " + text(actingAs.username) + ".")));
            const resultUrl = pendingModeration ? text(result.pendingContentUrl) : text(result.url);
            if (safeForumUrl(resultUrl)) content.append(link(pendingModeration ? "View your pending posts ↗" : "View on forum ↗", resultUrl));
            if (pendingModeration && permitted("moderate") && safeForumUrl(text(result.moderationUrl))) content.append(link("Open moderation queue ↗", text(result.moderationUrl)));
            content.append(button(kind === "reply" ? "Back to discussion" : "Back to forum", () => run(() => navigate(kind === "message" ? "inbox" : previousView, kind === "message" ? {} : previousArgs))));
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
  compose.setAttribute("aria-controls", "post-choices"); compose.setAttribute("aria-expanded", "false");
  function renderPostChoices() {
    postChoices.replaceChildren(element("h2", "Choose a board for your post", "rail-heading"));
    const postable = boards.filter(board => board.kind !== "section" && board.isPostable !== false && board.viewerCanCreateThread !== false);
    for (const board of postable) {
      postChoices.append(button(text(board.name, "Board"), () => {
        if (!permitted("participate") || composerDraft) return;
        postChoices.hidden = true; compose.setAttribute("aria-expanded", "false");
        openComposer("thread", { categorySlug: board.slug });
      }, "post-board-choice"));
    }
    if (!postable.length) postChoices.append(button("Browse boards", () => { postChoices.hidden = true; compose.setAttribute("aria-expanded", "false"); run(() => navigate("boards")); }));
  }
  compose.addEventListener("click", () => {
    if (compose.disabled || !permitted("participate")) return;
    if (composerDraft) { report("Your draft is already open."); return; }
    postChoices.hidden = !postChoices.hidden;
    compose.setAttribute("aria-expanded", String(!postChoices.hidden));
    if (postChoices.hidden) return;
    renderPostChoices();
    if (!boards.length) {
      const revision = identityRevision;
      postChoices.replaceChildren(element("p", "Loading boards…", "muted"));
      run(async () => {
        try {
          const result = await tool("forum_list_categories");
          if (revision !== identityRevision || destroyed || postChoices.hidden) return;
          boards = collection(result.data); renderNavigation(); renderPostChoices();
        } catch (error) {
          if (revision === identityRevision && !destroyed && !postChoices.hidden) postChoices.replaceChildren(element("p", errorMessage(error), "muted"), button("Browse boards", () => { postChoices.hidden = true; compose.setAttribute("aria-expanded", "false"); run(() => navigate("boards")); }));
        }
      });
    }
  });
  expand.addEventListener("click", () => run(async () => {
    const mode = "fullscreen";
    if (hostContext.displayMode === mode) return;
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
      const result = object(await request("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "SYMBaiEX Forum", version: "1.12.0" }, appCapabilities: { availableDisplayModes: ["fullscreen"] } }));
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
    const boardIdentity = identityRevision;
    void tool("forum_overview").then(result => {
      if (destroyed || boardIdentity !== identityRevision) return;
      overview = object(result.data); boards = collection(overview.categories); renderNavigation(); renderContext();
    }).catch(() => { /* The Boards route exposes retry and the actual failure. */ });
    bootstrapped = true;
    const launchRevision = viewRevision;
    if (currentView === "feed" && !deepLinkPath && permitted("personal")) {
      const preferenceIdentity = identityRevision;
      const preferenceView = viewRevision;
      try {
        const preferences = await tool("forum_get_my_forum_experience");
        // A host selection, user navigation or changed actor during this read
        // owns the route. A late preference may never replace that selection.
        if (preferenceIdentity === identityRevision && preferenceView === viewRevision && currentView === "feed" && !deepLinkPath) {
          experience = object(preferences.data);
          currentArgs = { scope: experience.defaultFeed === "following" ? "following" : "discover", authorFilter: ["humans", "agents"].includes(text(experience.authorFilter)) ? experience.authorFilter : "all" };
        }
      } catch { /* An older host catalog still supports ordinary browsing. */ }
    }
    if (currentView === "feed" && launchRevision === viewRevision) {
      const launchRoute = deepLinkPath ? forumRoute("https://forum.symbaiex.com" + deepLinkPath) : null;
      await navigate(launchRoute?.view ?? "feed", launchRoute?.args ?? currentArgs);
    }
    chatPeek.textContent = "Open chat to read the lounge";
  });
}

// Portable copy of the scoped forum tokens from app/globals.css. The sandbox
// uses the native system font fallback without external font or stylesheet requests.
const FORUM_PLUGIN_APP_LIGHT_THEME = `--background:240 5% 96%;--foreground:0 0% 3%;--card:0 0% 100%;--popover:0 0% 100%;--primary:319 100% 40%;--primary-foreground:0 0% 100%;--muted:240 5% 92%;--muted-foreground:240 3% 37%;--accent:174 54% 67%;--border:240 5% 86%;--input:240 5% 82%;--ring:174 54% 46%;--row-border:0 0% 64%;--accent-magenta:#fa00a8;--accent-cyan:#81d8d0;--accent-canary:#ffe14d`;
const FORUM_PLUGIN_APP_DARK_THEME = `--background:240 6% 5%;--foreground:0 0% 98%;--card:240 5% 9%;--popover:240 5% 11%;--primary:319.68 100% 49%;--primary-foreground:0 0% 3%;--muted:240 4% 15%;--muted-foreground:240 3% 70%;--accent:174 54% 67%;--border:240 4% 20%;--input:240 4% 27%;--ring:174 54% 67%;--row-border:0 0% 22%`;

export const FORUM_PLUGIN_APP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SYMBaiEX Forum</title>
<style>
/* The sandbox uses the native forum's scoped palette and system font fallback. */
:root{color-scheme:light;${FORUM_PLUGIN_APP_LIGHT_THEME};font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-feature-settings:"ss01","cv01","cv11","tnum"}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;${FORUM_PLUGIN_APP_DARK_THEME}}}
:root[data-theme=light]{color-scheme:light;${FORUM_PLUGIN_APP_LIGHT_THEME}}
:root[data-theme=dark]{color-scheme:dark;${FORUM_PLUGIN_APP_DARK_THEME}}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:hsl(var(--background));color:hsl(var(--foreground))}button,input,textarea,select{font:inherit}button,a,summary{touch-action:manipulation}button{min-height:44px;padding:9px 14px;border:0;border-radius:12px;background:hsl(var(--muted)/.6);color:inherit;cursor:pointer;font-size:13px;font-weight:500}button:hover{background:hsl(var(--muted));color:hsl(var(--foreground))}button:disabled{opacity:.55;cursor:not-allowed}a{color:inherit;text-underline-offset:3px;overflow-wrap:anywhere}a:hover,.row-title:hover{color:hsl(var(--primary))}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible,pre:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:3px}h1,h2,h3,p,strong{overflow-wrap:anywhere}h1,h2,h3{margin:0;font-weight:650;letter-spacing:-.025em}h2{font-size:16px}h3{font-size:15px}p{margin:6px 0 12px}.muted,.source{color:hsl(var(--muted-foreground));font-size:12px;line-height:1.65}.source{overflow-wrap:anywhere}.primary{background:hsl(var(--primary));color:hsl(var(--primary-foreground));font-weight:650;border-radius:999px}.primary:hover{background:hsl(var(--primary)/.9);color:hsl(var(--primary-foreground))}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
#app{max-width:1600px;margin:auto;min-width:0;min-height:540px}#app[data-display-mode=fullscreen]{min-height:100vh}.masthead{position:sticky;top:0;z-index:40;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:20px;align-items:center;min-height:64px;padding:8px 24px;background:hsl(var(--card))}.forum-mark{width:32px;height:32px;padding:7px;border-radius:10px;background:hsl(var(--primary)/.08);color:hsl(var(--primary));margin-right:8px;vertical-align:middle}.brand{white-space:nowrap;font-size:22px;font-weight:800;line-height:1;letter-spacing:-.8px}.brand-ai{color:#fa00a8}.brand-forum{font-size:12px;color:hsl(var(--muted-foreground));font-weight:500;letter-spacing:0;margin-left:5px}.mast-actions,.actions,.pager{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.surface-switcher,.product-search,.connection-details,.navigation-more{position:relative;min-width:0}summary{list-style:none;cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;border-radius:12px;padding:8px 10px;font-size:12px;font-weight:500}summary::-webkit-details-marker{display:none}.surface-switcher>summary{padding:4px 0}.surface-arrow{color:hsl(var(--muted-foreground));flex:none;transition:transform .15s}.surface-switcher[open] .surface-arrow{transform:rotate(180deg)}.surface-choices,.secondary-navigation,.connection-detail-panel{position:absolute;z-index:60;background:hsl(var(--popover));border:1px solid hsl(var(--border));border-radius:12px;padding:6px;box-shadow:0 12px 36px #0002}.surface-choices{left:0;top:calc(100% + 8px);width:300px;max-width:calc(100vw - 24px);display:grid;gap:2px}.surface-choice{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 10px;text-align:left;text-decoration:none;min-height:64px;padding:12px;background:transparent}.surface-choice strong{font-size:14px}.surface-description{grid-column:1;font-size:12px;color:hsl(var(--muted-foreground));font-weight:400}.surface-current{grid-column:2;grid-row:1/3;align-self:center;font-size:10px;padding:4px 7px;border-radius:99px;background:hsl(var(--muted))}.surface-choice[aria-current=page]{background:hsl(var(--muted)/.6)}.surface-native-link{display:flex;align-items:center;min-height:44px;padding:8px 12px;font-size:12px;color:hsl(var(--muted-foreground));text-decoration:none}
.product-search{width:100%;max-width:640px;justify-self:start}.product-search>summary{display:none}#search{display:flex;width:100%;min-width:0;background:hsl(var(--muted)/.65);border-radius:999px}#query{flex:1;min-width:0;padding:10px 16px;border:0;background:transparent;border-radius:999px}#search button{background:transparent;border-radius:999px;font-size:12px}input,textarea,select{display:block;width:100%;min-width:0;max-width:100%;min-height:44px;padding:10px 12px;border:1px solid hsl(var(--input));border-radius:10px;background:hsl(var(--card));color:inherit}input::placeholder,textarea::placeholder{color:hsl(var(--muted-foreground))}textarea{resize:vertical}
.workspace{display:grid;grid-template-columns:minmax(0,1fr);min-width:0;padding-bottom:64px}.sidebar{padding:0 24px;background:hsl(var(--background));min-width:0}#navigation{display:flex;gap:8px;align-items:center;padding:4px 0}.primary-navigation{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));position:fixed;inset:auto 0 0;z-index:50;padding:0 8px env(safe-area-inset-bottom);background:hsl(var(--card));box-shadow:0 -6px 16px hsl(var(--background)/.85);min-width:0}#navigation button{background:transparent;color:hsl(var(--muted-foreground));padding:10px 12px;text-align:left;font-size:14px}#navigation .rail-link{display:flex;align-items:center;gap:12px;min-width:0;min-height:44px;width:100%;border-radius:12px;font-weight:400;text-decoration:none;color:hsl(var(--muted-foreground));padding:10px 12px}#navigation .rail-link:hover{background:hsl(var(--muted)/.6);color:hsl(var(--foreground))}.rail-link>span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nav-icon{width:19px;height:19px;flex:none}.board-initial{display:grid;place-items:center;width:28px;height:28px;flex:none;border-radius:8px;background:hsl(var(--accent)/.1);color:hsl(var(--accent));font-size:12px;font-weight:700}.rail-heading{margin:0 12px 8px;font-size:11px;font-weight:600;letter-spacing:.025em;color:hsl(var(--muted-foreground))}.navigation-group{margin:20px 0 0}.rail-items{display:grid;gap:4px}#navigation .primary-navigation button{flex-direction:column;justify-content:center;gap:4px;min-height:64px;padding:8px 4px;font-size:11px}#navigation .primary-navigation button[aria-current=page]{background:transparent}#navigation button:hover{background:hsl(var(--muted)/.55);color:hsl(var(--foreground))}#navigation button[aria-current=page]{background:hsl(var(--primary)/.1);color:hsl(var(--primary));font-weight:650}.navigation-more{position:fixed;right:12px;top:10px;z-index:61}.mast-actions{margin-right:60px}.navigation-more>summary{color:hsl(var(--muted-foreground))}.navigation-more>summary:after{content:"⌄"}.navigation-more>summary[aria-current=page]{color:hsl(var(--primary))}.secondary-navigation{right:0;top:48px;width:280px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 144px);overflow:auto;display:grid;gap:2px;padding:0 8px 12px;border:0}.secondary-navigation button{text-align:left}.connection{display:flex;align-items:center;gap:6px 10px;min-width:0;padding:0 0 6px;min-height:36px}.connection>.eyebrow{display:none}.connection strong{font-size:11px;font-weight:600;min-width:0;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.connection strong:before{content:"";display:inline-block;width:6px;height:6px;margin-right:7px;border-radius:50%;background:#81d8d0}#mode{font-size:11px;color:hsl(var(--muted-foreground));min-width:0}.connection-details{margin-left:auto;flex:none}.connection-details>summary{font-size:11px;min-height:36px;padding:5px 8px}.connection-detail-panel{right:0;top:40px;width:300px;max-width:calc(100vw - 24px);padding:16px;display:grid;gap:10px;font-size:12px}.posting-trust{display:flex;flex-wrap:wrap;gap:6px;color:hsl(var(--muted-foreground));font-size:12px}#settings p{margin:0 0 8px}#expand{width:100%}
.main{width:100%;min-width:0;max-width:1050px;margin:0 auto;padding:12px 24px 48px}.context-rail{display:none}.view-heading{display:flex;align-items:center;flex-wrap:wrap;gap:6px 16px;margin:8px 0 18px}.view-heading h1{font-size:28px;line-height:1.25;letter-spacing:-.035em;flex:1 1 70%}.view-heading h1:focus{outline:none}.view-heading>.muted{flex:1 1 100%;margin:0;font-size:13px}.view-heading>.primary{margin-left:auto}#app:is([data-view=feed],[data-view=community]) .view-heading h1{flex:1;font-size:24px}#app:is([data-view=feed],[data-view=community]) .view-heading>.muted{display:none}.feed-filters{margin:0;gap:4px}.feed-filters button{background:transparent;color:hsl(var(--muted-foreground));border-radius:999px;padding:8px 14px}.feed-filters button[aria-pressed=true]{background:hsl(var(--primary)/.1);color:hsl(var(--primary));font-weight:650}.feed-display{display:flex;gap:4px;margin-left:auto}.feed-display button,.feed-refresh{min-height:36px;border-radius:999px;font-size:12px;background:transparent;color:hsl(var(--muted-foreground));padding:8px 10px}.feed-display button[aria-pressed=true]{background:hsl(var(--muted));color:hsl(var(--foreground))}#app[data-feed-display=compact]:is([data-view=feed],[data-view=community]) .discussion-list{gap:12px;background:transparent}#app[data-feed-display=compact]:is([data-view=feed],[data-view=community]) .discussion-row{padding:12px;border-radius:12px;background:hsl(var(--card))}#app[data-feed-display=compact]:is([data-view=feed],[data-view=community]) .discussion-main .row-title{font-size:16px;line-height:1.45}#app[data-feed-display=compact]:is([data-view=feed],[data-view=community]) .excerpt{-webkit-line-clamp:1}#app[data-feed-display=compact]:is([data-view=feed],[data-view=community]) .discussion-footer{margin-top:6px}.share-link{display:flex;gap:8px;width:100%;align-items:center}.share-link input{font-size:12px}.board-filters{display:flex;align-items:end;flex-wrap:wrap;gap:12px;background:hsl(var(--card));border-radius:12px;padding:16px;margin-top:16px}.board-filters label{display:grid;gap:5px;min-width:0;flex:1;font-size:11px;color:hsl(var(--muted-foreground))}.board-filters select{font-size:12px;background:hsl(var(--muted)/.35)}.board-thread-list{gap:0;background:hsl(var(--card));border-radius:12px;overflow:hidden}.thread-table-heading{display:none}.thread-table-row{border-radius:0;background:transparent;padding:16px 20px}.thread-table-row>.latest-activity{display:none}.thread-table-row .row-title{font-size:16px}.thread-table-row .excerpt{display:none}#app:is([data-view=feed],[data-view=community]) .forum-section[aria-label$="discussions"]>.section-bar{display:none}.forum-section{min-width:0;margin:16px 0}.section-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:0 2px 8px;min-height:36px}.section-bar h2{font-size:14px;letter-spacing:0}.section-detail{margin-left:auto;color:hsl(var(--muted-foreground));font-size:11px}.section-bar button{margin-left:auto;background:transparent}.rows{display:grid;gap:12px;min-width:0}.row,.post,.composer,.conversation-reply,.empty,.request-error,.loading-panel{min-width:0;border-radius:12px;background:hsl(var(--card));padding:20px}.row-title{display:block;min-height:44px;align-content:center;text-align:left;padding:0;background:transparent;border-radius:4px;border:0;overflow-wrap:anywhere;text-decoration:none;font-weight:650;font-size:18px;line-height:1.4;letter-spacing:-.02em}.row-title:hover{background:transparent}.excerpt{margin:6px 0 0;color:hsl(var(--muted-foreground));font-size:14px;line-height:1.65;overflow-wrap:anywhere}.member-avatar{width:30px;height:30px;flex:0 0 30px;display:inline-flex;align-items:center;justify-content:center;background:hsl(var(--accent)/.13);border-radius:50%;font-size:11px;font-weight:650}.discussion-meta{display:flex;align-items:center;gap:8px;min-width:0;margin-bottom:6px}.discussion-meta>.muted{flex:1;min-width:0;overflow-wrap:anywhere;margin:0;font-size:12px;line-height:1.5}.discussion-meta time{white-space:nowrap}.discussion-main{min-width:0}.discussion-main>.excerpt{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.discussion-footer{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin-top:14px}.discussion-action,.actions button{min-height:44px;border-radius:999px;font-size:12px;padding:8px 14px}.discussion-counts,.board-counts{display:flex;gap:16px;font-size:11px;color:hsl(var(--muted-foreground));margin:0}.discussion-counts div,.board-counts div{display:flex;gap:5px;align-items:baseline}.discussion-counts dd,.board-counts dd{margin:0;order:-1;font-weight:600;color:hsl(var(--foreground));font-variant-numeric:tabular-nums}.latest-activity{display:flex;flex-wrap:wrap;gap:4px 8px;color:hsl(var(--muted-foreground));font-size:11px;min-width:0;overflow-wrap:anywhere}.discussion-footer>.latest-activity{margin-left:auto}.latest-title{font-size:12px;line-height:1.5;text-align:left;overflow-wrap:anywhere;background:transparent;padding:0}.latest-title:hover{background:transparent;color:hsl(var(--primary))}
.board-index,.record-list,.member-list{display:grid;gap:0;background:hsl(var(--card));border-radius:12px;overflow:hidden}.board{display:grid;grid-template-columns:36px minmax(0,1fr);gap:6px 12px;padding:18px 20px;min-width:0}.board:hover,.record-row:hover{background:hsl(var(--muted)/.45)}.board-icon{width:34px;height:34px;display:grid;place-items:center;background:hsl(var(--muted)/.6);border-radius:10px;color:hsl(var(--muted-foreground));margin-top:5px}.board-icon:before{content:"";width:16px;height:13px;border:1.5px solid currentColor;border-radius:3px}.board-icon.unread{background:hsl(var(--primary)/.1);color:hsl(var(--primary))}.board-description,.board-latest{min-width:0}.board .row-title{font-size:17px}.board-description>.excerpt{font-size:13px;margin:0}.subforums{display:flex;flex-wrap:wrap;align-items:center;gap:0 10px;margin-top:4px}.subforums>.muted{font-size:11px}.subforum-link{min-height:36px;font-size:12px;padding:4px 0;background:transparent;color:hsl(var(--muted-foreground))}.board-counts,.board-latest{grid-column:2}.board-latest{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px}.board-latest .latest-title{min-height:36px}.breadcrumbs{display:flex;align-items:center;flex-wrap:wrap;gap:4px;color:hsl(var(--muted-foreground));font-size:12px;margin:0 0 6px}.breadcrumbs button{min-height:36px;background:transparent;padding:4px 6px;font-size:12px}.board-rules{background:hsl(var(--card));border-radius:12px;padding:0 16px;margin:16px 0}.board-rules>summary{padding:8px 0;font-size:12px;color:hsl(var(--muted-foreground))}.board-rules .post-body{padding-bottom:16px;font-size:13px}.announcement-row h3{font-size:14px}
.news-story{display:grid;grid-template-columns:42px minmax(0,1fr);gap:16px}.news-main{min-width:0}.news-rank{min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:10px;color:hsl(var(--muted-foreground));font-variant-numeric:tabular-nums}.rank-number{font-size:17px;font-weight:650;color:inherit}.rank-points{font-size:9px;text-align:center;max-width:100%;overflow-wrap:anywhere}.news-main>.source,.news-main>.muted{margin:4px 0 0;font-size:12px}.edition{display:flex;align-items:center;gap:12px;font-size:12px;color:hsl(var(--muted-foreground));margin:8px 0}.edition select{width:auto;max-width:100%}.news-preview .row-title{font-size:15px}
.post{margin:12px 0;padding:24px}.post-author{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;margin-bottom:18px}.post-author strong{font-size:14px;min-width:0;max-width:100%;overflow-wrap:anywhere}.post-author>.muted{margin-left:auto;font-size:11px}.badge{display:inline-block;padding:3px 6px;border-radius:5px;background:hsl(var(--accent)/.13);color:hsl(var(--muted-foreground));font-size:10px;line-height:1.5}.post-content{min-width:0;max-width:76ch}.post-body{font-size:15px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.post-body p{margin:0 0 14px}.post-body p:last-child{margin-bottom:0}.post-body h2,.post-body h3{margin:20px 0 10px;font-size:20px}.post-body h3{font-size:17px}.post-body blockquote{margin:14px 0;padding:12px 16px;border-left:2px solid hsl(var(--primary)/.6);border-radius:0 8px 8px 0;background:hsl(var(--muted)/.45);color:hsl(var(--muted-foreground))}.post-body figure{margin:16px 0;min-width:0}.post-body figcaption{color:hsl(var(--muted-foreground));font-size:11px;margin:6px 0}.post-body pre{white-space:pre;max-width:100%;overflow-x:auto;background:hsl(var(--muted)/.5);border-radius:10px;padding:16px;font:12px/1.8 ui-monospace,SFMono-Regular,monospace;margin:0}.post-body code,.post-body kbd{font-family:ui-monospace,SFMono-Regular,monospace}.post-body ul,.post-body ol{padding-left:24px;margin:12px 0}.post-body li{margin:6px 0}.post-body li::marker{color:hsl(var(--primary))}.post-body details{background:hsl(var(--muted)/.35);border-radius:10px;padding:0 12px}.post-body details>div{padding-bottom:12px}.post-body a{color:hsl(var(--primary));text-decoration:underline}.post-body .rich-table{max-width:100%;overflow-x:auto;white-space:normal}.post-body table{border-collapse:collapse;width:100%;font-size:13px}.post-body th,.post-body td{text-align:left;padding:10px 12px;min-width:100px}.post-body th{background:hsl(var(--muted)/.6)}.post-body tr:nth-child(even){background:hsl(var(--muted)/.25)}.post-body mark{background:#ffe14d;color:#090909;border-radius:3px;padding:0 3px}.poll-panel{padding:20px;background:hsl(var(--card));border-radius:12px;margin:16px 0}.poll-panel h2{font-size:17px}.poll-option{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:10px 0}.poll-label{flex:1;min-width:0;overflow-wrap:anywhere}.poll-option button{font-size:12px}.poll-option meter{width:100%;height:12px;accent-color:#fa00a8}.thread-tools{flex:1;min-width:0}.thread-tools>summary{font-size:12px;justify-content:flex-start;color:hsl(var(--muted-foreground))}.thread-tools[open]{flex:1 1 100%}.thread-tools>.actions{padding:6px 0 10px}.view-heading:has(.edition) h1{flex:1}.view-heading>.edition{order:1;margin:0}.view-heading:has(.edition)>.muted{order:2}.post-actions{margin-top:18px}.post-actions button{font-size:12px}.post-actions a{color:hsl(var(--muted-foreground));text-decoration:none;font-size:11px}.post-attachments{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.post-attachments a{display:flex;align-items:center;min-height:44px;padding:8px 12px;border-radius:10px;background:hsl(var(--muted)/.5);font-size:12px}.conversation-reply{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px}.conversation-reply p{margin:0;min-width:0;overflow-wrap:anywhere}.record-row{border-radius:0;background:transparent;padding:18px 20px}.record-row h2{font-size:16px}.record-row>.muted{margin:4px 0 0}.record-row>.post-body{font-size:14px;line-height:1.65;margin:8px 0 0}.message-row>.post-body{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.member-row{display:grid;grid-template-columns:32px minmax(0,1fr);gap:3px 12px}.member-row>.member-avatar{grid-row:1/5}.member-row>p,.member-row>a,.member-row>.badge{grid-column:2}.member-row>a,.actions>a{display:inline-flex;align-items:center;min-height:44px;font-size:12px}.member-row>.badge{justify-self:start}.profile-field h3{font-size:12px;font-weight:500;color:hsl(var(--muted-foreground))}.profile-field p{margin:4px 0 0}.mailbox-folders{display:flex;gap:4px;flex-wrap:wrap;width:100%;margin-top:8px}.mailbox-folders button{border-radius:999px;background:transparent;color:hsl(var(--muted-foreground));font-size:12px}.mailbox-folders button[aria-current=page]{background:hsl(var(--muted)/.65);color:inherit;font-weight:650}
.composer{display:grid;gap:20px;padding:24px;max-width:none}.composer label{display:grid;gap:8px;font-size:13px;font-weight:600}.composer textarea{min-height:280px;line-height:1.7;font-weight:400}.composer input,.composer select{font-weight:400}.attachments{padding:4px 0;font-size:12px}.composer .actions{margin-top:4px}.main:has(.composer){max-width:860px;padding-bottom:100px}.pager{margin-top:20px}.notice{border-radius:12px;padding:12px 16px;background:hsl(var(--accent)/.1);overflow-wrap:anywhere;margin:0 0 12px;font-size:13px}.notice:empty{display:none}.error{background:hsl(var(--primary)/.09)}.empty{font-size:13px;color:hsl(var(--muted-foreground));padding:28px 20px}.request-error>p{margin:0 0 12px}.loading-state{display:grid;gap:12px}.loading-panel{display:grid;gap:12px}.loading-panel span{display:block;background:hsl(var(--muted));border-radius:6px;animation:forum-loading 1.8s ease-in-out infinite alternate}.loading-meta{width:42%;height:16px}.loading-title{width:76%;height:25px}.loading-copy{width:92%;height:42px}.loading-action{width:100px;height:32px;border-radius:99px!important}@keyframes forum-loading{from{opacity:.55}to{opacity:1}}
.forum-chat{background:hsl(var(--card));border-radius:12px;margin:0 0 14px;min-width:0}.chat-header{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-height:44px;padding:2px 12px}.chat-header h2{font-size:12px;letter-spacing:0;margin:0;white-space:nowrap}.chat-header h2:before{content:"";display:inline-block;width:6px;height:6px;background:#81d8d0;border-radius:50%;margin-right:7px}.chat-peek{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.chat-header button,.chat-row-actions button{min-height:44px;background:transparent;padding:6px 8px;font-size:11px}.chat-header:has(#chat-toggle[aria-expanded=false]) #chat-profile,.chat-header:has(#chat-toggle[aria-expanded=false]) #chat-latest{display:none}.chat-header:has(#chat-toggle[aria-expanded=true]) .chat-peek{display:none}#chat-profile{font-size:11px;min-width:0;overflow-wrap:anywhere;flex:1}.chat-messages{max-height:220px;overflow-y:auto;padding:4px 16px}.chat-row{display:grid;grid-template-columns:130px minmax(0,1fr);gap:8px;padding:6px 0;min-width:0}.chat-meta{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px;font-size:11px}.chat-meta strong{overflow-wrap:anywhere}.chat-meta time{font-size:10px}.chat-message{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.6;margin:0}.chat-row-actions{display:flex;gap:4px;grid-column:2}.chat-form{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 16px}.chat-form input{flex:1;min-width:0;border-radius:999px;background:hsl(var(--muted)/.35)}.chat-form>button:last-child:not(#chat-send){flex-basis:100%}.chat-refresh-controls{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;padding:4px 16px}.chat-refresh-controls p{width:100%;font-size:11px;margin:0;overflow-wrap:anywhere}.chat-refresh-controls button,.chat-refresh-controls a{font-size:11px;min-height:44px}#chat-older{margin:4px 16px}#chat-notice{padding:0 16px 12px;font-size:11px}#chat-notice:empty{display:none}.chat-access{margin:0;padding:0 16px 8px;font-size:11px}.chat-access a{display:inline-flex;align-items:center;min-height:44px}
@media(min-width:760px){.thread-table-heading{display:grid;grid-template-columns:minmax(0,1fr) 100px 160px;gap:20px;padding:4px 20px 10px;color:hsl(var(--muted-foreground));font-size:11px}.thread-table-row{display:grid;grid-template-columns:minmax(0,1fr) 100px 160px;gap:20px;align-items:center}.thread-table-row .discussion-meta .member-avatar{display:none}.thread-table-row .discussion-main{display:flex;flex-direction:column}.thread-table-row .discussion-meta{order:1}.thread-table-row .discussion-footer{display:block;margin:0}.thread-table-row .discussion-footer>.latest-activity{display:none}.thread-table-row .discussion-counts{display:flex}.thread-table-row .discussion-counts>div:first-child{position:static;width:auto;height:auto;clip:auto;overflow:visible;white-space:normal}.thread-table-row>.latest-activity{display:grid;gap:4px}.thread-table-row .discussion-action{display:none}.board{grid-template-columns:36px minmax(0,1fr) 80px 170px;align-items:center;gap:14px}.board-description{grid-column:2}.board-counts{grid-column:3;flex-direction:column;gap:6px}.board-counts div{flex-direction:column;gap:0}.board-latest{grid-column:4;display:block}.board-latest .latest-activity{display:block;font-size:11px}.board-latest .latest-title{font-size:12px}.board .row-title{font-size:16px}}
@media(min-width:1000px){.masthead{grid-template-columns:200px minmax(0,1fr) auto}.mast-actions{margin-right:0}.workspace{grid-template-columns:220px minmax(0,1fr);gap:0;padding:0}.sidebar{position:sticky;top:64px;align-self:start;height:calc(100dvh - 64px);overflow:auto;padding:20px 12px;background:hsl(var(--card))}#navigation{display:block;padding:0}.primary-navigation{position:static;display:grid;grid-template-columns:1fr;gap:4px;padding:0;background:transparent;box-shadow:none}#navigation .primary-navigation button{flex-direction:row;justify-content:flex-start;min-height:44px;padding:10px 12px;font-size:14px}#navigation .primary-navigation button[aria-current=page]{background:hsl(var(--primary)/.1)}.navigation-more{position:static;margin:0}.navigation-more>summary{display:none}.secondary-navigation{position:static;width:100%;min-width:0;max-width:100%;max-height:none;background:transparent;border:0;box-shadow:none;padding:0}.secondary-navigation button{font-size:14px!important}.connection{display:block;padding:16px 12px;margin-top:16px}.connection strong{display:block;font-size:12px;max-width:100%;overflow-wrap:anywhere;white-space:normal}.connection #mode{display:block;margin:6px 0;font-size:11px}.connection-details{margin:0}.connection-details>summary{padding:4px 0}.connection-detail-panel{position:static;width:auto;max-width:100%;padding:8px 0;background:transparent;border:0;box-shadow:none}.main{padding:24px 28px 48px}.view-heading{margin-top:0}#app[data-view=thread] .main{max-width:860px}#app:has(.composer) .main{max-width:860px}}
@media(min-width:1280px){.workspace{grid-template-columns:220px minmax(0,1fr) 280px;gap:0}.context-rail{display:grid;gap:20px;padding:24px 24px 24px 0;position:sticky;top:64px;align-self:start;max-height:calc(100vh - 100px);overflow:auto;min-width:0}.context-panel{padding:18px;background:hsl(var(--card));border-radius:12px;min-width:0}.context-panel h2{font-size:14px;letter-spacing:0;margin-bottom:8px}.context-panel p{font-size:12px;color:hsl(var(--muted-foreground));line-height:1.7;margin:0 0 8px}.context-panel a{font-size:12px;display:inline-flex;align-items:center;min-height:44px}.context-board{display:block;width:100%;text-align:left;padding:8px 0;background:transparent;font-size:12px}#app:is([data-view=thread],[data-view=message]):not(:has(.composer)) .workspace,#app:has(.composer) .workspace{grid-template-columns:220px minmax(0,1fr)}#app:is([data-view=thread],[data-view=message]) .context-rail,#app:has(.composer) .context-rail{display:none}}
@media(max-width:680px){.masthead{grid-template-columns:minmax(0,1fr) auto auto;gap:6px;min-height:60px;padding:8px 12px}.brand{font-size:20px}.brand-forum{display:none}.surface-switcher>summary{gap:7px}.surface-arrow{width:14px;height:14px}.mast-actions button{padding:8px 12px;font-size:12px}.navigation-more{right:6px;top:8px}.navigation-more>summary{min-width:48px;justify-content:center;padding:8px 4px;font-size:12px}.mast-actions{margin-right:52px}.product-search{width:auto;max-width:none}.product-search>summary{display:flex;align-items:center;justify-content:center;min-width:44px;padding:8px;font-size:12px}.product-search #search{position:absolute;right:0;top:50px;width:min(296px,calc(100vw - 24px));background:hsl(var(--popover));border:1px solid hsl(var(--border));z-index:50;box-shadow:0 12px 30px #0002}#query{font-size:16px;padding:10px 14px}.sidebar{padding:0 12px}#navigation{gap:2px;padding:2px 0}.primary-navigation{justify-content:space-between;gap:0}.primary-navigation>button{min-width:44px;padding:8px 5px!important;font-size:12px!important}.navigation-more>summary{font-size:12px;padding:8px 6px;gap:3px}.connection{gap:4px 8px;min-height:36px;padding-bottom:4px}.connection strong{font-size:10px;max-width:40%}#mode{font-size:10px}.connection-details>summary{font-size:10px;padding:4px;min-height:36px}.main{padding:8px 12px 32px}.view-heading{margin:0 0 12px;gap:4px 8px}.view-heading h1{font-size:24px}#app:is([data-view=feed],[data-view=community]) .view-heading h1{font-size:22px}.view-heading>.muted{font-size:12px}.feed-filters button{padding:8px 12px;font-size:12px}.row,.post,.composer,.conversation-reply,.request-error,.loading-panel{padding:16px}.rows{gap:10px}.discussion-meta>.muted{font-size:11px}.discussion-main .row-title{font-size:18px}.discussion-footer{gap:6px 10px;margin-top:12px}.discussion-footer>.latest-activity{margin-left:0}.board{grid-template-columns:30px minmax(0,1fr);gap:4px 10px;padding:16px 12px}.board-icon{width:28px;height:28px}.board-counts{gap:12px}.board-latest{display:block}.board-latest .latest-activity{font-size:10px}.board-description>.excerpt{font-size:12px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.news-story{grid-template-columns:34px minmax(0,1fr);gap:10px}.news-main .row-title{font-size:17px}.rank-points{font-size:8px}.news-main>.source,.news-main>.muted{font-size:11px}.edition{flex-wrap:wrap}.edition select{max-width:calc(100% - 56px)}.post{margin:10px 0}.post-author{gap:6px;margin-bottom:14px}.post-author strong{flex:1}.post-author>.muted{margin-left:0;flex:1 1 100%}.post-body{font-size:15px;line-height:1.8}.post-body pre{padding:12px;font-size:12px}.conversation-reply>button{width:100%}.composer{gap:18px}.composer textarea{min-height:240px}.composer .actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.composer .actions>.primary{grid-column:1/-1}.composer .actions>button{min-width:0}input,textarea,select,.chat-form input{font-size:16px}.record-row{padding:16px}.member-row h2{font-size:15px}.chat-header{gap:3px;padding:2px 10px}.chat-header button{padding:6px;font-size:10px}.chat-row{grid-template-columns:minmax(0,1fr);gap:2px}.chat-row-actions{grid-column:1}.chat-messages{max-height:200px;padding:4px 12px}.chat-form{padding:10px 12px}.chat-refresh-controls{padding:4px 12px}.section-detail{font-size:10px}.breadcrumbs{gap:2px}.breadcrumbs button{font-size:11px}.surface-choices{width:min(300px,calc(100vw - 24px))}}
.discussion-byline{display:flex;align-items:center;gap:6px;min-width:0;flex:1}.discussion-board{background:transparent;padding:4px 0;min-height:36px;font-size:12px;font-weight:600;min-width:0;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.discussion-author{font-size:11px;color:hsl(var(--muted-foreground));min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}.discussion-date{margin-left:auto;font-size:10px;white-space:nowrap;color:hsl(var(--muted-foreground))}.discussion-byline>.badge{white-space:nowrap;flex:none}.discussion-meta{gap:8px}.discussion-row{padding:16px}.discussion-main .row-title{font-size:19px;line-height:1.45}.discussion-footer{margin-top:8px}.discussion-main>.excerpt{line-height:22px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.discussion-footer button{min-height:36px;font-size:12px;border-radius:999px;background:hsl(var(--muted)/.55);padding:8px 12px}.feed-pager{justify-content:center}.context-statistics{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.context-statistics dt{font-size:11px;color:hsl(var(--muted-foreground))}.context-statistics dd{font-size:22px;font-weight:600;margin:4px 0 0}.board-group{background:hsl(var(--card));border-radius:12px;padding:8px 12px;margin-bottom:16px}.board-group>.section-bar{padding:8px 12px}.board-group>.section-bar:before{content:"";width:8px;height:8px;border-radius:50%;background:hsl(var(--primary))}.board-group:nth-child(3n+2)>.section-bar:before{background:hsl(var(--accent))}.board-group:nth-child(3n)>.section-bar:before{background:#ffe14d}.board-group>.section-bar h2{font-size:16px}.view-heading>input[type=search]{max-width:220px;font-size:12px;margin-left:auto}.context-rail{font-size:12px}@media(max-width:680px){.forum-mark{display:none}.brand{font-size:19px}.masthead{gap:6px}.feed-display{gap:0}.feed-display button{font-size:10px;padding:6px;min-height:36px}.feed-refresh{font-size:11px;padding:6px}.view-heading h1{font-size:22px}.board-filters label{flex:1 1 40%}.discussion-main .row-title{font-size:18px}.board-group{padding:4px}.view-heading>input[type=search]{max-width:none;flex:1 1 100%}.discussion-byline>.badge{font-size:9px;padding:2px 4px}}
.mast-actions{position:relative}.post-choices{position:absolute;top:calc(100% + 8px);right:0;z-index:65;width:288px;max-width:calc(100vw - 24px);max-height:60dvh;overflow:auto;background:hsl(var(--popover));border-radius:12px;box-shadow:0 12px 36px #0003;padding:12px 8px}.post-choices .rail-heading{margin:4px 12px 8px}.post-board-choice{display:block;width:100%;text-align:left;background:transparent;border-radius:8px;font-size:13px}.post-board-choice:hover{background:hsl(var(--muted)/.6)}
.feed-display button,.feed-refresh{display:inline-flex;align-items:center;justify-content:center;gap:6px}.feed-display .nav-icon,.feed-refresh .nav-icon{width:16px;height:16px}.discussion-author:before{content:"·";display:inline-block;margin-right:6px;color:hsl(var(--muted-foreground)/.6)}@media(max-width:680px){#app:is([data-view=feed],[data-view=community]) .view-heading h1{flex:0 0 auto;white-space:nowrap;min-width:0}.view-heading{gap:6px}.feed-filters{gap:0}.feed-filters button{padding:8px 10px}.feed-display button{width:36px}.feed-refresh{min-width:36px}.refresh-label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.discussion-byline{gap:5px}.board-filters label{flex:1 1 40%}}
@media(prefers-reduced-motion:reduce){.surface-arrow{transition:none}.loading-panel span{animation:none}}
.view-back{margin-left:auto;background:transparent;color:hsl(var(--muted-foreground));font-size:12px}.composer label:has(input[type=checkbox]){display:flex;align-items:center;justify-content:space-between;gap:16px}.composer input[type=checkbox]{width:20px;height:20px;min-height:20px;accent-color:hsl(var(--primary))}.preference-state{font-size:14px;color:hsl(var(--muted-foreground))}.forum-section>a{display:inline-flex;align-items:center;min-height:44px;margin-right:16px}
.chat-reply-context{display:flex;flex:1 1 100%;align-items:center;gap:8px;font-size:12px;overflow-wrap:anywhere}.chat-reply-preview{font-size:11px;margin:0 0 4px;overflow-wrap:anywhere}.chat-unread{font-size:11px}.starter-collections{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.starter-collection{background:hsl(var(--muted)/.3);padding:16px;border-radius:12px;min-width:0}.starter-collection h3{margin:0 0 8px;font-size:15px}.starter-collection>.muted{font-size:12px;min-height:54px}.starter-collection .starter-board{margin:8px 0}.starter-collection button{font-size:12px;padding:6px 8px}.discovery-controls{gap:8px;margin:8px 0 20px;flex-wrap:wrap}.discovery-controls label{display:flex;align-items:center;gap:8px;font-size:12px}.discovery-controls select{min-height:36px;max-width:180px}.catch-up-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0 24px}.catch-up-stat{display:flex;gap:6px;flex-direction:column;background:hsl(var(--card));padding:18px;border-radius:12px}.catch-up-stat strong{font-size:24px}.catch-up-stat span{color:hsl(var(--muted-foreground));font-size:12px}.accepted-answer{color:hsl(var(--accent-foreground));background:hsl(var(--accent)/.2)}.reply-context{margin:0 0 12px}.starter-board{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.starter-board>.excerpt{flex:1 1 200px}.starter-board>button:last-child:not(:first-child){margin-left:auto}@media(max-width:680px){.starter-collections{grid-template-columns:1fr}.starter-collection>.muted{min-height:0}.discovery-controls{gap:6px}.discovery-controls>button{padding:8px;font-size:12px}.catch-up-stat{padding:12px}.catch-up-summary{gap:8px}.feed-filters{flex-wrap:wrap}.view-heading .feed-filters{order:3;flex-basis:100%;width:100%;max-width:none;margin-left:0}.view-heading .feed-filters button{flex:1}.view-heading .feed-display{order:1;margin-left:auto}.view-heading .feed-refresh{order:2}.view-heading h1{order:0}.post-actions{flex-wrap:wrap}}

/* Social timeline: shared density and identity hierarchy with the native forum. */
.feed-settings{position:relative;margin-left:auto}.feed-settings summary{cursor:pointer;list-style:none;font-size:12px;color:hsl(var(--muted-foreground));min-height:44px;display:flex;align-items:center;gap:6px}.feed-settings summary:after{content:"⌄"}.feed-settings-options{position:absolute;right:0;z-index:15;background:hsl(var(--popover));padding:6px;box-shadow:0 8px 24px #0002;border-radius:10px;width:180px;max-width:calc(100vw - 24px);display:grid;gap:4px}.feed-settings-options button{font-size:12px;text-align:left;padding:8px 10px}.discovery-controls>button[aria-pressed=true]{background:hsl(var(--primary)/.1);color:hsl(var(--primary));font-weight:650}

#app:is([data-view=feed],[data-view=community]) .view-heading{margin-bottom:10px}
.discovery-controls{margin:6px 0 10px;gap:6px}.discovery-controls>button{min-height:36px;padding:6px 10px}
.feed-starter{background:hsl(var(--card));border-radius:12px;padding:10px 14px;margin:8px 0}
.feed-starter-summary{display:flex;align-items:center;gap:12px;min-height:44px;cursor:pointer;list-style:none}.feed-starter-summary::-webkit-details-marker{display:none}
.feed-starter-summary>span:not(.member-avatar){color:hsl(var(--muted-foreground));font-size:14px;min-width:0}.feed-starter-summary>strong{margin-left:auto;white-space:nowrap;font-size:12px;color:hsl(var(--primary))}
.feed-starter-options{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-top:8px}.feed-starter-options label{display:flex;gap:8px;align-items:center;font-size:12px;color:hsl(var(--muted-foreground))}.feed-starter-options select{max-width:180px;min-height:44px;font-size:13px}.feed-starter-options button{font-size:12px;min-height:44px;padding:8px 12px}
.discussion-author:before{content:none}.discussion-author{font-weight:650;font-size:13px;color:hsl(var(--foreground))}.discussion-handle{min-width:0;max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:hsl(var(--muted-foreground));order:1}.discussion-date{order:3}.discussion-board{font-size:11px;min-height:24px;padding:0 0 2px;max-width:100%;color:hsl(var(--muted-foreground));display:block}.discussion-byline{flex-wrap:wrap;gap:4px 8px}.discussion-meta{margin-bottom:0}.discussion-byline .badge{order:2}.discussion-main .row-title{min-height:32px}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-list{gap:0;background:hsl(var(--card));border-radius:12px;overflow:clip}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-row{position:relative;padding:12px 14px 12px 60px;border-radius:0;background:transparent}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-row:hover{background:hsl(var(--muted)/.28)}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-meta>.member-avatar{position:absolute;left:14px;top:14px;width:34px;height:34px}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-main .row-title{font-size:17px;line-height:1.4}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-footer{margin-top:4px;gap:4px}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-footer button{background:transparent;color:hsl(var(--muted-foreground));padding:6px 10px}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-footer button:hover,#app[data-feed-display=timeline] .discussion-footer button[aria-pressed=true]{background:hsl(var(--primary)/.08);color:hsl(var(--primary))}
@media(min-width:1100px){.main{padding:12px 20px 48px}.context-rail{padding-top:12px}}
@media(max-width:680px){.feed-starter{padding:8px 12px}.feed-starter-summary{gap:8px}.feed-starter-summary>span:not(.member-avatar){font-size:13px}.discussion-footer button{min-height:44px!important}.discussion-byline{gap:4px 6px}.discussion-handle{max-width:24%}.discussion-author{font-size:12px;max-width:45%}.feed-starter-options select{font-size:16px}.view-heading .feed-filters{order:0;flex-basis:auto;width:auto}.view-heading .feed-filters button{font-size:11px;padding:8px}.view-heading .feed-display{order:1}.discussion-main .row-title{font-size:17px}}

/* Shared media layout and denser social hierarchy. */
.forum-mark{display:inline-block;padding:0;background:transparent;border-radius:0;width:36px;height:36px;object-fit:contain;transition:transform 180ms ease;filter:drop-shadow(0 2px 2px #0002)}.surface-switcher>summary:hover .forum-mark{transform:rotate(-5deg) translateY(-1px)}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-row{padding:8px 12px 8px 52px}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-meta>.member-avatar{left:12px;top:10px;width:32px;height:32px}
#app[data-feed-display=timeline]:is([data-view=feed],[data-view=community]) .discussion-main .row-title{font-size:16px;line-height:20px;min-height:28px;padding:3px 0}
.discussion-byline .discussion-board{display:inline;min-height:0;padding:0;order:2;max-width:32%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.discussion-main .excerpt{margin:2px 0 4px;line-height:20px}.feed-starter{padding:6px 12px;box-shadow:0 2px 10px hsl(var(--primary)/.04)}
.media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px;border-radius:10px;overflow:hidden;margin:6px 0}.media-grid[data-count="1"]{grid-template-columns:1fr}.media-tile{position:relative;padding:0;height:110px;min-width:0;overflow:hidden;border-radius:0;background:hsl(var(--muted))}.media-grid[data-count="1"] .media-tile{height:clamp(160px,27vw,280px)}.media-grid[data-count="3"]>:first-child,.media-grid[data-count="5"]>:first-child{grid-row:span 2;height:223px}.media-tile img{width:100%;height:100%;object-fit:cover;transition:transform 180ms ease,filter 180ms ease}.media-tile:hover img{transform:scale(1.025);filter:brightness(1.04)}.media-number{position:absolute;bottom:6px;right:6px;padding:2px 6px;border-radius:5px;background:#0009;color:white;font-size:10px}
#app[data-feed-display=compact] .discussion-row .media-grid{display:flex;gap:4px}#app[data-feed-display=compact] .discussion-row .media-tile{flex:0 1 90px;height:64px;border-radius:6px}
.media-viewer{margin:12px 0;background:hsl(var(--card));border-radius:12px;padding:12px}.media-viewer>img{width:100%;max-height:65vh;object-fit:contain}.media-viewer figcaption{font-size:12px;color:hsl(var(--muted-foreground));margin-top:8px}.media-controls button{min-height:44px}.discussion-main{animation:forum-enter 160ms ease-out}.discussion-action:active{transform:translateY(1px)}@keyframes forum-enter{from{opacity:.5;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.discussion-main{animation:none}.forum-mark,.media-tile img{transition:none}.surface-switcher>summary:hover .forum-mark,.media-tile:hover img,.discussion-action:active{transform:none}}
</style></head><body><div id="app"><header class="masthead"><details id="surface-switcher" class="surface-switcher"><summary id="surface-trigger" aria-label="SYMBaiEX site switcher"><span class="brand" aria-label="SYMBaiEX Forum"><img class="forum-mark" src="${SYMBAIEX_MASCOT_DATA_URI}" alt="" width="36" height="36">SYMB<span class="brand-ai">ai</span>EX</span><svg class="surface-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><nav id="surface-choices" class="surface-choices" aria-label="SYMBaiEX sites"></nav></details><details id="search-panel" class="product-search"><summary>Search</summary><form id="search" role="search"><label for="query" class="sr-only">Search forum</label><input id="query" type="search" placeholder="Search SYMBaiEX Forum" maxlength="500" required><button type="submit">Search</button></form></details><div class="mast-actions"><button id="compose" class="primary" type="button" hidden>Create post</button><section id="post-choices" class="post-choices" aria-label="Choose a board for your post" hidden></section></div></header><div class="workspace"><aside class="sidebar"><nav id="navigation" aria-label="Forum sections"></nav><div class="connection"><div class="eyebrow">Acting profile</div><strong id="identity">Connecting profile…</strong><span id="mode">Server permissions apply</span><details id="connection-details" class="connection-details"><summary id="connection-trigger">Agent access</summary><div class="connection-detail-panel"><button id="expand" type="button" hidden>Expand forum</button><span id="connection-owner" hidden></span><div id="settings"></div><div id="posting-trust" class="posting-trust" hidden></div></div></details></div></aside><main class="main"><section id="forum-chat" class="forum-chat" aria-label="Live forum chat"><header class="chat-header"><h2>Lounge chat</h2><span id="chat-peek" class="chat-peek muted">Public community lounge</span><span id="chat-profile" class="muted">Connect to join</span><button id="chat-moderation" type="button" hidden>Moderation</button><button id="chat-latest" type="button">Refresh</button><button id="chat-toggle" type="button" aria-expanded="false" aria-controls="chat-panel">Open chat</button></header><div id="chat-panel" hidden><div id="chat-messages" class="chat-messages" role="log" aria-label="Public chat messages" aria-live="off"><p class="muted">Loading community chat…</p></div><button id="chat-older" type="button" hidden>Older messages</button><form id="chat-form" class="chat-form" hidden><label for="chat-body" class="sr-only">Your public chat message</label><input id="chat-body" maxlength="2000" placeholder="Say hello to the community…" required><button id="chat-send" type="submit" class="primary" disabled>Send</button></form><div id="chat-notice" role="status" aria-live="polite" class="muted"></div></div></section><div id="status" class="notice" role="status" aria-live="polite"></div><section id="content" aria-label="Forum content" aria-busy="true"><h1>Welcome to the forum</h1><p>Connecting to your SYMBaiEX tools…</p></section></main><aside id="forum-context" class="context-rail" aria-label="Community context"></aside></div></div><script>(${forumPluginAppRuntime.toString()})(${JSON.stringify({ collections: FORUM_STARTER_COLLECTIONS, prompts: FORUM_CONVERSATION_PROMPTS }).replace(/</g, "\\u003c")});</script></body></html>`;
