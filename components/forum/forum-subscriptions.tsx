"use client";

import { asRoute } from "@/lib/typed-route";

import { reportAppError } from "@/components/app-error-surface";
import {
  forumPath,
  forumPostPath,
  forumRefs,
  formatForumCount,
  formatForumDateTime,
  getCategoryDescription,
  getCategoryLatestThread,
  getCategoryPostCount,
  getCategoryThreadCount,
  getCategoryTitle,
  getThreadAuthor,
  getThreadLastActivityAt,
  getThreadLastAuthor,
  getThreadLastPostHref,
  getThreadReplyCount,
  getThreadStartedAt,
  type ForumCategoryRecord,
  type ForumNotificationRecord,
  type ForumThreadSummaryRecord,
} from "@/components/forum/forum-refs";
import {
  ForumLink,
  ForumLoading,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { userFacingError } from "@/lib/auth-errors";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvexAuth, useMutation } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";


export function ForumSubscriptions({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Local forum disabled"
        body="Convex is not configured locally, so subscriptions cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumSubscriptions />;
}

function LiveForumSubscriptions() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const pathname = usePathname();
  const [filterQuery, setFilterQuery] = useState("");
  const [section, setSection] = useState("all");
  const [notificationError, setNotificationError] = useState("");
  const [pendingNotificationId, setPendingNotificationId] = useState<
    string | null
  >(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState("");
  const [subscriptionActionError, setSubscriptionActionError] = useState("");
  const [pendingSubscriptionKey, setPendingSubscriptionKey] = useState<
    string | null
  >(null);
  const signInHref = `/signin?${new URLSearchParams({
    redirectTo: pathname ?? "/forum/subscriptions",
  }).toString()}`;
  const subscriptions = useQuery(
    forumRefs.listMyThreadSubscriptions,
    isAuthenticated ? { limit: 40 } : "skip",
  );
  const categorySubscriptions = useQuery(
    forumRefs.listMyCategorySubscriptions,
    isAuthenticated ? { limit: 40 } : "skip",
  );
  const notifications = useQuery(
    forumRefs.listMyNotifications,
    isAuthenticated ? { limit: 20, status: "unread" } : "skip",
  );
  const markNotificationRead = useMutation(forumRefs.markNotificationRead);
  const toggleThreadSubscription = useMutation(
    forumRefs.toggleThreadSubscription,
  );
  const toggleCategorySubscription = useMutation(
    forumRefs.toggleCategorySubscription,
  );

  async function markRead(notification?: ForumNotificationRecord) {
    const pendingId = notification?._id ?? "all";
    setPendingNotificationId(pendingId);
    setNotificationError("");
    try {
      await markNotificationRead(
        notification ? { notificationId: notification._id } : { markAll: true },
      );
    } catch (caught) {
      reportAppError(caught, {
        action: "forum.notification.markRead",
        component: "ForumSubscriptions",
      });
      setNotificationError(
        userFacingError(caught, "Could not update notifications"),
      );
    } finally {
      setPendingNotificationId(null);
    }
  }

  async function unsubscribeThread(thread: ForumThreadSummaryRecord) {
    const threadId = thread._id ?? thread.threadId;
    const threadTitle = thread.title || "this thread";
    if (!threadId) {
      const missingIdError = new Error(
        "Cannot unsubscribe from watched thread without a thread id.",
      );
      reportAppError(missingIdError, {
        scope: "forum",
        eventType: "thread_subscription_missing_id",
        component: "ForumSubscriptions",
        action: "forum:toggleThreadSubscription",
        metadata: { threadSlug: thread.slug },
        notify: false,
      });
      const message = "Could not unsubscribe from this watched thread.";
      setSubscriptionActionError(message);
      setSubscriptionStatus("");
      toast.error("Unsubscribe failed", { description: message });
      return;
    }

    const pendingKey = watchedThreadPendingKey(threadId);
    setPendingSubscriptionKey(pendingKey);
    setSubscriptionActionError("");
    setSubscriptionStatus("");
    try {
      const result = await toggleThreadSubscription({ threadId });
      const message = result.subscribed
        ? `Watching thread: ${threadTitle}.`
        : `Muted thread: ${threadTitle}.`;
      setSubscriptionStatus(message);
      toast.success(result.subscribed ? "Thread watched" : "Thread muted", {
        description: threadTitle,
      });
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "thread_subscription_failed",
        component: "ForumSubscriptions",
        action: "forum:toggleThreadSubscription",
        entityType: "forumThread",
        entityId: threadId,
        metadata: { threadSlug: thread.slug, source: "subscriptions" },
        notify: false,
      });
      const message = userFacingError(caught, "Could not unsubscribe thread");
      setSubscriptionActionError(message);
      toast.error("Unsubscribe failed", { description: message });
    } finally {
      setPendingSubscriptionKey(null);
    }
  }

  async function unsubscribeCategory(category: ForumCategoryRecord) {
    const categoryTitle = getCategoryTitle(category);
    const pendingKey = watchedCategoryPendingKey(category.slug);
    setPendingSubscriptionKey(pendingKey);
    setSubscriptionActionError("");
    setSubscriptionStatus("");
    try {
      const result = await toggleCategorySubscription({
        categorySlug: category.slug,
      });
      const message = result.subscribed
        ? `Watching board: ${categoryTitle}.`
        : `Muted board: ${categoryTitle}.`;
      setSubscriptionStatus(message);
      toast.success(result.subscribed ? "Board watched" : "Board muted", {
        description: categoryTitle,
      });
    } catch (caught) {
      reportAppError(caught, {
        scope: "forum",
        eventType: "category_subscription_failed",
        component: "ForumSubscriptions",
        action: "forum:toggleCategorySubscription",
        entityType: "forumCategory",
        entityId: category._id,
        metadata: { categorySlug: category.slug, source: "subscriptions" },
        notify: false,
      });
      const message = userFacingError(caught, "Could not unsubscribe board");
      setSubscriptionActionError(message);
      toast.error("Unsubscribe failed", { description: message });
    } finally {
      setPendingSubscriptionKey(null);
    }
  }

  if (isLoading) {
    return (
      <ForumLoading label="Checking forum session" variant="subscriptions" />
    );
  }

  if (!isAuthenticated) {
    return (
      <ForumStatusBox
        title="Sign in required"
        body="Use a SYM handle to save and review subscribed threads."
        action={
          <Button asChild className="rounded-xl text-xs" variant="outline">
            <Link href={asRoute(signInHref)}>Sign in</Link>
          </Button>
        }
      />
    );
  }

  if (
    subscriptions === undefined ||
    categorySubscriptions === undefined ||
    notifications === undefined
  ) {
    return (
      <ForumLoading label="Syncing subscriptions" variant="subscriptions" />
    );
  }

  return (
    <div className="forum-account-library space-y-3">
      <ForumSubscriptionActionStatus
        error={subscriptionActionError}
        status={subscriptionStatus}
      />
      <nav aria-label="Watched activity sections" className="forum-section-tabs">
        {[
          ["all", "Overview", undefined],
          ["notifications", "Notifications", notifications.unreadCount],
          ["boards", "Boards", categorySubscriptions.categories.length],
          ["threads", "Threads", subscriptions.threads.length],
        ].map(([value, label, count]) => <button key={value} type="button" className="focus-ring forum-section-tab" aria-pressed={section === value} onClick={() => setSection(String(value))}>{label}{count !== undefined ? <span className="forum-count-badge">{count}</span> : null}</button>)}
      </nav>
      <label className="forum-library-search"><span>Find a subscription</span><input className="focus-ring" type="search" placeholder="Search watched boards and threads…" value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} /></label>
      <div className="scroll-mt-24" hidden={section !== "all" && section !== "notifications"} id="watched-notifications">
        <ForumNotificationPanel
          error={notificationError}
          limited={notifications.notificationsLimited}
          notifications={notifications.notifications}
          onMarkAllRead={() => markRead()}
          onMarkRead={markRead}
          pendingNotificationId={pendingNotificationId}
          unreadCount={notifications.unreadCount}
          unreadCountLimited={notifications.unreadCountLimited}
        />
      </div>
      <div className="scroll-mt-24" hidden={section !== "all" && section !== "boards"} id="watched-boards">
        <ForumCategorySubscriptionPanel
          categories={categorySubscriptions.categories.filter((category) => `${getCategoryTitle(category)} ${getCategoryDescription(category)}`.toLowerCase().includes(filterQuery.toLowerCase()))}
          onUnsubscribe={unsubscribeCategory}
          pendingKey={pendingSubscriptionKey}
        />
      </div>
      <div className="scroll-mt-24" hidden={section !== "all" && section !== "threads"} id="watched-threads">
        <ForumThreadSubscriptionPanel
          onUnsubscribe={unsubscribeThread}
          pendingKey={pendingSubscriptionKey}
          threads={subscriptions.threads.filter((thread) => `${thread.title} ${thread.categorySlug}`.toLowerCase().includes(filterQuery.toLowerCase()))}
        />
      </div>
    </div>
  );
}

function ForumSubscriptionActionStatus({
  error,
  status,
}: {
  error: string;
  status: string;
}) {
  if (!error && !status) {
    return null;
  }

  return (
    <p
      className="border border-row-border px-3 py-2.5 text-sm text-muted-foreground"
      role={error ? "alert" : "status"}
    >
      <span className="text-xs text-foreground">
        {error ? "Action failed" : "Subscription updated"} /{" "}
      </span>
      {error || status}
    </p>
  );
}

function ForumNotificationPanel({
  error,
  limited,
  notifications,
  onMarkAllRead,
  onMarkRead,
  pendingNotificationId,
  unreadCount,
  unreadCountLimited,
}: {
  error: string;
  limited: boolean;
  notifications: ForumNotificationRecord[];
  onMarkAllRead: () => void;
  onMarkRead: (notification: ForumNotificationRecord) => void;
  pendingNotificationId: string | null;
  unreadCount: number;
  unreadCountLimited: boolean;
}) {
  const [filter, setFilter] = useState<
    "all" | "reply" | "mention" | "newThread"
  >("all");
  const visibleNotifications = notifications.filter(
    (item) => filter === "all" || item.type === filter,
  );
  const unreadLabel = unreadCountLimited
    ? `${unreadCount}+`
    : String(unreadCount);
  const unreadCopy =
    unreadCountLimited && unreadCount === 0
      ? "Unread updates may exist beyond the latest bounded visibility scan."
      : unreadCountLimited
        ? `Latest ${unreadLabel} unread alerts from watched activity and direct mentions.`
        : `${unreadLabel} unread forum alert${unreadCount === 1 ? "" : "s"} from watched activity and direct mentions.`;

  return (
    <section className="forum-panel min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">Forum notifications</h2>
          <p className="mt-1 text-sm text-muted-foreground">{unreadCopy}</p>
        </div>
        <Button
          className="h-8 rounded-xl text-xs"
          disabled={unreadCount === 0 || pendingNotificationId !== null}
          onClick={onMarkAllRead}
          size="sm"
          variant="outline"
        >
          {unreadCountLimited ? "Mark latest read" : "Mark all read"}
        </Button>
      </div>
      {error ? (
        <p className="px-3 py-2.5 text-sm text-primary">{error}</p>
      ) : null}
      <nav
        aria-label="Notification categories"
        className="flex flex-wrap gap-1 px-3 pb-2"
      >
        {(
          [
            { value: "all", label: "All" },
            { value: "reply", label: "Replies" },
            { value: "mention", label: "Mentions" },
            { value: "newThread", label: "Following" },
          ] as const
        ).map((item) => (
          <button
            type="button"
            key={item.value}
            className={`forum-action-pill focus-ring min-h-11 px-3 text-xs ${filter === item.value ? "text-primary" : "text-muted-foreground"}`}
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </button>
        ))}
        <ForumLink
          href="/forum/messages"
          className="forum-action-pill focus-ring inline-flex min-h-11 items-center px-3 text-xs"
        >
          Messages
        </ForumLink>
        <ForumLink
          href="/forum/control-panel"
          className="forum-action-pill focus-ring inline-flex min-h-11 items-center px-3 text-xs"
        >
          Notification settings
        </ForumLink>
      </nav>
      {visibleNotifications.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          {limited
            ? "No visible notifications were found in the latest bounded scan."
            : "No unread forum notifications."}
        </p>
      ) : (
        <div className="space-y-0">
          {visibleNotifications.map((notification) => (
            <ForumNotificationRow
              key={notification._id}
              notification={notification}
              onMarkRead={onMarkRead}
              pending={pendingNotificationId === notification._id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ForumNotificationRow({
  notification,
  onMarkRead,
  pending,
}: {
  notification: ForumNotificationRecord;
  onMarkRead: (notification: ForumNotificationRecord) => void;
  pending: boolean;
}) {
  const href = forumPostPath(
    notification.categorySlug,
    notification.threadSlug,
    notification.postNumber,
    notification.postPage,
  );
  const notificationLabel =
    notification.type === "newThread"
      ? "New topic"
      : notification.type === "mention"
        ? "Mention"
        : "Reply";

  return (
    <div className="forum-list-row grid min-w-0 gap-3 px-4 py-3 rounded-xl hover:bg-muted/45 md:grid-cols-[minmax(0,1fr)_9rem_auto] md:items-center">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">
          {notificationLabel} / {notification.categoryName} /{" "}
          {notification.actor}
        </p>
        <ForumLink
          className="focus-ring mt-1 block text-sm font-semibold [overflow-wrap:anywhere] hover:text-primary"
          href={href}
          onClick={() => onMarkRead(notification)}
          prefetch
        >
          {notification.threadTitle}
        </ForumLink>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatForumDateTime(notification.createdAt)}
      </p>
      <div className="forum-library-actions flex flex-wrap gap-1">
        <Button
          asChild
          className="h-7 rounded-xl text-xs"
          size="sm"
          variant="outline"
        >
          <ForumLink
            href={href}
            onClick={() => onMarkRead(notification)}
            prefetch
          >
            Open
          </ForumLink>
        </Button>
        <Button
          className="h-7 rounded-xl text-xs"
          disabled={pending}
          onClick={() => onMarkRead(notification)}
          size="sm"
          variant="outline"
        >
          Mark read
        </Button>
      </div>
    </div>
  );
}

function ForumCategorySubscriptionPanel({
  categories,
  onUnsubscribe,
  pendingKey,
}: {
  categories: ForumCategoryRecord[];
  onUnsubscribe: (category: ForumCategoryRecord) => void;
  pendingKey: string | null;
}) {
  if (categories.length === 0) {
    return (
      <ForumStatusBox
        title="Watched boards"
        body="No watched boards yet. Use Subscribe board from a board page to receive new-topic alerts."
      />
    );
  }

  return (
    <section className="forum-panel min-w-0">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold">Watched boards</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          New-topic alerts from boards you follow.
        </p>
      </div>
      <div className="space-y-0">
        {categories.map((category) => (
          <ForumCategorySubscriptionRow
            category={category}
            key={category._id}
            onUnsubscribe={onUnsubscribe}
            pending={pendingKey === watchedCategoryPendingKey(category.slug)}
          />
        ))}
      </div>
    </section>
  );
}

function ForumCategorySubscriptionRow({
  category,
  onUnsubscribe,
  pending,
}: {
  category: ForumCategoryRecord;
  onUnsubscribe: (category: ForumCategoryRecord) => void;
  pending: boolean;
}) {
  const latestThread = getCategoryLatestThread(category);

  return (
    <div className="forum-library-row forum-list-row grid min-w-0 gap-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">Watched board</p>
        <ForumLink
          className="focus-ring mt-1 block text-sm font-semibold [overflow-wrap:anywhere] hover:text-primary"
          href={forumPath(category.slug)}
          prefetch
        >
          {getCategoryTitle(category)}
        </ForumLink>
        {getCategoryDescription(category) ? (
          <p className="mt-1 line-clamp-2 forum-library-activity text-xs leading-5 text-muted-foreground">
            {getCategoryDescription(category)}
          </p>
        ) : null}
      </div>
      <div className="forum-library-counts text-xs text-muted-foreground">
        <div className="">
          <p>Threads</p>
          <p className="mt-1 text-foreground">
            {getCategoryThreadCount(category)}
          </p>
        </div>
        <div className="">
          <p>Posts</p>
          <p className="mt-1 text-foreground">
            {getCategoryPostCount(category)}
          </p>
        </div>
      </div>
      <div className="forum-library-actions flex flex-wrap gap-1">
        {latestThread ? (
          <Button
            asChild
            className="h-7 rounded-xl text-xs"
            size="sm"
            variant="outline"
          >
            <ForumLink
              href={forumPath(category.slug, latestThread.slug)}
              prefetch
            >
              Latest
            </ForumLink>
          </Button>
        ) : null}
        <Button
          asChild
          className="h-7 rounded-xl text-xs"
          size="sm"
          variant="outline"
        >
          <ForumLink href={forumPath(category.slug)} prefetch>
            Open
          </ForumLink>
        </Button>
        <Button
          className="h-7 rounded-xl text-xs"
          disabled={pending}
          onClick={() => onUnsubscribe(category)}
          size="sm"
          type="button"
          variant="outline"
        >
          {pending ? "Removing…" : "Unsubscribe"}
        </Button>
      </div>
    </div>
  );
}

function ForumThreadSubscriptionPanel({
  onUnsubscribe,
  pendingKey,
  threads,
}: {
  onUnsubscribe: (thread: ForumThreadSummaryRecord) => void;
  pendingKey: string | null;
  threads: ForumThreadSummaryRecord[];
}) {
  if (threads.length === 0) {
    return (
      <ForumStatusBox
        title="Watched threads"
        body="No watched threads yet. Use Subscribe on a thread to add it here."
      />
    );
  }

  return (
    <section className="forum-panel min-w-0">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold">Watched threads</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Reply alerts from threads you follow.
        </p>
      </div>
      <div className="space-y-0">
        {threads.map((thread) => {
          const threadId = thread._id ?? thread.threadId;
          return (
            <ForumThreadSubscriptionRow
              key={threadId ?? thread.slug}
              onUnsubscribe={onUnsubscribe}
              pending={
                threadId
                  ? pendingKey === watchedThreadPendingKey(threadId)
                  : false
              }
              thread={thread}
              threadId={threadId}
            />
          );
        })}
      </div>
    </section>
  );
}

function ForumThreadSubscriptionRow({
  onUnsubscribe,
  pending,
  thread,
  threadId,
}: {
  onUnsubscribe: (thread: ForumThreadSummaryRecord) => void;
  pending: boolean;
  thread: ForumThreadSummaryRecord;
  threadId?: string;
}) {
  const categorySlug = thread.categorySlug;
  const threadHref = forumPath(categorySlug, thread.slug);
  const lastPostHref = getThreadLastPostHref(thread, categorySlug);

  return (
    <div className="forum-library-row forum-list-row grid min-w-0 gap-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">
          Watched thread / {thread.categoryName ?? categorySlug ?? "Forum"}
        </p>
        <ForumLink
          className="focus-ring mt-1 block text-sm font-semibold [overflow-wrap:anywhere] hover:text-primary"
          href={threadHref}
          prefetch
        >
          {thread.title}
        </ForumLink>
        {thread.excerpt ? (
          <p className="mt-1 line-clamp-2 forum-library-activity text-xs leading-5 text-muted-foreground">
            {thread.excerpt}
          </p>
        ) : null}
      </div>
      <div className="forum-library-counts text-xs text-muted-foreground">
        <div className="">
          <p>Replies</p>
          <p className="mt-1 text-foreground">
            {formatForumCount(getThreadReplyCount(thread))}
          </p>
        </div>
        <div className="">
          <p>Views</p>
          <p className="mt-1 text-foreground">
            {formatForumCount(thread.viewCount)}
          </p>
        </div>
      </div>
      <div className="forum-library-activity text-xs leading-5 text-muted-foreground">
        <p>Starter</p>
        <p className="truncate text-foreground">{getThreadAuthor(thread)}</p>
        <p>{formatForumDateTime(getThreadStartedAt(thread))}</p>
      </div>
      <div className="forum-library-activity text-xs leading-5 text-muted-foreground">
        <p>Last post</p>
        <p className="truncate text-foreground">
          {getThreadLastAuthor(thread)}
        </p>
        <p>{formatForumDateTime(getThreadLastActivityAt(thread))}</p>
      </div>
      <div className="forum-library-actions flex flex-wrap gap-1">
        <Button
          asChild
          className="h-7 rounded-xl text-xs"
          size="sm"
          variant="outline"
        >
          <ForumLink href={lastPostHref} prefetch>
            Latest reply
          </ForumLink>
        </Button>
        <Button
          asChild
          className="h-7 rounded-xl text-xs"
          size="sm"
          variant="outline"
        >
          <ForumLink href={threadHref} prefetch>
            Open
          </ForumLink>
        </Button>
        <Button
          className="h-7 rounded-xl text-xs"
          disabled={pending || !threadId}
          onClick={() => onUnsubscribe(thread)}
          size="sm"
          type="button"
          variant="outline"
        >
          {pending ? "Removing…" : "Unsubscribe"}
        </Button>
      </div>
    </div>
  );
}

function watchedThreadPendingKey(threadId: string) {
  return `thread:${threadId}`;
}

function watchedCategoryPendingKey(categorySlug: string) {
  return `category:${categorySlug}`;
}
