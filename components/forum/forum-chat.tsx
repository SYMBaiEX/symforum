"use client";
import { useForumHash } from "./forum-runtime-context";

import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ChevronDown, ChevronUp, Send, Trash2 } from "lucide-react";
import { userFacingError } from "@/lib/auth-errors";
import { reportAppError } from "@/components/app-error-surface";
import { forumExperienceRefs } from "./forum-experience-refs";
import { useRouter, usePathname } from "next/navigation";
import { asRoute } from "@/lib/typed-route";
import { forumHrefForPathname, forumPath } from "./forum-refs";
import { ForumLink } from "./forum-primitives";
import { forumMemberProfilePath } from "./forum-refs";
import {
  forumChatRefs,
  type ForumChatMessage,
  type ForumChatPage,
} from "./forum-chat-refs";

const controlClass =
  "forum-action-pill focus-ring inline-flex min-h-11 items-center justify-center gap-1.5 px-3 text-xs disabled:opacity-50";
type ChatDraft = { actorId: string; body: string } | undefined;
type DraftActions = {
  draft: ChatDraft;
  onDraftChange: (actorId: string, body: string) => void;
  onDraftSent: (actorId: string, sentBody: string) => void;
  showPending?: boolean;
};

export function isForumChatAnchor(hash: string) {
  return hash === "#forum-chat";
}

export function ForumChat({
  defaultOpen = false,
}: { defaultOpen?: boolean } = {}) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState<ChatDraft>();
  const [showPending, setShowPending] = useState(false);
  const routeHash = useForumHash();
  useEffect(() => {
    if (isForumChatAnchor(routeHash)) setOpen(true);
  }, [routeHash]);
  return (
    <section
      id="forum-chat"
      aria-labelledby="forum-chat-heading"
      className="scroll-mt-24 overflow-hidden rounded-xl bg-card"
    >
      <header className="flex min-h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-accent"
          />
          <h2
            id="forum-chat-heading"
            className="shrink-0 text-sm font-semibold"
          >
            Lounge chat
          </h2>
          {open ? (
            <span className="text-[10px] text-muted-foreground">UTC</span>
          ) : (
            <ChatErrorBoundary compact>
              <ChatPreview
                onOpenPending={() => {
                  setShowPending(true);
                  setOpen(true);
                }}
              />
            </ChatErrorBoundary>
          )}
        </div>
        <button
          className={controlClass}
          aria-expanded={open}
          aria-controls="forum-chat-content"
          onClick={() => {
            setShowPending(false);
            setOpen((value) => !value);
          }}
          type="button"
        >
          {open ? (
            <ChevronUp className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">
            {open ? "Hide chat" : "Open chat"}
          </span>
          <span className="sr-only sm:hidden">
            {open ? "Hide chat" : "Open chat"}
          </span>
        </button>
      </header>
      {open ? (
        <div id="forum-chat-content">
          <ChatErrorBoundary>
            <LiveForumChat
              draft={draft}
              showPending={showPending}
              onDraftChange={(actorId, body) => setDraft({ actorId, body })}
              onDraftSent={(actorId, sentBody) =>
                setDraft((current) =>
                  current?.actorId === actorId && current.body === sentBody
                    ? { ...current, body: "" }
                    : current,
                )
              }
            />
          </ChatErrorBoundary>
        </div>
      ) : null}
    </section>
  );
}

function ChatPreview({ onOpenPending }: { onOpenPending: () => void }) {
  const { isLoading } = useConvexAuth();
  const data = useQuery(
    forumChatRefs.listChatMessages,
    isLoading ? "skip" : { paginationOpts: { numItems: 1, cursor: null } },
  );
  const latest = data?.viewer.canRead ? data.page[0] : null;
  const preview = latest
    ? `${latest.authorIdentity.name}${latest.authorIdentity.isAgent ? " (AI)" : latest.agentAssisted ? " (AI assisted)" : ""}: ${latest.body}`
    : undefined;
  return (
    <>
      <p
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        title={preview}
      >
        {data && !data.viewer.canRead
          ? "Chat unavailable"
          : latest
            ? preview
            : data === undefined
              ? "Loading chat…"
              : "No messages yet"}
      </p>
      {data?.viewer.actingAs && (data.unreadCount ?? 0) > 0 ? (
        <span className="shrink-0 text-[11px] text-accent">
          {data.unreadCount}
          {data.unreadLimited ? "+" : ""} unread
          {data.mentionCount ? ` · ${data.mentionCount} mentions` : ""}
        </span>
      ) : null}
      {data?.viewer.canRead && data.viewer.actingAs && data.pending.length ? (
        <button
          type="button"
          className="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-full bg-primary/10 px-2.5 text-[11px] font-medium text-primary"
          onClick={onOpenPending}
          aria-label={`Open your ${data.pending.length}${data.pendingLimited ? " or more" : ""} lounge messages awaiting staff moderation`}
        >
          {data.pending.length}
          {data.pendingLimited ? "+" : ""} pending
        </button>
      ) : null}
    </>
  );
}

class ChatErrorBoundary extends Component<
  { children: ReactNode; compact?: boolean },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    reportAppError(error, {
      scope: "forum",
      eventType: "forum_chat_failed",
      component: "ForumChat",
      action: "forum:listChatMessages",
      notify: false,
    });
  }
  render() {
    return this.state.failed ? (
      <div
        role="status"
        className={
          this.props.compact
            ? "flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground"
            : "flex flex-wrap items-center gap-3 px-4 py-5 text-sm text-muted-foreground"
        }
      >
        Chat is unavailable.
        <button
          className={controlClass}
          onClick={() => this.setState({ failed: false })}
          type="button"
        >
          Retry
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function LiveForumChat(props: DraftActions) {
  const { isLoading } = useConvexAuth();
  const data = useQuery(
    forumChatRefs.listChatMessages,
    isLoading ? "skip" : { paginationOpts: { numItems: 40, cursor: null } },
  );
  if (data === undefined)
    return (
      <p
        role="status"
        aria-busy="true"
        className="px-4 py-5 text-sm text-muted-foreground"
      >
        Loading chat…
      </p>
    );
  if (!data.viewer.canRead)
    return (
      <p role="status" className="px-4 py-5 text-xs text-muted-foreground">
        Public chat is unavailable with the current General board permissions.
      </p>
    );
  return (
    <ChatSession
      key={data.viewer.actingAs?.userId ?? "guest"}
      data={data}
      {...props}
    />
  );
}

function ChatSession({
  data,
  draft,
  onDraftChange,
  onDraftSent,
  showPending,
}: { data: ForumChatPage } & DraftActions) {
  const send = useMutation(forumChatRefs.sendChatMessage);
  const markRead = useMutation(forumChatRefs.markChatRead);
  const promote = useMutation(forumExperienceRefs.promoteChat);
  const router = useRouter(),
    pathname = usePathname();
  const [replyTo, setReplyTo] = useState<ForumChatMessage>();
  const [selected, setSelected] = useState<string[]>([]);
  const [threadTitle, setThreadTitle] = useState("");
  const [promoting, setPromoting] = useState(false);
  const lastMarked = useRef<string | undefined>(undefined);
  const remove = useMutation(forumChatRefs.deleteChatMessage);
  const actorId = data.viewer.actingAs?.userId ?? "guest";
  const body = draft?.actorId === actorId ? draft.body : "";
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState<string>();
  const [error, setError] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [pendingOpen, setPendingOpen] = useState(Boolean(showPending));
  useEffect(() => {
    if (showPending) setPendingOpen(true);
  }, [showPending]);
  const log = useRef<HTMLDivElement>(null);
  const followsBottom = useRef(true);
  const anchor = useRef<{ id: string; offset: number } | undefined>(undefined);
  const previousIds = useRef<Set<string> | undefined>(undefined);
  const sendLock = useRef(false);
  const mounted = useRef(true);
  const messages = [...data.page].reverse();
  const signature = messages
    .map((message) => `${message._id}:${message.updatedAt}`)
    .join("|");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const element = log.current;
    if (!element) return;
    const ids = new Set(messages.map((message) => message._id));
    const additions = previousIds.current
      ? messages.filter((message) => !previousIds.current!.has(message._id))
          .length
      : 0;
    previousIds.current = ids;
    if (followsBottom.current) {
      element.scrollTop = element.scrollHeight;
    } else {
      if (anchor.current) {
        const held = Array.from(element.children).find(
          (child) =>
            (child as HTMLElement).dataset.chatMessage === anchor.current!.id,
        );
        if (held)
          element.scrollTop +=
            held.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            anchor.current.offset;
      }
      if (additions) setUnseen((count) => count + additions);
    }
    // The signature includes changed moderation/deletion state as well as IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  function rememberScroll() {
    const element = log.current;
    if (!element) return;
    const bottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    followsBottom.current = bottom;
    setFollow(bottom);
    if (bottom) {
      setUnseen(0);
      anchor.current = undefined;
    } else {
      const containerTop = element.getBoundingClientRect().top;
      const visible = Array.from(element.children).find(
        (child) => child.getBoundingClientRect().bottom > containerTop,
      );
      anchor.current = visible
        ? {
            id: (visible as HTMLElement).dataset.chatMessage ?? "",
            offset: visible.getBoundingClientRect().top - containerTop,
          }
        : undefined;
    }
  }

  useEffect(() => {
    const latest = data.page[0];
    if (
      !follow ||
      !latest ||
      !data.viewer.actingAs ||
      document.visibilityState !== "visible" ||
      lastMarked.current === latest._id
    )
      return;
    lastMarked.current = latest._id;
    void markRead({ messageId: latest._id }).catch(() => {
      lastMarked.current = undefined;
    });
  }, [data.page, data.viewer.actingAs, follow, markRead]);
  async function startThread() {
    if (promoting || !selected.length) return;
    setPromoting(true);
    setError(undefined);
    try {
      const result = await promote({
        categorySlug: "general",
        title: threadTitle,
        messageIds: selected,
      });
      if (result.status === "pending") {
        setReceipt(
          "Awaiting moderator review. Find the new thread in Account & preferences → Pending content.",
        );
        setSelected([]);
      } else
        router.push(
          asRoute(
            forumHrefForPathname(
              forumPath(result.categorySlug, result.threadSlug),
              pathname,
            ),
          ),
        );
    } catch (caught) {
      setError(
        userFacingError(caught, "Could not save the conversation as a thread."),
      );
    } finally {
      setPromoting(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sendLock.current || sending || !data.viewer.canSend || !body.trim())
      return;
    sendLock.current = true;
    const sentBody = body;
    setSending(true);
    setError(undefined);
    setReceipt(undefined);
    try {
      const result = await send({
        body: sentBody,
        ...(replyTo ? { replyToId: replyTo._id } : {}),
      });
      setReplyTo(undefined);
      onDraftSent(actorId, sentBody);
      if (!mounted.current) return;
      setReceipt(
        result.publicationStatus === "published"
          ? "Message published."
          : "Awaiting staff moderation. Your message is not public yet.",
      );
      if (result.publicationStatus === "published") {
        followsBottom.current = true;
        setFollow(true);
        setUnseen(0);
      }
    } catch (caught) {
      if (mounted.current)
        setError(
          userFacingError(
            caught,
            "Could not send your message. Your draft is still here.",
          ),
        );
    } finally {
      sendLock.current = false;
      if (mounted.current) setSending(false);
    }
  }

  async function deleteMessage(id: ForumChatMessage["_id"]) {
    if (deletingId) return;
    setDeletingId(id);
    setError(undefined);
    try {
      await remove({ messageId: id });
    } catch (caught) {
      if (mounted.current)
        setError(userFacingError(caught, "Could not remove this message"));
    } finally {
      if (mounted.current) setDeletingId(undefined);
    }
  }

  return (
    <>
      <div
        ref={log}
        role="log"
        aria-label="Lounge messages"
        aria-live={follow ? "polite" : "off"}
        aria-relevant="additions text"
        tabIndex={0}
        onScroll={rememberScroll}
        className="focus-ring max-h-28 overflow-y-auto overscroll-contain px-3 pb-1 text-xs [overflow-anchor:none] sm:max-h-32 sm:px-4"
      >
        {messages.length ? (
          messages.map((message) => (
            <ChatMessage
              key={message._id}
              message={message}
              deleting={deletingId === message._id}
              onDelete={() => void deleteMessage(message._id)}
              onReply={
                data.viewer.canSend
                  ? () => {
                      setReplyTo(message);
                      document.getElementById("forum-chat-message")?.focus();
                    }
                  : undefined
              }
              onMention={
                data.viewer.canSend
                  ? () => {
                      onDraftChange(
                        actorId,
                        `${body}${body ? " " : ""}@${message.authorIdentity.username} `,
                      );
                      document.getElementById("forum-chat-message")?.focus();
                    }
                  : undefined
              }
              onSelect={
                data.viewer.canSend
                  ? () =>
                      setSelected((current) =>
                        current.includes(message._id)
                          ? current.filter((id) => id !== message._id)
                          : current.length < 10
                            ? [...current, message._id]
                            : current,
                      )
                  : undefined
              }
              selected={selected.includes(message._id)}
            />
          ))
        ) : (
          <p className="py-2 text-xs text-muted-foreground">No messages yet.</p>
        )}
      </div>
      {!data.isDone ? (
        <p className="px-4 pt-1 text-[10px] text-muted-foreground">
          Showing the latest {data.page.length} messages.
        </p>
      ) : null}
      {unseen ? (
        <button
          className={`${controlClass} w-full text-primary`}
          onClick={() => {
            followsBottom.current = true;
            setFollow(true);
            setUnseen(0);
            if (log.current) log.current.scrollTop = log.current.scrollHeight;
          }}
          type="button"
        >
          {unseen} new {unseen === 1 ? "message" : "messages"} ↓
        </button>
      ) : null}
      {selected.length ? (
        <form
          className="rounded-xl bg-muted/30 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void startThread();
          }}
        >
          <label className="block text-xs text-muted-foreground">
            Save {selected.length} selected messages as a General thread
            <input
              className="focus-ring mt-2 min-h-11 w-full rounded-xl bg-card px-3 text-base"
              required
              minLength={4}
              maxLength={160}
              value={threadTitle}
              placeholder="Give the conversation a title"
              onChange={(e) => setThreadTitle(e.target.value)}
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              disabled={promoting}
              className={`${controlClass} text-primary`}
            >
              {promoting ? "Creating…" : "Create thread"}
            </button>
            <button
              type="button"
              className={controlClass}
              onClick={() => setSelected([])}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {replyTo ? (
        <div className="flex items-center gap-2 px-4 pt-2 text-xs">
          <p className="min-w-0 flex-1 truncate text-muted-foreground">
            Reply to {replyTo.authorIdentity.name}: {replyTo.body}
          </p>
          <button
            type="button"
            className={controlClass}
            onClick={() => setReplyTo(undefined)}
          >
            Cancel reply
          </button>
        </div>
      ) : null}
      {data.viewer.canSend ? (
        <form
          onSubmit={submit}
          className="flex items-center gap-2 px-3 pb-3 pt-2 sm:px-4"
        >
          <label className="sr-only" htmlFor="forum-chat-message">
            Message the public lounge
          </label>
          <input
            id="forum-chat-message"
            className="focus-ring min-h-11 min-w-0 flex-1 rounded-full bg-muted/60 px-4 text-base outline-none sm:text-sm"
            type="text"
            placeholder="Message the public chat…"
            value={body}
            maxLength={2000}
            aria-invalid={Boolean(error)}
            aria-describedby={
              [
                error ? "forum-chat-error" : null,
                data.viewer.postingTrust === "moderated"
                  ? "forum-chat-trust"
                  : null,
                body.length > 1800 ? "forum-chat-length" : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
            onChange={(event) => onDraftChange(actorId, event.target.value)}
          />
          <button
            className={`${controlClass} bg-primary text-primary-foreground hover:bg-primary/90`}
            aria-label={
              sending ? "Sending lounge message" : "Send lounge message"
            }
            disabled={sending || !body.trim()}
            aria-busy={sending}
            type="submit"
          >
            <Send className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">
              {sending ? "Sending…" : "Send"}
            </span>
          </button>
        </form>
      ) : (
        <div className="flex min-h-11 items-center px-3 pb-1 text-xs text-muted-foreground sm:px-4">
          {data.viewer.actingAs ? (
            "Chat posting is unavailable for this profile."
          ) : (
            <ForumLink
              className={`${controlClass} -ml-3 text-primary`}
              href="/signin"
            >
              Sign in to join the public chat
            </ForumLink>
          )}
        </div>
      )}
      {body.length > 1800 ? (
        <p
          id="forum-chat-length"
          className="px-4 pb-2 text-[11px] text-muted-foreground"
        >
          {2000 - body.length} characters remaining
        </p>
      ) : null}
      {data.viewer.canSend && data.viewer.postingTrust === "moderated" ? (
        <p
          id="forum-chat-trust"
          className="px-4 pb-2 text-[11px] text-muted-foreground"
        >
          Your messages need moderator approval before appearing publicly.
        </p>
      ) : null}
      {receipt ? (
        <p role="status" className="px-4 pb-2 text-xs text-muted-foreground">
          {receipt}
        </p>
      ) : null}
      {error ? (
        <p
          id="forum-chat-error"
          role="alert"
          className="px-4 pb-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
      {data.pending.length ? (
        <details
          className="px-4 pb-2"
          open={pendingOpen}
          onToggle={(event) => setPendingOpen(event.currentTarget.open)}
        >
          <summary
            className={`${controlClass} -ml-3 cursor-pointer text-xs text-muted-foreground`}
          >
            Awaiting staff moderation: {data.pending.length} of your messages
          </summary>
          <div className="space-y-2 pb-2">
            {data.pendingLimited ? (
              <p className="text-[11px] text-muted-foreground">
                Showing your 10 most recent pending messages.
              </p>
            ) : null}
            {data.pending.map((message) => (
              <div key={message._id} className="flex items-start gap-2">
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-5">
                  {message.body}
                </p>
                {message.canDelete ? (
                  <button
                    className={controlClass}
                    disabled={Boolean(deletingId)}
                    onClick={() => void deleteMessage(message._id)}
                    aria-label="Delete pending message"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {data.viewer.canModerate ? <ChatModeration /> : null}
    </>
  );
}

export function ChatMessage({
  message,
  deleting,
  onDelete,
  onReply,
  onMention,
  onSelect,
  selected,
}: {
  onReply?: () => void;
  onMention?: () => void;
  onSelect?: () => void;
  selected?: boolean;
  message: ForumChatMessage;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      data-chat-message={message._id}
      className="group flex items-start gap-2 py-0.5 leading-5"
    >
      <time
        className="shrink-0 pt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
        dateTime={new Date(message.createdAt).toISOString()}
        title={new Date(message.createdAt).toUTCString()}
      >
        {new Date(message.createdAt).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        })}
      </time>
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        <ForumLink
          className="focus-ring font-semibold text-primary"
          href={forumMemberProfilePath(message.authorIdentity.username)}
        >
          {message.authorIdentity.name}
        </ForumLink>
        {message.authorIdentity.isAgent ? (
          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
            AI
          </span>
        ) : message.agentAssisted ? (
          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
            AI assisted
          </span>
        ) : null}
        <span className="text-muted-foreground">: </span>
        {message.replyTo ? (
          <span className="mb-1 block truncate text-[11px] text-muted-foreground">
            ↳ {message.replyTo.body}
          </span>
        ) : null}
        {message.body}
        {onReply || onMention || onSelect ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {onReply ? (
              <button
                type="button"
                className="focus-ring min-h-11 px-2 text-[11px] text-muted-foreground sm:min-h-7"
                onClick={onReply}
              >
                Reply
              </button>
            ) : null}
            {onMention ? (
              <button
                type="button"
                className="focus-ring min-h-11 px-2 text-[11px] text-muted-foreground sm:min-h-7"
                onClick={onMention}
              >
                Mention
              </button>
            ) : null}
            {onSelect ? (
              <button
                type="button"
                aria-pressed={selected}
                className={`focus-ring min-h-11 px-2 text-[11px] sm:min-h-7 ${selected ? "text-primary" : "text-muted-foreground"}`}
                onClick={onSelect}
              >
                {selected ? "Selected for thread" : "Save to thread"}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {message.canDelete ? (
        <button
          className="focus-ring inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-destructive sm:min-h-6 sm:min-w-6"
          disabled={deleting}
          onClick={onDelete}
          aria-label={`Delete message from ${message.authorIdentity.name}`}
          type="button"
        >
          <Trash2 aria-hidden="true" className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function ChatModeration() {
  const [open, setOpen] = useState(false);
  const pending = useQuery(
    forumChatRefs.listChatPendingMessages,
    open ? { paginationOpts: { numItems: 20, cursor: null } } : "skip",
  );
  const moderate = useMutation(forumChatRefs.moderateChatMessage);
  const [working, setWorking] = useState<string>();
  const [error, setError] = useState<string>();
  async function review(
    messageId: ForumChatMessage["_id"],
    status: "active" | "hidden",
  ) {
    if (working) return;
    setWorking(messageId);
    setError(undefined);
    try {
      await moderate({ messageId, status });
    } catch (caught) {
      setError(userFacingError(caught, "Could not review this message"));
    } finally {
      setWorking(undefined);
    }
  }
  return (
    <div className="px-4 pb-2">
      <button
        className={`${controlClass} -ml-3`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        Chat moderation {open ? "−" : "+"}
      </button>
      {open ? (
        <div className="space-y-3">
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {pending === undefined ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading pending messages…
            </p>
          ) : pending.page.length ? (
            pending.page.map((message) => (
              <article className="text-xs" key={message._id}>
                <p className="font-semibold">
                  {message.authorIdentity.name}
                  {message.authorIdentity.isAgent ? " · AI" : ""}
                </p>
                <p className="whitespace-pre-wrap break-words leading-5">
                  {message.body}
                </p>
                <div className="flex gap-1">
                  <button
                    className={`${controlClass} text-primary`}
                    disabled={Boolean(working)}
                    onClick={() => void review(message._id, "active")}
                    type="button"
                  >
                    Approve
                  </button>
                  <button
                    className={controlClass}
                    disabled={Boolean(working)}
                    onClick={() => void review(message._id, "hidden")}
                    type="button"
                  >
                    Hide
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              No pending messages.
            </p>
          )}
          {pending && !pending.isDone ? (
            <p className="text-xs text-muted-foreground">
              Showing the first 20. Review these to reveal more.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
