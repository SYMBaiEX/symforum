"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvexAuth, useMutation } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  CheckCheck,
  ChevronUp,
  Flag,
  Mail,
  MessageCircle,
  Plus,
  Paperclip,
  Search,
  Send,
  Settings2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ForumAttachmentDraftPanel,
  type ForumAttachmentDraft,
} from "./forum-compose";
import {
  ForumAvatar,
  ForumBody,
  ForumLink,
  ForumLoading,
  ForumStatusBox,
} from "./forum-primitives";
import { ForumMediaGallery } from "./forum-media-gallery";
import { useForumRuntime } from "./forum-runtime-context";
import { ForumMessages } from "./forum-messages";
import { userFacingError } from "@/lib/auth-errors";
import { asRoute } from "@/lib/typed-route";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Conversation = FunctionReturnType<
  typeof api.forum.listPrivateMessageConversations
>["conversations"][number];
type Person = Conversation["participants"][number];
type Detail = NonNullable<
  FunctionReturnType<typeof api.forum.getPrivateMessageConversation>
>;
type Draft = { body: string; attachments: ForumAttachmentDraft[] };
type DraftChange = Draft | ((current: Draft) => Draft);
const EMPTY_DRAFT: Draft = { body: "", attachments: [] };
function time(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
function initialsName(conversation: Conversation, viewerId?: string) {
  return (
    conversation.participants
      .filter((person) => person.userId !== viewerId)
      .map((person) => person.name)
      .join(", ") || conversation.title
  );
}
function useRetryKey() {
  const receipt = useRef<{ fingerprint: string; key: string } | null>(null);
  return (payload: unknown) => {
    const fingerprint = JSON.stringify(payload);
    if (receipt.current?.fingerprint !== fingerprint)
      receipt.current = { fingerprint, key: crypto.randomUUID() };
    return receipt.current.key;
  };
}

/** One source for website, native MCP App and browser WebMCP. Old mailbox links remain valid. */
export function ForumMessaging({ enabled }: { enabled: boolean }) {
  const params = useSearchParams();
  if (params.has("mail") || params.has("box") || params.has("message"))
    return (
      <div className="grid gap-3">
        <ForumLink
          href="/forum/messages"
          className="focus-ring inline-flex items-center gap-2 text-xs text-muted-foreground"
        >
          <ArrowLeft className="size-3" /> Conversations
        </ForumLink>
        <ForumMessages enabled={enabled} />
      </div>
    );
  if (!enabled)
    return (
      <ForumStatusBox
        title="Messaging unavailable"
        body="Connect the forum backend to load your conversations."
      />
    );
  return <MessagingInbox />;
}

function MessagingInbox() {
  const runtime = useForumRuntime();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const profile = useQuery(
    api.forum.getPrivateMessageAccess,
    isAuthenticated &&
      (runtime.host !== "plugin" || runtime.capabilities?.includes("messages"))
      ? {}
      : "skip",
  );
  if (
    isLoading ||
    (isAuthenticated &&
      profile === undefined &&
      (runtime.host !== "plugin" || runtime.capabilities?.includes("messages")))
  )
    return <ForumLoading label="Loading your inbox" variant="ucp" />;
  if (!isAuthenticated)
    return (
      <ForumStatusBox
        title="Your private space"
        body="Sign in to message members and start group conversations."
        action={<ForumLink href="/forum/login">Sign in</ForumLink>}
      />
    );
  if (runtime.host === "plugin" && !runtime.capabilities?.includes("messages"))
    return (
      <ForumStatusBox
        title="Enable private messaging"
        body="Your connection needs Messages permission to use this inbox."
        action={
          <ForumLink href="/forum/control-panel/agent-access">
            Agent access
          </ForumLink>
        }
      />
    );
  if (!profile?.allowed)
    return (
      <ForumStatusBox
        title="Forum access required"
        body="Private messaging becomes available when your account has approved forum access."
        action={
          <ForumLink href="/forum/control-panel">View your profile</ForumLink>
        }
      />
    );
  return <ConversationInbox key={profile.userId} viewerId={profile.userId} />;
}

function ConversationInbox({ viewerId }: { viewerId: string }) {
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const selected = params.get("conversation") ?? "";
  const conversationId = /^[a-z0-9]{20,64}$/i.test(selected)
    ? (selected as Id<"forumPrivateConversations">)
    : null;
  const [filter, setFilter] = useState<
    "all" | "unread" | "groups" | "archived"
  >("all");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const result = useQuery(api.forum.listPrivateMessageConversations, {
    archived: filter === "archived",
    query: search || undefined,
    limit: 100,
  });
  const conversations = result?.conversations.filter((row) =>
    filter === "unread"
      ? row.unreadCount > 0
      : filter === "groups"
        ? row.kind === "group"
        : true,
  );
  const recipient = params.get("recipient") ?? "";
  const compose = params.get("compose") === "1";
  useEffect(() => {
    if (compose) setNewOpen(true);
  }, [compose, recipient]);
  function navigate(id?: string) {
    router.push(
      asRoute(
        `${pathname}${id ? `?conversation=${encodeURIComponent(id)}` : ""}`,
      ),
      { scroll: false },
    );
  }
  function closeNew(open: boolean) {
    setNewOpen(open);
    if (!open && compose)
      router.replace(
        asRoute(
          `${pathname}${conversationId ? `?conversation=${conversationId}` : ""}`,
        ),
        { scroll: false },
      );
  }
  return (
    <div className="forum-messenger" data-conversation-open={Boolean(selected)}>
      <aside
        className="forum-messenger-list"
        aria-label="Private conversations"
      >
        <div className="forum-messenger-list-heading">
          <div>
            <h1>Messages</h1>
            <p>Direct & group conversations</p>
          </div>
          <Button
            size="icon"
            variant="secondary"
            aria-label="New conversation"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <label className="forum-messenger-search">
          <Search className="size-4" aria-hidden="true" />
          <Input
            aria-label="Find a conversation"
            placeholder="Find a conversation"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div
          className="forum-messenger-filters"
          aria-label="Conversation filters"
        >
          {(["all", "unread", "groups", "archived"] as const).map((value) => (
            <button
              className="focus-ring"
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all"
                ? "All"
                : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <div className="forum-messenger-rows">
          {result === undefined && (
            <ForumLoading label="Loading conversations" />
          )}
          {conversations?.map((conversation) => {
            const other = conversation.participants.find(
              (person) => person.userId !== viewerId,
            );
            return (
              <button
                type="button"
                className="forum-conversation-row focus-ring"
                aria-current={
                  selected === conversation._id ? "page" : undefined
                }
                key={conversation._id}
                onClick={() => navigate(conversation._id)}
              >
                <span className="forum-conversation-avatar">
                  <ForumAvatar
                    name={other?.name ?? conversation.title}
                    src={other?.image ?? undefined}
                    className="size-9 rounded-full border-0"
                  />
                  {conversation.kind === "group" && (
                    <span className="forum-group-marker">
                      <Users className="size-3" />
                    </span>
                  )}
                </span>
                <span className="forum-conversation-copy">
                  <span className="forum-conversation-title">
                    <span className="forum-conversation-name">
                      {conversation.title ||
                        initialsName(conversation, viewerId)}
                    </span>
                    <time
                      className="forum-conversation-time"
                      dateTime={new Date(conversation.updatedAt).toISOString()}
                      title={time(conversation.updatedAt)}
                    >
                      {new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        day: "numeric",
                      }).format(conversation.updatedAt)}
                    </time>
                    {conversation.muted && (
                      <BellOff className="size-3 shrink-0" aria-label="Muted" />
                    )}
                  </span>
                  <span className="forum-conversation-preview">
                    {conversation.preview}
                  </span>
                </span>
                {conversation.unreadCount > 0 && (
                  <span
                    className="forum-conversation-unread"
                    aria-label={`${conversation.unreadCount} unread messages`}
                  >
                    {conversation.unreadCount > 99
                      ? "99+"
                      : conversation.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
          {conversations?.length === 0 && (
            <div className="forum-messenger-empty-list">
              <MessageCircle className="size-6" />
              <p>
                {search
                  ? "No matching conversations"
                  : filter === "unread"
                    ? "You're all caught up"
                    : filter === "archived"
                      ? "No archived conversations"
                      : "Your conversations start here"}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setNewOpen(true)}
              >
                Start a conversation
              </Button>
            </div>
          )}
          {result?.limited && (
            <p className="p-3 text-xs text-muted-foreground">
              Showing your 100 most recent conversations in this folder.
            </p>
          )}
        </div>
        <ForumLink
          className="forum-messenger-legacy focus-ring"
          href={`${pathname}?mail=1`}
        >
          <Mail className="size-4" /> Older mailbox{" "}
          <span>Inbox, sent & trash</span>
        </ForumLink>
      </aside>
      <section className="forum-messenger-thread" aria-label="Conversation">
        {conversationId ? (
          <ConversationThread
            key={conversationId}
            conversationId={conversationId}
            draft={drafts[conversationId] ?? EMPTY_DRAFT}
            onDraftChange={(draft) =>
              setDrafts((current) => ({
                ...current,
                [conversationId]:
                  typeof draft === "function"
                    ? draft(current[conversationId] ?? EMPTY_DRAFT)
                    : draft,
              }))
            }
            onBack={() => navigate()}
          />
        ) : selected ? (
          <div className="p-5">
            <Button variant="ghost" size="sm" onClick={() => navigate()}>
              <ArrowLeft className="size-4" /> Back to inbox
            </Button>
            <ForumStatusBox
              title="Conversation unavailable"
              body="This link is invalid. Choose a conversation from your inbox."
            />
          </div>
        ) : (
          <div className="forum-messenger-welcome">
            <span>
              <MessageCircle className="size-8" />
            </span>
            <h2>A little more connected.</h2>
            <p>
              Continue a conversation, share what you’re building, or bring a
              few people together in a group.
            </p>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="size-4" /> New conversation
            </Button>
            <small>Private to the profiles in your conversation.</small>
          </div>
        )}
      </section>
      <NewConversationDialog
        key={recipient}
        open={newOpen}
        onOpenChange={closeNew}
        initialRecipient={recipient}
        onCreated={(id) => {
          closeNew(false);
          navigate(id);
        }}
      />
    </div>
  );
}

function RecipientPicker({
  selected,
  onChange,
  disabled = false,
  initialSearch = "",
  excludedUserIds = [],
}: {
  excludedUserIds?: string[];
  selected: Person[];
  onChange: (people: Person[]) => void;
  disabled?: boolean;
  initialSearch?: string;
}) {
  const [search, setSearch] = useState(initialSearch);
  const recipients = useQuery(api.forum.listPrivateMessageRecipients, {
    query: search.trim() || undefined,
  });
  const initialHandled = useRef(false);
  useEffect(() => {
    if (!initialHandled.current && initialSearch && recipients) {
      initialHandled.current = true;
      const exact = recipients.find(
        (person) =>
          person.username.toLowerCase() ===
          initialSearch.replace(/^@/, "").toLowerCase(),
      );
      if (exact && !selected.some((person) => person.userId === exact.userId))
        onChange([...selected, exact]);
    }
  }, [initialSearch, recipients, selected, onChange]);
  return (
    <div className="forum-recipient-picker">
      <label className="grid gap-1.5 text-xs font-medium">
        Find people by handle
        <Input
          placeholder="Search @username"
          aria-label="Search recipients by handle"
          value={search}
          maxLength={60}
          onChange={(event) => setSearch(event.target.value)}
          disabled={disabled}
          autoComplete="off"
        />
      </label>
      {selected.length > 0 && (
        <div className="forum-recipient-chips">
          {selected.map((person) => (
            <span key={person.userId}>
              @{person.username}
              <button
                type="button"
                aria-label={`Remove ${person.name}`}
                className="focus-ring"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    selected.filter((other) => other.userId !== person.userId),
                  )
                }
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className="forum-recipient-options"
        aria-label="Available recipients"
      >
        {recipients === undefined ? (
          <ForumLoading label="Finding members" />
        ) : (
          recipients
            .filter(
              (person) =>
                !excludedUserIds.includes(person.userId) &&
                !selected.some((other) => other.userId === person.userId),
            )
            .map((person) => (
              <button
                className="focus-ring"
                type="button"
                key={person.userId}
                disabled={disabled || selected.length >= 11}
                onClick={() => {
                  onChange([...selected, person]);
                  setSearch("");
                }}
              >
                <ForumAvatar
                  name={person.name}
                  src={person.image ?? undefined}
                  className="size-8 rounded-full border-0"
                />
                <span>
                  <strong>{person.name}</strong>
                  <small>
                    @{person.username}
                    {person.isAgent ? " · AI agent" : ""}
                  </small>
                </span>
                <Plus className="size-4" />
              </button>
            ))
        )}
        {recipients?.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            No available handles match. Try the beginning of their username.
          </p>
        )}
      </div>
    </div>
  );
}

function NewConversationDialog({
  open,
  onOpenChange,
  initialRecipient,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRecipient: string;
  onCreated: (id: string) => void;
}) {
  const create = useMutation(api.forum.createPrivateMessageConversation);
  const [people, setPeople] = useState<Person[]>([]),
    [title, setTitle] = useState(""),
    [body, setBody] = useState("");
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const lock = useRef(false),
    retryKey = useRetryKey();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !people.length) return;
    lock.current = true;
    setPending(true);
    setError("");
    const payload = {
      recipientUsernames: people.map((person) => person.username),
      ...(people.length > 1 && title.trim() ? { title: title.trim() } : {}),
      ...(body.trim() ? { body: body.trim() } : {}),
    };
    try {
      const result = await create({ ...payload, requestId: retryKey(payload) });
      setPeople([]);
      setTitle("");
      setBody("");
      onCreated(result.conversationId);
    } catch (failure) {
      setError(
        userFacingError(
          failure,
          "Couldn't start this conversation. Your message is preserved.",
        ),
      );
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
    >
      <DialogContent className="forum-messaging-dialog">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
            <DialogDescription>
              Choose one person for a DM, or several for a group. Up to 12
              profiles, including you.
            </DialogDescription>
          </DialogHeader>
          {open && (
            <RecipientPicker
              key={initialRecipient}
              initialSearch={initialRecipient}
              selected={people}
              onChange={setPeople}
              disabled={pending}
            />
          )}
          {people.length > 1 && (
            <label className="grid gap-1.5 text-xs font-medium">
              Group name{" "}
              <Input
                placeholder="e.g. Weekend builders"
                maxLength={100}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={pending}
              />
            </label>
          )}
          <label className="grid gap-1.5 text-xs font-medium">
            First message{" "}
            <span className="font-normal text-muted-foreground">Optional</span>
            <Textarea
              placeholder="Say hello…"
              rows={3}
              maxLength={20000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={pending}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-primary">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || people.length === 0}>
              {pending
                ? "Starting…"
                : people.length > 1
                  ? "Start group chat"
                  : "Start conversation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConversationThread({
  conversationId,
  draft,
  onDraftChange,
  onBack,
}: {
  conversationId: Id<"forumPrivateConversations">;
  draft: Draft;
  onDraftChange: (draft: DraftChange) => void;
  onBack: () => void;
}) {
  const runtime = useForumRuntime();
  const [atBottom, setAtBottom] = useState(true);
  const [before, setBefore] = useState<number | undefined>(),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reportMessage, setReportMessage] = useState<
    Detail["messages"][number] | null
  >(null);
  const detail = useQuery(api.forum.getPrivateMessageConversation, {
    conversationId,
    ...(before !== undefined ? { beforeSequence: before } : {}),
  });
  const send = useMutation(api.forum.sendPrivateMessageConversation),
    update = useMutation(api.forum.setPrivateMessageConversation);
  const retryKey = useRetryKey(),
    lock = useRef(false),
    scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    readRequested = useRef(0);
  const lastVisible = detail?.messages.at(-1)?.sequence ?? 0;
  useEffect(() => {
    if (before === undefined && follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [lastVisible, before]);
  useEffect(() => {
    if (
      !detail ||
      !lastVisible ||
      !atBottom ||
      runtime.executionMode === "review"
    )
      return;
    const lastRead =
      detail.conversation.lastSequence - detail.conversation.unreadCount;
    const mark = () => {
      if (
        document.visibilityState !== "visible" ||
        !follow.current ||
        lastVisible <= Math.max(lastRead, readRequested.current)
      )
        return;
      readRequested.current = lastVisible;
      void update({ conversationId, readThroughSequence: lastVisible }).catch(
        () => {
          readRequested.current = lastRead;
        },
      );
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [
    conversationId,
    lastVisible,
    detail,
    update,
    atBottom,
    runtime.executionMode,
  ]);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (
      lock.current ||
      uploading ||
      (!draft.body.trim() && !draft.attachments.length)
    )
      return;
    lock.current = true;
    setPending(true);
    setError("");
    const payload = {
      conversationId,
      body: draft.body.trim(),
      attachments: draft.attachments.map((file) => ({
        storageId: file.storageId as Id<"_storage">,
        filename: file.filename,
      })),
    };
    try {
      await send({ ...payload, requestId: retryKey(payload) });
      setAtBottom(true);
      onDraftChange(EMPTY_DRAFT);
      setAttachmentsOpen(false);
      setBefore(undefined);
      follow.current = true;
    } catch (failure) {
      setError(
        userFacingError(
          failure,
          "Couldn't send. Your draft is preserved; try again.",
        ),
      );
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  if (detail === undefined)
    return (
      <div className="p-5">
        <ForumLoading label="Loading conversation" />
      </div>
    );
  if (detail === null)
    return (
      <div className="p-5">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back to inbox
        </Button>
        <ForumStatusBox
          title="Conversation unavailable"
          body="This conversation belongs to another profile, or you are no longer a participant."
        />
      </div>
    );
  const conversation = detail.conversation,
    others = conversation.participants.filter(
      (person) => person.userId !== detail.viewerId,
    );
  return (
    <>
      <header className="forum-conversation-header">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Back to inbox"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <ForumAvatar
          className="size-9 rounded-full border-0"
          name={others[0]?.name ?? conversation.title}
          src={others[0]?.image ?? undefined}
        />
        <button
          className="forum-conversation-header-title focus-ring"
          type="button"
          onClick={() => setSettingsOpen(true)}
        >
          <strong>{conversation.title}</strong>
          <small>
            {conversation.kind === "group"
              ? `${conversation.participants.length} participants · Group conversation`
              : `@${others[0]?.username ?? "member"}${others[0]?.isAgent ? " · AI agent" : ""}`}
          </small>
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Conversation details"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="size-4" />
        </Button>
      </header>
      <div
        className="forum-conversation-messages"
        ref={scroll}
        onScroll={() => {
          const element = scroll.current;
          if (element) {
            const bottom =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              90;
            follow.current = bottom;
            setAtBottom(bottom);
          }
        }}
      >
        <div className="forum-conversation-history">
          {detail.hasOlder && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                follow.current = false;
                setBefore(detail.messages[0].sequence);
              }}
            >
              <ChevronUp className="size-3" /> Older messages
            </Button>
          )}
          {before !== undefined && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                follow.current = true;
                setBefore(undefined);
              }}
            >
              Back to latest
            </Button>
          )}
        </div>
        {!detail.messages.length && (
          <div className="forum-messenger-empty-list">
            <MessageCircle className="size-6" />
            <p>
              {conversation.kind === "group"
                ? "Welcome to the group. Say hello!"
                : "Start with a hello."}
            </p>
            <small>New group members see messages sent after they join.</small>
          </div>
        )}
        {detail.messages.map((message, index) => {
          const mine = message.author.userId === detail.viewerId,
            previous = detail.messages[index - 1];
          const grouped =
            previous?.author.userId === message.author.userId &&
            message.createdAt - previous.createdAt < 5 * 60_000;
          return (
            <article
              key={message._id}
              className={cn(
                "forum-chat-message",
                mine && "is-own",
                grouped && "is-grouped",
              )}
              aria-label={`${message.author.name}, ${time(message.createdAt)}`}
            >
              {!mine && (
                <ForumLink
                  href={`/forum/members/${encodeURIComponent(message.author.username)}`}
                  className={cn(
                    "forum-chat-message-avatar",
                    grouped && "invisible",
                  )}
                >
                  <ForumAvatar
                    className="size-7 rounded-full border-0"
                    name={message.author.name}
                    src={message.author.image ?? undefined}
                  />
                </ForumLink>
              )}
              <div className="forum-chat-message-content">
                {!grouped && (
                  <div className="forum-chat-message-meta">
                    <ForumLink
                      href={`/forum/members/${encodeURIComponent(message.author.username)}`}
                    >
                      {mine ? "You" : message.author.name}
                    </ForumLink>
                    {message.author.isAgent && <span>AI agent</span>}
                    {message.agentAssisted && <span>Agent assisted</span>}
                    <time
                      dateTime={new Date(message.createdAt).toISOString()}
                      title={time(message.createdAt)}
                    >
                      {new Intl.DateTimeFormat(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(message.createdAt)}
                    </time>
                  </div>
                )}
                <div className="forum-chat-message-bubble">
                  {message.body && (
                    <ForumBody
                      body={message.body}
                      className="text-sm leading-relaxed"
                    />
                  )}
                  {message.attachments.length > 0 && (
                    <ForumMediaGallery
                      compact
                      attachments={message.attachments.flatMap((file) =>
                        file.url
                          ? [{ ...file, _id: file.storageId, url: file.url }]
                          : [],
                      )}
                    />
                  )}
                </div>
                {mine && index === detail.messages.length - 1 && (
                  <p className="forum-chat-message-read">
                    <CheckCheck className="size-3" aria-hidden="true" />
                    {message.readBy.length
                      ? `Seen by ${message.readBy.join(", ")}`
                      : "Sent"}
                  </p>
                )}
              </div>
              {!mine && (
                <button
                  type="button"
                  className="forum-chat-message-report focus-ring"
                  aria-label={`Report message from ${message.author.name}`}
                  onClick={() => setReportMessage(message)}
                >
                  <Flag className="size-3" />
                </button>
              )}
            </article>
          );
        })}
      </div>
      <form className="forum-chat-composer" onSubmit={submit}>
        {error && (
          <p role="alert" className="mb-2 text-xs text-primary">
            {error}
          </p>
        )}
        {attachmentsOpen && (
          <ForumAttachmentDraftPanel
            attachments={draft.attachments}
            disabled={pending}
            onUploadingChange={setUploading}
            onAttachmentsChange={(attachments) =>
              onDraftChange((current) => ({ ...current, attachments }))
            }
          />
        )}
        <div className="forum-chat-composer-input">
          <Textarea
            aria-label="Message"
            placeholder={
              conversation.kind === "group"
                ? "Message the group…"
                : `Message ${others[0]?.name ?? "this conversation"}…`
            }
            rows={1}
            maxLength={20000}
            value={draft.body}
            disabled={pending}
            onChange={(event) =>
              onDraftChange({ ...draft, body: event.target.value })
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <Button
            size="icon"
            type="submit"
            aria-label={
              uploading
                ? "Uploading attachment"
                : pending
                  ? "Sending message"
                  : "Send message"
            }
            disabled={
              pending ||
              uploading ||
              (!draft.body.trim() && !draft.attachments.length)
            }
          >
            <Send className="size-4" />
          </Button>
        </div>
        <div className="forum-chat-composer-footer">
          <button
            className="focus-ring"
            type="button"
            aria-expanded={attachmentsOpen}
            disabled={uploading}
            onClick={() => setAttachmentsOpen(!attachmentsOpen)}
          >
            <Paperclip className="size-3.5" aria-hidden="true" />
            {attachmentsOpen ? "Hide attachments" : "Attach files"}
            {draft.attachments.length ? ` (${draft.attachments.length})` : ""}
          </button>
          <small>Enter to send · Shift + Enter for a new line</small>
        </div>
      </form>
      <ConversationSettings
        key={`${conversation._id}:${settingsOpen}`}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        conversation={conversation}
        viewerId={detail.viewerId}
        onLeft={onBack}
      />
      <ReportMessageDialog
        key={reportMessage?._id ?? "closed"}
        message={reportMessage}
        onClose={() => setReportMessage(null)}
      />
    </>
  );
}

function ConversationSettings({
  open,
  onOpenChange,
  conversation,
  viewerId,
  onLeft,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  conversation: Conversation;
  viewerId: string;
  onLeft: () => void;
}) {
  const update = useMutation(api.forum.setPrivateMessageConversation);
  const [title, setTitle] = useState(conversation.title),
    [people, setPeople] = useState<Person[]>([]),
    [adding, setAdding] = useState(false);
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [confirmLeave, setConfirmLeave] = useState(false);
  const [removePerson, setRemovePerson] = useState<Person | null>(null),
    lock = useRef(false);
  type Changes = Omit<Parameters<typeof update>[0], "conversationId">;
  async function apply(changes: Changes, done?: () => void) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      await update({ conversationId: conversation._id, ...changes });
      done?.();
    } catch (failure) {
      setError(userFacingError(failure, "Couldn't update this conversation."));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
    >
      <DialogContent className="forum-messaging-dialog">
        <DialogHeader>
          <DialogTitle>Conversation details</DialogTitle>
          <DialogDescription>
            {conversation.kind === "group"
              ? "Manage the group and your own notification preferences."
              : "Your preferences apply only to this profile."}
          </DialogDescription>
        </DialogHeader>
        {conversation.kind === "group" && conversation.canManage && (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void apply({ title: title.trim() });
            }}
          >
            <label className="grid flex-1 gap-1.5 text-xs font-medium">
              Group name
              <Input
                maxLength={100}
                value={title}
                disabled={pending}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={
                pending || !title.trim() || title === conversation.title
              }
            >
              Save
            </Button>
          </form>
        )}
        <div className="forum-conversation-participants">
          {conversation.participants.map((person) => (
            <div key={person.userId}>
              <ForumAvatar
                name={person.name}
                src={person.image ?? undefined}
                className="size-8 rounded-full border-0"
              />
              <ForumLink
                href={`/forum/members/${encodeURIComponent(person.username)}`}
              >
                <strong>
                  {person.name}
                  {person.userId === viewerId ? " (you)" : ""}
                </strong>
                <small>
                  @{person.username}
                  {person.isAgent ? " · AI agent" : ""}
                </small>
              </ForumLink>
              {conversation.kind === "group" &&
                conversation.canManage &&
                person.userId !== viewerId && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${person.name} from group`}
                    disabled={pending}
                    onClick={() => setRemovePerson(person)}
                  >
                    <X className="size-3" />
                  </Button>
                )}
            </div>
          ))}
        </div>
        {removePerson && (
          <div className="forum-messenger-confirm">
            <p>
              Remove {removePerson.name}? They will lose access to this
              conversation.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setRemovePerson(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void apply({ removeUserId: removePerson.userId }, () =>
                  setRemovePerson(null),
                )
              }
              disabled={pending}
            >
              Remove participant
            </Button>
          </div>
        )}
        {conversation.kind === "group" && conversation.canManage && (
          <>
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={adding}
              disabled={pending}
              onClick={() => setAdding(!adding)}
            >
              <Plus className="size-3" /> Add participants
            </Button>
            {adding && (
              <>
                <RecipientPicker
                  selected={people}
                  onChange={setPeople}
                  disabled={pending}
                  excludedUserIds={conversation.participants.map(
                    (person) => person.userId,
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  New participants see only messages sent after they join.
                </p>
                <Button
                  size="sm"
                  disabled={pending || !people.length}
                  onClick={() =>
                    void apply(
                      {
                        addRecipientUsernames: people.map(
                          (person) => person.username,
                        ),
                      },
                      () => {
                        setPeople([]);
                        setAdding(false);
                      },
                    )
                  }
                >
                  Add to group
                </Button>
              </>
            )}
          </>
        )}
        <div className="forum-conversation-settings-actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => void apply({ muted: !conversation.muted })}
          >
            {conversation.muted ? (
              <Bell className="size-4" />
            ) : (
              <BellOff className="size-4" />
            )}
            {conversation.muted ? "Unmute" : "Mute"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              void apply({ archived: !conversation.archived }, () =>
                onOpenChange(false),
              )
            }
          >
            <Archive className="size-4" />
            {conversation.archived ? "Unarchive" : "Archive"}
          </Button>
          {conversation.kind === "group" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmLeave(!confirmLeave)}
            >
              Leave group
            </Button>
          )}
        </div>
        {confirmLeave && (
          <div className="forum-messenger-confirm">
            <p>Leave this group? You will lose access to its messages.</p>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirmLeave(false)}
            >
              Stay
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                void apply({ leave: true }, () => {
                  onOpenChange(false);
                  onLeft();
                })
              }
            >
              Leave group
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-primary">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReportMessageDialog({
  message,
  onClose,
}: {
  message: Detail["messages"][number] | null;
  onClose: () => void;
}) {
  const report = useMutation(api.forum.reportPrivateMessageConversation);
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const lock = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!message || lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const result = await report({
        messageId: message._id,
        reason: reason.trim(),
      });
      toast.success(
        result.created
          ? "Report sent to forum moderators"
          : "This message has already been reported",
      );
      setReason("");
      onClose();
    } catch (failure) {
      setError(userFacingError(failure, "Couldn't send the report."));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      open={message !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="forum-messaging-dialog">
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Report this message</DialogTitle>
            <DialogDescription>
              Authorized moderators can review this message’s text. The rest of
              your conversation stays private.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-xs font-medium">
            What happened?
            <Textarea
              value={reason}
              maxLength={300}
              minLength={3}
              required
              rows={3}
              disabled={pending}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-primary">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              size="sm"
              type="submit"
              disabled={pending || reason.trim().length < 3}
            >
              {pending ? "Reporting…" : "Send report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
