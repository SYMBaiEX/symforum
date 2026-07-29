"use client";

import { reportAppError } from "@/components/app-error-surface";
import { ForumCompose } from "@/components/forum/forum-compose";
import {
  forumRefs,
  formatForumDateTime,
  type ForumPrivateMessageBox,
  type ForumPrivateMessageRecord,
} from "@/components/forum/forum-refs";
import {
  ForumBody,
  ForumLink,
  ForumLoading,
  ForumMetricBar,
  ForumPaginationBar,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { userFacingError } from "@/lib/auth-errors";
import { cn } from "@/lib/utils";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

export function ForumMessages({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body="Convex is not configured locally, so private messages cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumMessages />;
}

function LiveForumMessages() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const box = parseMessageBox(searchParams.get("box"));
  const page = parseMessagePage(searchParams.get("page"));
  const searchQuery = normalizeMessageSearch(searchParams.get("q"));
  const selectedMessageId = searchParams.get("message");
  const profile = useQuery(
    forumRefs.getMyForumProfile,
    isAuthenticated ? {} : "skip",
  );
  const canUsePrivateMessages = profile?.trusted === true;
  const messages = useQuery(
    forumRefs.listPrivateMessages,
    canUsePrivateMessages
      ? { box, page, pageSize: 40, query: searchQuery || undefined }
      : "skip",
  );
  const relationships = useQuery(
    forumRefs.listMyForumRelationships,
    canUsePrivateMessages ? { limit: 40 } : "skip",
  );
  const selectedMessage = useQuery(
    forumRefs.getPrivateMessage,
    canUsePrivateMessages && selectedMessageId
      ? { messageId: selectedMessageId, box }
      : "skip",
  );
  const sendPrivateMessage = useMutation(forumRefs.sendPrivateMessage);
  const markPrivateMessageRead = useMutation(forumRefs.markPrivateMessageRead);
  const deletePrivateMessage = useMutation(forumRefs.deletePrivateMessage);
  const restorePrivateMessage = useMutation(forumRefs.restorePrivateMessage);
  const createPrivateMessageReport = useMutation(
    forumRefs.createPrivateMessageReport,
  );
  const [recipientUsername, setRecipientUsername] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendPending, setSendPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [reportPending, setReportPending] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [messagePreviewOpen, setMessagePreviewOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const [invalidField, setInvalidField] = useState<
    "recipient" | "subject" | "body" | null
  >(null);
  const [deleteConfirmMessageId, setDeleteConfirmMessageId] = useState<
    string | null
  >(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkActionPending, setBulkActionPending] = useState<
    "delete" | "read" | "restore" | null
  >(null);
  const [reportMessage, setReportMessage] =
    useState<ForumPrivateMessageRecord | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportError, setReportError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recipientPickerFocused, setRecipientPickerFocused] = useState(false);
  const [activeRecipientSuggestionIndex, setActiveRecipientSuggestionIndex] =
    useState(0);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const recipientInputRef = useRef<HTMLInputElement | null>(null);

  const selectedListRecord = useMemo(
    () =>
      messages?.messages.find((message) => message._id === selectedMessageId),
    [messages?.messages, selectedMessageId],
  );
  const visibleMessage = selectedMessage ?? selectedListRecord ?? null;
  const visibleMessageIds = useMemo(
    () => messages?.messages.map((message) => message._id) ?? [],
    [messages?.messages],
  );
  const visibleMessageIdsKey = useMemo(
    () => visibleMessageIds.join("|"),
    [visibleMessageIds],
  );
  const selectedMessages = useMemo(
    () =>
      messages?.messages.filter((message) =>
        selectedMessageIds.has(message._id),
      ) ?? [],
    [messages?.messages, selectedMessageIds],
  );
  const selectedUnreadInboxMessages = useMemo(
    () =>
      selectedMessages.filter(
        (message) => message.box === "inbox" && message.unread,
      ),
    [selectedMessages],
  );
  const selectedMessageCount = selectedMessages.length;
  const allVisibleMessagesSelected =
    visibleMessageIds.length > 0 &&
    visibleMessageIds.every((messageId) => selectedMessageIds.has(messageId));
  const recipientSuggestions = useMemo(() => {
    const suggestions: RecipientSuggestion[] = [];
    const seen = new Set<string>();
    const addSuggestion = (suggestion: RecipientSuggestion) => {
      const normalizedUsername = normalizeRecipientLookupValue(
        suggestion.username,
      );
      if (!normalizedUsername || seen.has(normalizedUsername)) {
        return;
      }
      seen.add(normalizedUsername);
      suggestions.push(suggestion);
    };

    for (const buddy of relationships?.buddies ?? []) {
      addSuggestion({
        username: buddy.username,
        title: buddy.username,
        detail:
          buddy.displayName && buddy.displayName !== buddy.username
            ? buddy.displayName
            : "Buddy",
        source: "buddy",
      });
    }

    const recentMessages = [...(messages?.messages ?? [])].sort(
      (left, right) => right.createdAt - left.createdAt,
    );
    for (const message of recentMessages) {
      addSuggestion({
        username: message.otherUsername,
        title: message.otherUsername,
        detail: "Recent",
        source: "recent",
      });
    }

    return suggestions;
  }, [messages?.messages, relationships?.buddies]);
  const filteredRecipientSuggestions = useMemo(() => {
    const needle = normalizeRecipientLookupValue(recipientUsername);
    if (!needle) {
      return recipientSuggestions.slice(0, 10);
    }
    return recipientSuggestions
      .filter((suggestion) => recipientSuggestionMatches(suggestion, needle))
      .slice(0, 10);
  }, [recipientSuggestions, recipientUsername]);
  const showRecipientSuggestions =
    recipientPickerFocused && filteredRecipientSuggestions.length > 0;
  const signInHref = useMemo(() => {
    const query = searchParams.toString();
    const redirectTo = `${pathname ?? "/forum/messages"}${query ? `?${query}` : ""}`;
    const params = new URLSearchParams({ redirectTo });
    return `/signin?${params.toString()}`;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (
      !selectedMessage ||
      selectedMessage.box !== "inbox" ||
      !selectedMessage.unread
    ) {
      return;
    }
    void markPrivateMessageRead({ messageId: selectedMessage._id }).catch(
      (caught) => {
        reportAppError(caught, {
          scope: "forum",
          eventType: "private_message_mark_read_failed",
          component: "ForumMessages",
          action: "forum:markPrivateMessageRead",
          entityType: "forumPrivateMessage",
          entityId: selectedMessage._id,
          notify: false,
        });
      },
    );
  }, [markPrivateMessageRead, selectedMessage]);

  useEffect(() => {
    setSearchDraft(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    setSelectedMessageIds(new Set());
  }, [box, page, searchQuery, visibleMessageIdsKey]);

  useEffect(() => {
    const recipient = searchParams.get("recipient");
    const nextSubject = searchParams.get("subject");
    if (searchParams.get("compose") === "1") {
      setComposeOpen(true);
    }
    if (recipient) {
      setRecipientUsername(recipient);
      setSubject(nextSubject ?? "");
      setBody("");
      setMessagePreviewOpen(false);
      setComposeOpen(true);
      window.requestAnimationFrame(() => {
        bodyRef.current?.focus();
      });
    }
  }, [searchParams]);

  useEffect(() => {
    setDeleteConfirmMessageId(null);
  }, [box, selectedMessageId]);

  useEffect(() => {
    setActiveRecipientSuggestionIndex((current) => {
      if (filteredRecipientSuggestions.length === 0) {
        return 0;
      }
      return Math.min(current, filteredRecipientSuggestions.length - 1);
    });
  }, [filteredRecipientSuggestions]);

  if (isLoading) {
    return <ForumLoading label="Checking forum session" variant="ucp" />;
  }

  if (!isAuthenticated) {
    return (
      <ForumStatusBox
        title="Sign in required"
        body="Use a SYM handle to send and read private forum messages."
        action={
          <Button
            asChild
            className="rounded-none font-mono text-[10px] uppercase"
            variant="outline"
          >
            <Link href={signInHref}>Sign in</Link>
          </Button>
        }
      />
    );
  }

  if (profile === undefined) {
    return (
      <ForumLoading
        label="Checking forum private message access"
        variant="ucp"
      />
    );
  }

  if (!profile.trusted) {
    return (
      <ForumStatusBox
        title="Private messages locked"
        body="Private messages open after the site owner approves your forum access. You can still read public boards while your account is waiting."
        action={
          <Button
            asChild
            className="rounded-none font-mono text-[10px] uppercase"
            variant="outline"
          >
            <ForumLink href="/forum" prefetch>
              Back to forum
            </ForumLink>
          </Button>
        }
      />
    );
  }

  if (messages === undefined) {
    return <ForumLoading label="Syncing private messages" variant="ucp" />;
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (recipientUsername.trim().length === 0) {
      setInvalidField("recipient");
      setError("Add a recipient before sending.");
      return;
    }
    if (subject.trim().length === 0) {
      setInvalidField("subject");
      setError("Add a subject before sending.");
      return;
    }
    if (body.trim().length < 2) {
      setInvalidField("body");
      setError("Write a message before sending.");
      return;
    }

    setSendPending(true);
    setInvalidField(null);
    setError("");
    setNotice("");
    try {
      const result = await sendPrivateMessage({
        recipientUsername,
        subject,
        body,
      });
      setRecipientUsername("");
      setSubject("");
      setBody("");
      setMessagePreviewOpen(false);
      setNotice("Private message sent");
      setComposeOpen(false);
      router.push(messageHref("sent", result.messageId));
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "private_message_send_failed",
        component: "ForumMessages",
        action: "forum:sendPrivateMessage",
        notify: false,
      });
      setError(userFacingError(caught, "Could not send private message"));
    } finally {
      setSendPending(false);
    }
  }

  function searchMessages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(messageHref(box, undefined, 1, searchDraft));
  }

  function selectAllVisibleMessages() {
    setSelectedMessageIds(new Set(visibleMessageIds));
  }

  function clearSelectedMessages() {
    setSelectedMessageIds(new Set());
  }

  function toggleMessageSelection(messageId: string, checked: boolean) {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }
      return next;
    });
  }

  async function markSelectedMessagesRead() {
    const targetMessages = selectedUnreadInboxMessages;
    if (targetMessages.length === 0) {
      return;
    }

    setBulkActionPending("read");
    setError("");
    setNotice("");
    try {
      for (const message of targetMessages) {
        await markPrivateMessageRead({ messageId: message._id });
      }
      clearSelectedMessages();
      setNotice(
        `Marked ${targetMessages.length} private message${targetMessages.length === 1 ? "" : "s"} read`,
      );
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "private_messages_bulk_mark_read_failed",
        component: "ForumMessages",
        action: "forum:markPrivateMessageRead",
        entityType: "forumPrivateMessage",
        entityId: targetMessages[0]?._id,
        metadata: { box, selectedCount: targetMessages.length },
        notify: false,
      });
      setError(
        userFacingError(
          caught,
          "Could not mark selected private messages read",
        ),
      );
    } finally {
      setBulkActionPending(null);
    }
  }

  async function deleteSelectedMessages() {
    const targetMessages = selectedMessages;
    if (targetMessages.length === 0) {
      clearSelectedMessages();
      return;
    }

    setBulkActionPending("delete");
    setDeleteConfirmMessageId(null);
    setError("");
    setNotice("");
    try {
      for (const message of targetMessages) {
        await deletePrivateMessage({
          messageId: message._id,
          box: message.box,
        });
      }
      clearSelectedMessages();
      setNotice(
        box === "trash"
          ? `Permanently deleted ${targetMessages.length} private message${targetMessages.length === 1 ? "" : "s"}`
          : `Moved ${targetMessages.length} private message${targetMessages.length === 1 ? "" : "s"} to trash`,
      );
      if (
        selectedMessageId &&
        targetMessages.some((message) => message._id === selectedMessageId)
      ) {
        router.push(messageHref(box, undefined, page, searchQuery));
      }
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "private_messages_bulk_delete_failed",
        component: "ForumMessages",
        action: "forum:deletePrivateMessage",
        entityType: "forumPrivateMessage",
        entityId: targetMessages[0]?._id,
        metadata: { box, selectedCount: targetMessages.length },
        notify: false,
      });
      setError(userFacingError(caught, "Could not delete selected messages"));
    } finally {
      setBulkActionPending(null);
    }
  }

  async function restoreSelectedMessages() {
    const targetMessages = selectedMessages.filter(
      (message) => message.box === "trash",
    );
    if (targetMessages.length === 0) {
      clearSelectedMessages();
      return;
    }

    setBulkActionPending("restore");
    setDeleteConfirmMessageId(null);
    setError("");
    setNotice("");
    try {
      for (const message of targetMessages) {
        await restorePrivateMessage({ messageId: message._id });
      }
      clearSelectedMessages();
      setNotice(
        `Restored ${targetMessages.length} private message${targetMessages.length === 1 ? "" : "s"}`,
      );
      if (
        selectedMessageId &&
        targetMessages.some((message) => message._id === selectedMessageId)
      ) {
        router.push(messageHref(box, undefined, page, searchQuery));
      }
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "private_messages_bulk_restore_failed",
        component: "ForumMessages",
        action: "forum:restorePrivateMessage",
        entityType: "forumPrivateMessage",
        entityId: targetMessages[0]?._id,
        metadata: { box, selectedCount: targetMessages.length },
        notify: false,
      });
      setError(userFacingError(caught, "Could not restore selected messages"));
    } finally {
      setBulkActionPending(null);
    }
  }

  async function deleteMessage(message: ForumPrivateMessageRecord) {
    if (deleteConfirmMessageId !== message._id) {
      setDeleteConfirmMessageId(message._id);
      return;
    }
    setDeletePending(true);
    setError("");
    setNotice("");
    try {
      await deletePrivateMessage({ messageId: message._id, box: message.box });
      setDeleteConfirmMessageId(null);
      setNotice(
        message.box === "trash"
          ? "Private message permanently deleted"
          : "Private message moved to trash",
      );
      router.push(messageHref(message.box, undefined, page, searchQuery));
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "private_message_delete_failed",
        component: "ForumMessages",
        action: "forum:deletePrivateMessage",
        entityType: "forumPrivateMessage",
        entityId: message._id,
        notify: false,
      });
      setError(userFacingError(caught, "Could not delete private message"));
    } finally {
      setDeletePending(false);
    }
  }

  async function restoreMessage(message: ForumPrivateMessageRecord) {
    setRestorePending(true);
    setError("");
    setNotice("");
    try {
      const result = await restorePrivateMessage({ messageId: message._id });
      setNotice("Private message restored");
      router.push(messageHref(result.box, message._id));
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "private_message_restore_failed",
        component: "ForumMessages",
        action: "forum:restorePrivateMessage",
        entityType: "forumPrivateMessage",
        entityId: message._id,
        notify: false,
      });
      setError(userFacingError(caught, "Could not restore private message"));
    } finally {
      setRestorePending(false);
    }
  }

  function openReply(message: ForumPrivateMessageRecord) {
    const nextBody = buildReplyBody(message.body, message.senderUsername);
    setRecipientUsername(message.otherUsername);
    setSubject(replySubject(message.subject));
    setBody(nextBody);
    setMessagePreviewOpen(false);
    setComposeOpen(true);
    setInvalidField(null);
    setError("");
    setNotice("");
    window.requestAnimationFrame(() => {
      bodyRef.current?.focus();
      if (nextBody) {
        const caretPosition = nextBody.length;
        bodyRef.current?.setSelectionRange(caretPosition, caretPosition);
      }
    });
  }

  function openReport(message: ForumPrivateMessageRecord) {
    if (message.box !== "inbox" || message.sourceBox !== "inbox") {
      return;
    }
    setReportMessage(message);
    setReportReason("");
    setReportDetails("");
    setReportError("");
    setError("");
    setNotice("");
  }

  function closeReport() {
    setReportMessage(null);
    setReportReason("");
    setReportDetails("");
    setReportError("");
  }

  async function submitPrivateMessageReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reportMessage === null) {
      return;
    }
    if (reportReason.trim().length < 3) {
      setReportError("Add a short reason before sending this report.");
      return;
    }

    setReportPending(true);
    setReportError("");
    setNotice("");
    try {
      const result = await createPrivateMessageReport({
        messageId: reportMessage._id,
        reason: reportReason,
        details: reportDetails.trim() || undefined,
      });
      setNotice(
        result.created
          ? "Private message reported"
          : "That private message already has an open report",
      );
      closeReport();
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "private_message_report_failed",
        component: "ForumMessages",
        action: "forum:createPrivateMessageReport",
        entityType: "forumPrivateMessage",
        entityId: reportMessage._id,
        notify: false,
      });
      setReportError(
        userFacingError(caught, "Could not report private message"),
      );
    } finally {
      setReportPending(false);
    }
  }

  function updateRecipientUsername(value: string) {
    setRecipientUsername(value);
    if (invalidField === "recipient") {
      setInvalidField(null);
    }
    if (document.activeElement === recipientInputRef.current) {
      setRecipientPickerFocused(true);
    }
    setActiveRecipientSuggestionIndex(0);
  }

  function applyRecipientSuggestion(username: string) {
    updateRecipientUsername(username);
    setRecipientPickerFocused(false);
    window.requestAnimationFrame(() => {
      recipientInputRef.current?.focus();
    });
  }

  function handleRecipientKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (filteredRecipientSuggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setRecipientPickerFocused(true);
      setActiveRecipientSuggestionIndex(
        (current) => (current + 1) % filteredRecipientSuggestions.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setRecipientPickerFocused(true);
      setActiveRecipientSuggestionIndex((current) =>
        current === 0 ? filteredRecipientSuggestions.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Escape") {
      setRecipientPickerFocused(false);
      return;
    }

    if (event.key !== "Enter" || !showRecipientSuggestions) {
      return;
    }

    const activeSuggestion =
      filteredRecipientSuggestions[activeRecipientSuggestionIndex];
    if (!activeSuggestion) {
      return;
    }

    const typedRecipient = normalizeRecipientLookupValue(recipientUsername);
    if (
      typedRecipient ===
      normalizeRecipientLookupValue(activeSuggestion.username)
    ) {
      return;
    }

    event.preventDefault();
    applyRecipientSuggestion(activeSuggestion.username);
  }

  return (
    <div className="space-y-4">
      <ForumMetricBar
        items={[
          {
            label: "Unread",
            value: messages.unreadCountLimited
              ? `${messages.unreadCount}+`
              : messages.unreadCount,
          },
          { label: "Mailbox", value: mailboxLabel(box) },
          {
            label: "PM storage",
            value: messages.quota.limited
              ? `${messages.quota.used}+/${messages.quota.limit}`
              : `${messages.quota.used}/${messages.quota.limit}`,
          },
          {
            label: "Shown",
            value: messages.messagesLimited
              ? `${messages.messages.length}+`
              : messages.messages.length,
          },
        ]}
      />
      <div className="border border-row-border p-3">
        <div className="h-2 border border-row-border">
          <div
            aria-hidden="true"
            className="h-full bg-primary"
            style={{ width: `${messages.quota.percent}%` }}
          />
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          className="rounded-none font-mono text-[10px] uppercase"
          type="button"
          variant={composeOpen ? "default" : "outline"}
          onClick={() => {
            setComposeOpen((current) => {
              const next = !current;
              if (!next) {
                setMessagePreviewOpen(false);
              }
              return next;
            });
          }}
        >
          {composeOpen ? "Hide compose" : "Compose message"}
        </Button>
      </div>
      {notice ? (
        <p
          aria-live="polite"
          className="border border-row-border p-3 font-mono text-[10px] uppercase text-muted-foreground"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      {error && !composeOpen ? (
        <p
          className="border border-row-border p-3 text-sm text-primary"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {messages.unreadCountLimited || messages.messagesLimited ? (
        <p
          aria-live="polite"
          className="border border-row-border p-3 text-sm leading-6 text-muted-foreground"
          role="status"
        >
          This mailbox has more history. Use the message pager to move through
          older undeleted messages.
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
        <section className="border border-row-border">
          <div className="flex flex-wrap gap-1 border-b border-row-border p-3">
            <MailboxTab
              box="inbox"
              currentBox={box}
              query={searchQuery}
              unreadCount={messages.unreadCount}
              unreadCountLimited={messages.unreadCountLimited}
            />
            <MailboxTab box="sent" currentBox={box} query={searchQuery} />
            <MailboxTab box="trash" currentBox={box} query={searchQuery} />
          </div>
          <form
            className="flex flex-wrap gap-2 border-b border-row-border p-3"
            onSubmit={searchMessages}
          >
            <Input
              className="min-w-0 flex-1 rounded-none border-row-border"
              maxLength={120}
              placeholder="Search messages"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
            <Button
              className="rounded-none font-mono text-[10px] uppercase"
              type="submit"
              variant="outline"
            >
              Search
            </Button>
            {searchQuery ? (
              <Button
                asChild
                className="rounded-none font-mono text-[10px] uppercase"
                type="button"
                variant="outline"
              >
                <ForumLink href={messageHref(box)} prefetch>
                  Clear
                </ForumLink>
              </Button>
            ) : null}
          </form>
          {messages.messages.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-row-border p-3">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">
                {selectedMessageCount}/{messages.messages.length} selected
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="h-7 rounded-none px-2.5 font-mono text-[10px] uppercase"
                  disabled={
                    bulkActionPending !== null || allVisibleMessagesSelected
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={selectAllVisibleMessages}
                >
                  Select all visible
                </Button>
                <Button
                  className="h-7 rounded-none px-2.5 font-mono text-[10px] uppercase"
                  disabled={
                    bulkActionPending !== null || selectedMessageCount === 0
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={clearSelectedMessages}
                >
                  Clear selection
                </Button>
                {box === "trash" ? (
                  <Button
                    className="h-7 rounded-none px-2.5 font-mono text-[10px] uppercase"
                    disabled={
                      bulkActionPending !== null || selectedMessageCount === 0
                    }
                    size="sm"
                    type="button"
                    onClick={restoreSelectedMessages}
                  >
                    {bulkActionPending === "restore"
                      ? "Restoring..."
                      : "Restore selected"}
                  </Button>
                ) : null}
                {box === "inbox" && selectedUnreadInboxMessages.length > 0 ? (
                  <Button
                    className="h-7 rounded-none px-2.5 font-mono text-[10px] uppercase"
                    disabled={bulkActionPending !== null}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={markSelectedMessagesRead}
                  >
                    {bulkActionPending === "read"
                      ? "Marking..."
                      : "Mark selected read"}
                  </Button>
                ) : null}
                <Button
                  className="h-7 rounded-none px-2.5 font-mono text-[10px] uppercase"
                  disabled={
                    bulkActionPending !== null || selectedMessageCount === 0
                  }
                  size="sm"
                  type="button"
                  variant={box === "trash" ? "outline" : "default"}
                  onClick={deleteSelectedMessages}
                >
                  {bulkActionPending === "delete"
                    ? "Deleting..."
                    : "Delete selected"}
                </Button>
              </div>
            </div>
          ) : null}
          {messages.messages.length === 0 ? (
            <div className="grid gap-3 px-4 py-4">
              <p className="text-sm text-muted-foreground">
                {searchQuery
                  ? "No private messages match this search."
                  : "No private messages in this mailbox."}
              </p>
              <div>
                <Button
                  className="rounded-none font-mono text-[10px] uppercase"
                  type="button"
                  variant="outline"
                  onClick={() => setComposeOpen(true)}
                >
                  Compose message
                </Button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-row-border">
              {messages.messages.map((message) => (
                <MessageListRow
                  key={message._id}
                  message={message}
                  page={messages.pagination.page}
                  query={searchQuery}
                  checked={selectedMessageIds.has(message._id)}
                  selectionDisabled={bulkActionPending !== null}
                  selected={message._id === selectedMessageId}
                  onSelectionChange={toggleMessageSelection}
                />
              ))}
            </div>
          )}
          <ForumPaginationBar
            buildHref={(nextPage) =>
              messageHref(box, undefined, nextPage, searchQuery)
            }
            className="border-x-0 border-b-0"
            label="Messages"
            pagination={messages.pagination}
          />
        </section>
        <section className="border border-row-border">
          {visibleMessage ? (
            <MessageDetail
              confirmDelete={deleteConfirmMessageId === visibleMessage._id}
              deletePending={deletePending}
              message={visibleMessage}
              onCancelDelete={() => setDeleteConfirmMessageId(null)}
              onDelete={() => deleteMessage(visibleMessage)}
              onReport={() => openReport(visibleMessage)}
              onReply={() => openReply(visibleMessage)}
              onRestore={() => restoreMessage(visibleMessage)}
              restorePending={restorePending}
            />
          ) : selectedMessageId ? (
            <ForumStatusBox
              title="Private message"
              body="That message is not available in this mailbox anymore."
              action={
                <Button
                  asChild
                  className="rounded-none font-mono text-[10px] uppercase"
                  variant="outline"
                >
                  <ForumLink
                    href={messageHref(box, undefined, page, searchQuery)}
                    prefetch
                  >
                    Back to mailbox
                  </ForumLink>
                </Button>
              }
            />
          ) : (
            <ForumStatusBox
              title="Private message"
              body="Choose a message from the mailbox to read it here."
            />
          )}
        </section>
      </div>
      {composeOpen ? (
        <section className="border border-row-border">
          <div className="border-b border-row-border px-4 py-3">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Compose private message
            </p>
          </div>
          <form className="grid gap-4 p-4" onSubmit={sendMessage}>
            <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
              <label className="grid gap-2">
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  To
                </span>
                <div className="relative">
                  <Input
                    ref={recipientInputRef}
                    aria-activedescendant={
                      showRecipientSuggestions
                        ? `private-message-recipient-option-${activeRecipientSuggestionIndex}`
                        : undefined
                    }
                    aria-autocomplete="list"
                    aria-controls={
                      showRecipientSuggestions
                        ? "private-message-recipient-suggestions"
                        : undefined
                    }
                    aria-describedby={
                      error ? "private-message-error" : undefined
                    }
                    aria-expanded={showRecipientSuggestions}
                    aria-invalid={invalidField === "recipient"}
                    className="rounded-none border-row-border"
                    placeholder="sym-123"
                    role="combobox"
                    value={recipientUsername}
                    onBlur={() => setRecipientPickerFocused(false)}
                    onChange={(event) =>
                      updateRecipientUsername(event.target.value)
                    }
                    onFocus={() => setRecipientPickerFocused(true)}
                    onKeyDown={handleRecipientKeyDown}
                  />
                  {showRecipientSuggestions ? (
                    <div
                      className="absolute inset-x-0 top-full z-20 mt-1 border border-row-border bg-background"
                      id="private-message-recipient-suggestions"
                      role="listbox"
                    >
                      {filteredRecipientSuggestions.map((suggestion, index) => (
                        <button
                          key={`${suggestion.source}:${suggestion.username}`}
                          aria-selected={
                            index === activeRecipientSuggestionIndex
                          }
                          className={cn(
                            "flex w-full items-center justify-between gap-3 border-b border-row-border px-3 py-2 text-left last:border-b-0",
                            index === activeRecipientSuggestionIndex
                              ? "bg-muted/55"
                              : "hover:bg-muted/35",
                          )}
                          id={`private-message-recipient-option-${index}`}
                          role="option"
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyRecipientSuggestion(suggestion.username);
                          }}
                          onMouseEnter={() =>
                            setActiveRecipientSuggestionIndex(index)
                          }
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">
                              {suggestion.title}
                            </span>
                            <span className="block truncate font-mono text-[10px] uppercase text-muted-foreground">
                              {suggestion.detail}
                            </span>
                          </span>
                          <span className="font-mono text-[10px] uppercase text-muted-foreground">
                            {suggestion.source}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </label>
              <label className="grid gap-2">
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  Subject
                </span>
                <Input
                  aria-describedby={error ? "private-message-error" : undefined}
                  aria-invalid={invalidField === "subject"}
                  className="rounded-none border-row-border"
                  maxLength={120}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </label>
            </div>
            <ForumCompose
              body={body}
              bodyAriaDescribedBy={error ? "private-message-error" : undefined}
              bodyAriaInvalid={invalidField === "body"}
              bodyLabel="Message"
              bodyMaxLength={6000}
              bodyPlaceholder="Write your private message"
              bodyRows={7}
              bodyTextareaRef={bodyRef}
              disabled={sendPending}
              error={error}
              errorId="private-message-error"
              footerActions={
                <Button
                  className="rounded-none font-mono text-[10px] uppercase"
                  disabled={body.trim().length === 0}
                  type="button"
                  variant="outline"
                  onClick={() => setMessagePreviewOpen((current) => !current)}
                >
                  {messagePreviewOpen ? "Hide preview" : "Preview"}
                </Button>
              }
              pending={sendPending}
              pendingLabel="Sending..."
              submitLabel="Send message"
              onBodyChange={setBody}
              onSubmit={() => sendMessage()}
            >
              {messagePreviewOpen ? (
                <PrivateMessagePreview body={body} />
              ) : null}
            </ForumCompose>
          </form>
        </section>
      ) : null}
      <Dialog
        open={reportMessage !== null}
        onOpenChange={(open) => {
          if (!open && !reportPending) {
            closeReport();
          }
        }}
      >
        <DialogContent className="rounded-none border-row-border sm:rounded-none">
          <DialogHeader>
            <DialogTitle>Report private message</DialogTitle>
            <DialogDescription>
              Send the message snapshot and your reason to forum moderation.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitPrivateMessageReport}>
            {reportMessage ? (
              <div className="border border-row-border p-3">
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  From {reportMessage.otherUsername}
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {reportMessage.subject}
                </p>
              </div>
            ) : null}
            <label className="grid gap-2">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Reason
              </span>
              <Input
                aria-describedby={
                  reportError ? "private-message-report-error" : undefined
                }
                aria-invalid={reportError ? true : undefined}
                className="rounded-none border-row-border"
                maxLength={160}
                placeholder="Spam, harassment, doxxing, etc."
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
              />
            </label>
            <label className="grid gap-2">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Details
              </span>
              <Textarea
                className="rounded-none border-row-border"
                maxLength={1000}
                rows={4}
                value={reportDetails}
                onChange={(event) => setReportDetails(event.target.value)}
              />
            </label>
            {reportError ? (
              <p
                className="border border-row-border p-3 text-sm text-primary"
                id="private-message-report-error"
                role="alert"
              >
                {reportError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                className="rounded-none font-mono text-[10px] uppercase"
                disabled={reportPending}
                type="button"
                variant="outline"
                onClick={closeReport}
              >
                Cancel
              </Button>
              <Button
                className="rounded-none font-mono text-[10px] uppercase"
                disabled={reportPending}
                type="submit"
              >
                {reportPending ? "Sending..." : "Send report"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MailboxTab({
  box,
  currentBox,
  query,
  unreadCount,
  unreadCountLimited,
}: {
  box: ForumPrivateMessageBox;
  currentBox: ForumPrivateMessageBox;
  query?: string;
  unreadCount?: number;
  unreadCountLimited?: boolean;
}) {
  const active = box === currentBox;
  const unreadLabel =
    unreadCount && unreadCount > 0
      ? ` (${unreadCount}${unreadCountLimited ? "+" : ""})`
      : "";
  const label = box === "inbox" ? `Inbox${unreadLabel}` : mailboxLabel(box);

  return (
    <Button
      asChild
      className={cn(
        "h-7 rounded-none px-2.5 font-mono text-[10px] uppercase",
        active && "border-foreground bg-foreground text-background",
      )}
      size="sm"
      variant="outline"
    >
      <ForumLink
        aria-current={active ? "page" : undefined}
        href={messageHref(box, undefined, 1, query)}
        prefetch
      >
        {label}
      </ForumLink>
    </Button>
  );
}

function MessageListRow({
  checked,
  message,
  onSelectionChange,
  page,
  query,
  selectionDisabled,
  selected,
}: {
  checked: boolean;
  message: ForumPrivateMessageRecord;
  onSelectionChange: (messageId: string, checked: boolean) => void;
  page: number;
  query?: string;
  selectionDisabled: boolean;
  selected: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[2.5rem_minmax(0,1fr)]",
        selected && "bg-muted/45",
        message.unread && "border-l-2 border-l-primary",
      )}
    >
      <label className="flex items-start justify-center border-r border-row-border px-3 py-3">
        <input
          aria-label={`Select private message: ${message.subject}`}
          checked={checked}
          className="mt-1 h-4 w-4"
          disabled={selectionDisabled}
          type="checkbox"
          onChange={(event) =>
            onSelectionChange(message._id, event.target.checked)
          }
        />
      </label>
      <ForumLink
        aria-current={selected ? "page" : undefined}
        className="focus-ring block min-w-0 px-4 py-3 hover:bg-muted/35"
        href={messageHref(message.box, message._id, page, query)}
        prefetch
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="line-clamp-1 text-sm font-semibold md:text-base">
            {message.subject}
          </p>
          {message.unread ? (
            <span className="font-mono text-[10px] uppercase text-primary">
              Unread
            </span>
          ) : null}
        </div>
        <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
          {message.box === "trash"
            ? `${mailboxLabel(message.sourceBox)} copy / `
            : ""}
          {messageDirectionLabel(message)} {message.otherUsername} /{" "}
          {formatForumDateTime(message.createdAt)}
          {message.trashedAt
            ? ` / Trashed ${formatForumDateTime(message.trashedAt)}`
            : ""}
        </p>
        {message.excerpt ? (
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
            {message.excerpt}
          </p>
        ) : null}
      </ForumLink>
    </div>
  );
}

function PrivateMessagePreview({ body }: { body: string }) {
  return (
    <div className="border border-row-border p-3">
      <p className="mb-3 font-mono text-[10px] uppercase text-muted-foreground">
        Preview
      </p>
      <ForumBody body={body} />
    </div>
  );
}

function MessageDetail({
  confirmDelete,
  deletePending,
  message,
  onCancelDelete,
  onDelete,
  onReport,
  onReply,
  onRestore,
  restorePending,
}: {
  confirmDelete: boolean;
  deletePending: boolean;
  message: ForumPrivateMessageRecord;
  onCancelDelete: () => void;
  onDelete: () => void;
  onReport: () => void;
  onReply: () => void;
  onRestore: () => void;
  restorePending: boolean;
}) {
  const deleteLabel =
    message.box === "trash" ? "Permanently delete" : "Move to trash";
  const confirmDeleteLabel =
    message.box === "trash" ? "Confirm permanent delete" : "Confirm move";
  return (
    <article>
      <div className="border-b border-row-border px-4 py-4">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          {message.box === "trash"
            ? `${mailboxLabel(message.sourceBox)} copy / `
            : ""}
          {messageDirectionLabel(message)} {message.otherUsername}
        </p>
        <h2 className="mt-2 text-xl font-semibold">{message.subject}</h2>
        <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
          {formatForumDateTime(message.createdAt)}
        </p>
      </div>
      <div className="px-4 py-4">
        <ForumBody body={message.body ?? message.excerpt ?? ""} />
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-row-border px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {message.box === "trash" ? (
            <Button
              className="rounded-none font-mono text-[10px] uppercase"
              disabled={deletePending || restorePending}
              type="button"
              variant="outline"
              onClick={onRestore}
            >
              {restorePending ? "Restoring..." : "Restore"}
            </Button>
          ) : null}
          <Button
            className="rounded-none font-mono text-[10px] uppercase"
            disabled={deletePending || restorePending}
            type="button"
            variant={confirmDelete ? "default" : "outline"}
            onClick={onDelete}
          >
            {deletePending
              ? "Deleting..."
              : confirmDelete
                ? confirmDeleteLabel
                : deleteLabel}
          </Button>
          {confirmDelete ? (
            <Button
              className="rounded-none font-mono text-[10px] uppercase"
              disabled={deletePending || restorePending}
              type="button"
              variant="outline"
              onClick={onCancelDelete}
            >
              Cancel
            </Button>
          ) : null}
        </div>
        <Button
          className="rounded-none font-mono text-[10px] uppercase"
          disabled={restorePending}
          type="button"
          variant="outline"
          onClick={onReply}
        >
          Reply
        </Button>
        {message.box === "inbox" && message.sourceBox === "inbox" ? (
          <Button
            className="rounded-none font-mono text-[10px] uppercase"
            type="button"
            variant="outline"
            onClick={onReport}
          >
            Report
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function parseMessageBox(value: string | null): ForumPrivateMessageBox {
  return value === "sent" || value === "trash" ? value : "inbox";
}

type RecipientSuggestion = {
  username: string;
  title: string;
  detail: string;
  source: "buddy" | "recent";
};

function parseMessagePage(value: string | null) {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeMessageSearch(value: string | null) {
  return value?.trim() ?? "";
}

function messageHref(
  box: ForumPrivateMessageBox,
  messageId?: string,
  page = 1,
  query?: string,
) {
  const params = new URLSearchParams({ box });
  const search = query?.trim();
  if (search) {
    params.set("q", search);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  if (messageId) {
    params.set("message", messageId);
  }
  return `/forum/messages?${params.toString()}`;
}

function mailboxLabel(box: ForumPrivateMessageBox) {
  if (box === "sent") {
    return "Sent";
  }
  if (box === "trash") {
    return "Trash";
  }
  return "Inbox";
}

function messageDirectionLabel(message: ForumPrivateMessageRecord) {
  return message.sourceBox === "inbox" ? "From" : "To";
}

function replySubject(subject: string) {
  const trimmedSubject = subject.trim();
  return trimmedSubject.toLowerCase().startsWith("re:")
    ? trimmedSubject
    : `Re: ${trimmedSubject}`;
}

function buildReplyBody(body: string | undefined, senderUsername: string) {
  if (!body) {
    return "";
  }
  const strippedBody = stripNestedQuotes(body).trim();
  if (!strippedBody) {
    return "";
  }
  return `[quote=${senderUsername}]\n${truncateReplyQuote(strippedBody)}\n[/quote]\n\n`;
}

function stripNestedQuotes(body: string) {
  const quoteTagPattern = /\[(\/?)quote(?:=[^\]]*)?\]/gi;
  let result = "";
  let lastIndex = 0;
  let quoteDepth = 0;

  for (const match of body.matchAll(quoteTagPattern)) {
    const matchIndex = match.index ?? 0;
    if (quoteDepth === 0) {
      result += body.slice(lastIndex, matchIndex);
    }
    quoteDepth =
      match[1] === "/" ? Math.max(quoteDepth - 1, 0) : quoteDepth + 1;
    lastIndex = matchIndex + match[0].length;
  }

  if (quoteDepth === 0) {
    result += body.slice(lastIndex);
  }

  return result.replace(/\n{3,}/g, "\n\n");
}

function truncateReplyQuote(body: string) {
  const maxLength = 1800;
  if (body.length <= maxLength) {
    return body;
  }
  return `${body.slice(0, maxLength).trimEnd()}...`;
}

function normalizeRecipientLookupValue(value: string) {
  return value.trim().toLowerCase();
}

function recipientSuggestionMatches(
  suggestion: RecipientSuggestion,
  needle: string,
) {
  return (
    normalizeRecipientLookupValue(suggestion.username).includes(needle) ||
    normalizeRecipientLookupValue(suggestion.title).includes(needle) ||
    normalizeRecipientLookupValue(suggestion.detail).includes(needle)
  );
}
