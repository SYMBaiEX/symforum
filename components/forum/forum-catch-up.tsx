"use client";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  FORUM_STARTER_COLLECTIONS,
  FORUM_CONVERSATION_PROMPTS,
} from "@/lib/forum-experience";
import { forumExperienceRefs } from "./forum-experience-refs";
import {
  forumRefs,
  forumPath,
  forumHrefForPathname,
  type ForumThreadSummaryRecord,
} from "./forum-refs";
import { ForumLink } from "./forum-primitives";
import { ForumExperienceMetrics } from "./forum-experience-metrics";
const action =
  "forum-action-pill focus-ring inline-flex min-h-11 items-center justify-center gap-2 px-4 text-sm disabled:opacity-50";

export function ForumCatchUp() {
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const data = useQuery(
    forumExperienceRefs.catchUp,
    isAuthenticated ? { limit: 24 } : "skip",
  );
  const experience = useQuery(
    forumExperienceRefs.get,
    isAuthenticated ? {} : "skip",
  );
  const boards = useQuery(forumRefs.listCategoryOptions, {});
  const nav = useQuery(
    forumRefs.getMyForumNavState,
    isAuthenticated ? {} : "skip",
  );
  const record = useMutation(forumExperienceRefs.event);
  const recorded = useRef(false);
  useEffect(() => {
    if (data?.summary.pending && !recorded.current) {
      recorded.current = true;
      void record({ event: "pending_open" }).catch(() => {});
    }
  }, [data, record]);
  const follow = useMutation(forumExperienceRefs.followBoard);
  const update = useMutation(forumExperienceRefs.update);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [words, setWords] = useState<string>();
  const [duration, setDuration] = useState("forever");
  if (isLoading) return <p role="status">Loading your forum…</p>;
  if (!isAuthenticated)
    return (
      <div className="forum-post-card p-6">
        <h2 className="text-lg font-semibold">
          Your forum, ready when you are
        </h2>
        <p className="mt-2 text-muted-foreground">
          Sign in to keep track of followed conversations, saved posts, and
          pending submissions.
        </p>
        <ForumLink
          className={`${action} mt-4 text-primary`}
          href={`/signin?${new URLSearchParams({ redirectTo: forumHrefForPathname("/forum/catch-up#interests", pathname) })}`}
        >
          Sign in
        </ForumLink>
      </div>
    );
  async function saveInterests() {
    if (busy) return;
    setBusy(true);
    try {
      for (const categorySlug of selected)
        await follow({ categorySlug, subscribed: true });
      await update({ onboardingCompleted: true });
      setSelected([]);
      toast.success("Your followed boards are ready.");
    } catch {
      toast.error(
        "Could not save every board. Your choices are still here; try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveMutes() {
    if (busy) return;
    setBusy(true);
    try {
      await update({
        mutedWords: (words ?? experience?.mutedWords.join("\n") ?? "")
          .split("\n")
          .map((w) => w.trim())
          .filter(Boolean),
        mutedUntil:
          duration === "forever"
            ? null
            : Date.now() + Number(duration) * 86_400_000,
      });
      toast.success("Feed filters saved.");
    } catch {
      toast.error(
        "Could not save filters. Use up to 20 phrases of 80 characters each.",
      );
    } finally {
      setBusy(false);
    }
  }
  function threads(items: ForumThreadSummaryRecord[]) {
    return (
      <ul className="space-y-1">
        {items.map((thread) => (
          <li key={thread._id}>
            <ForumLink
              className="focus-ring flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-muted/50"
              href={forumPath(thread.categorySlug, thread.slug)}
            >
              <span className="min-w-0 break-words font-medium">
                {thread.title}
              </span>
              <span className="text-xs text-muted-foreground">
                {thread.categoryName ?? thread.categorySlug}
              </span>
            </ForumLink>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-6">
      {nav?.canModerate ? <ForumExperienceMetrics /> : null}
      <nav aria-label="Your forum" className="flex flex-wrap gap-2">
        <ForumLink href="/forum/saved" className={action}>
          Saved
        </ForumLink>
        <ForumLink href="/forum/messages" className={action}>
          Inbox
        </ForumLink>
        <ForumLink href="/forum/subscriptions" className={action}>
          Notifications & following
        </ForumLink>
        <ForumLink href="/forum/control-panel/agent-access" className={action}>
          Agent review queue
        </ForumLink>
      </nav>
      {data ? (
        <>
          <section className="forum-post-card p-4 sm:p-5">
            <h2 className="mb-3 text-lg font-semibold">
              Pick up the conversation{" "}
              <span className="text-sm text-muted-foreground">
                {data.summary.unread} unread
              </span>
            </h2>
            {data.threads.length ? (
              threads(data.threads)
            ) : (
              <p className="text-sm text-muted-foreground">
                You’re caught up on your recent followed threads.
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Your 24 most recent followed discussions. Open Following to browse
              more.
            </p>
          </section>
          <section className="forum-post-card p-4 sm:p-5">
            <h2 className="mb-3 text-lg font-semibold">Saved for later</h2>
            {data.saved.length ? (
              threads(data.saved)
            ) : (
              <p className="text-sm text-muted-foreground">
                Use Save on any discussion to keep it here.
              </p>
            )}
          </section>
          <section className="forum-post-card p-4 sm:p-5">
            <h2 className="mb-3 text-lg font-semibold">
              Awaiting moderator review{" "}
              <span className="text-sm text-muted-foreground">
                {data.summary.pending}
              </span>
            </h2>
            {data.pending.threads.map((thread) => (
              <p key={thread._id} className="py-2 text-sm">
                {thread.title}
              </p>
            ))}
            {data.pending.posts.map((post) => (
              <p key={post._id} className="py-2 text-sm">
                Reply in {post.threadTitle}
              </p>
            ))}
            {!data.summary.pending && (
              <p className="text-sm text-muted-foreground">
                No pending submissions in this recent list.
              </p>
            )}
            <ForumLink
              href="/forum/control-panel"
              className={`${action} mt-2 text-primary`}
            >
              Manage pending content
            </ForumLink>
          </section>
        </>
      ) : (
        <p role="status">Loading your conversations…</p>
      )}
      <section
        id="interests"
        className="forum-post-card scroll-mt-24 p-4 sm:p-5"
      >
        <h2 className="text-lg font-semibold">Make room for your interests</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose individual boards. You can skip setup and change follows
          anytime.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {FORUM_STARTER_COLLECTIONS.map((collection) => (
            <fieldset
              key={collection.id}
              className="min-w-0 rounded-xl bg-muted/30 p-3"
            >
              <legend className="px-1 font-semibold">{collection.title}</legend>
              <p className="mb-2 text-xs leading-5 text-muted-foreground">
                {collection.description}
              </p>
              {boards === undefined ? (
                <p
                  role="status"
                  className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]"
                >
                  Loading board options for {collection.title}…
                </p>
              ) : !boards.some((board) =>
                  collection.slugs.some((slug) => slug === board.slug),
                ) ? (
                <p
                  role="status"
                  className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]"
                >
                  No matching boards for {collection.title} in the loaded
                  options.
                </p>
              ) : null}
              {(boards ?? [])
                .filter((board) =>
                  collection.slugs.some((slug) => slug === board.slug),
                )
                .map((board) => {
                  const followed = experience?.followingBoards.some(
                    (b) => b._id === board._id,
                  );
                  return (
                    <label
                      key={board._id}
                      className="flex min-h-11 items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        disabled={followed || busy}
                        checked={followed || selected.includes(board.slug)}
                        onChange={(e) =>
                          setSelected((current) =>
                            e.target.checked
                              ? [...current, board.slug]
                              : current.filter((slug) => slug !== board.slug),
                          )
                        }
                      />
                      {board.name}
                      {followed ? (
                        <span className="text-xs text-muted-foreground">
                          Following
                        </span>
                      ) : null}
                    </label>
                  );
                })}
            </fieldset>
          ))}
        </div>
        <button
          className={`${action} mt-4 bg-primary text-primary-foreground`}
          onClick={() => void saveInterests()}
          disabled={busy || !selected.length}
          type="button"
        >
          Follow selected boards
        </button>
      </section>
      <section className="forum-post-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Start something worth sharing</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {FORUM_CONVERSATION_PROMPTS.map((prompt) => (
            <ForumLink
              key={prompt.id}
              href={`/forum/general?compose=1&template=${prompt.id}`}
              className={action}
            >
              {prompt.title}
            </ForumLink>
          ))}
        </div>
      </section>
      <section className="forum-post-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Quiet your feed</h2>
        <label className="mt-3 block text-sm">
          Muted words or phrases (one per line, up to 20)
          <textarea
            className="focus-ring mt-2 block min-h-28 w-full rounded-xl bg-muted/50 p-3 text-base"
            value={words ?? experience?.mutedWords.join("\n") ?? ""}
            onChange={(e) => setWords(e.target.value)}
          />
        </label>
        <label className="mt-3 flex items-center gap-3 text-sm">
          Mute duration
          <select
            className="focus-ring min-h-11 rounded-xl bg-muted px-3"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          >
            <option value="forever">Until I remove it</option>
            <option value="1">One day</option>
            <option value="7">One week</option>
          </select>
        </label>
        <button
          className={`${action} mt-3 text-primary`}
          disabled={busy}
          type="button"
          onClick={() => void saveMutes()}
        >
          Save filters
        </button>
        <p className="mt-3 text-xs text-muted-foreground">
          Muted phrases affect your discovery feed. Manage ignored profiles in
          Account & preferences.
        </p>
      </section>
    </div>
  );
}
