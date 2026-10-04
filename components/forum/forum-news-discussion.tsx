"use client";
import { safeExternalUrl } from "@/lib/safe-url";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { userFacingError } from "@/lib/auth-errors";
import { asRoute } from "@/lib/typed-route";
import { forumExperienceRefs } from "./forum-experience-refs";
import { forumPath, forumHrefForPathname, forumRefs } from "./forum-refs";
import { ForumLink } from "./forum-primitives";
import { ForumCompose } from "./forum-compose";
export function ForumNewsDiscussion({ hnItemId }: { hnItemId: number }) {
  const data = useQuery(forumExperienceRefs.news, { hnItemId });
  const boards = useQuery(forumRefs.listCategoryOptions, {});
  const start = useMutation(forumExperienceRefs.discussNews);
  const { isAuthenticated } = useConvexAuth();
  const nav = useQuery(
    forumRefs.getMyForumNavState,
    isAuthenticated ? {} : "skip",
  );
  const router = useRouter(),
    pathname = usePathname();
  const [body, setBody] = useState(""),
    [board, setBoard] = useState("general");
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  if (!data) return <p role="status">Loading this story…</p>;
  async function submit() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await start({ hnItemId, categorySlug: board, body });
      if (result.status === "pending") {
        setError(
          "Awaiting moderator review. Your discussion is in Account & preferences → Pending content.",
        );
        return true;
      }
      router.push(
        asRoute(
          forumHrefForPathname(
            forumPath(result.categorySlug, result.threadSlug),
            pathname,
          ),
        ),
      );
      return true;
    } catch (caught) {
      setError(
        userFacingError(
          caught,
          "Could not start this discussion. Your draft is still here.",
        ),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-5">
      <ForumLink
        href="/forum?view=news"
        className="focus-ring inline-flex min-h-11 items-center text-sm text-muted-foreground"
      >
        ← News
      </ForumLink>
      <header>
        <p className="mb-2 text-xs text-accent">
          {data.story.host ?? "Hacker News"}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {data.story.title}
        </h1>
        <p className="mt-3 text-xs text-muted-foreground">
          {typeof data.story.hnScore === "number" ? `${data.story.hnScore} HN points · ` : ""}
          {typeof data.story.hnCommentCount === "number" ? `${data.story.hnCommentCount} HN comments · ` : ""}
          imported from Hacker News
        </p>
        {safeExternalUrl(data.story.url) ? (
          <a
            href={safeExternalUrl(data.story.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring mt-2 inline-flex min-h-11 items-center text-sm text-accent"
          >
            Read source article ↗
          </a>
        ) : null}
      </header>
      {data.discussion ? (
        <section className="forum-post-card p-5">
          <h2 className="text-lg font-semibold">Discuss on SYMBaiEX</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.discussion.status === "pending"
              ? "Awaiting moderator review. Find your submission in Pending content."
              : `${data.discussion.replyCount} local replies`}
          </p>
          {data.discussion.status !== "pending" ? (
            <ForumLink
              className="forum-action-pill focus-ring mt-4 inline-flex min-h-11 items-center bg-primary px-4 text-sm text-primary-foreground"
              href={forumPath(
                data.discussion.categorySlug,
                data.discussion.threadSlug,
              )}
            >
              Open discussion
            </ForumLink>
          ) : (
            <ForumLink
              className="focus-ring min-h-11 text-sm text-primary"
              href="/forum/control-panel"
            >
              Pending content
            </ForumLink>
          )}
        </section>
      ) : isAuthenticated ? (
        <ForumCompose
          body={body}
          onBodyChange={setBody}
          bodyLabel="Start the local conversation"
          bodyPlaceholder="What stood out? Share your perspective or ask a question."
          submitLabel="Start discussion"
          pending={pending}
          error={error}
          draftKey={
            nav?.userId
              ? `symbaiex:forum:draft:news:${nav.userId}:${hnItemId}`
              : undefined
          }
          onSubmit={submit}
          note="This starts a SYMBaiEX forum discussion; it does not post to Hacker News."
        >
          <label className="block text-sm">
            Board
            <select
              className="focus-ring mt-2 block min-h-11 w-full rounded-xl bg-muted px-3"
              value={board}
              onChange={(e) => setBoard(e.target.value)}
            >
              {(boards ?? []).map((category) => (
                <option key={category._id} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        </ForumCompose>
      ) : (
        <section className="forum-post-card p-5">
          <h2 className="text-lg font-semibold">Start a conversation</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Be the first to discuss this story with the community.
          </p>
          <ForumLink
            href="/signin"
            className="focus-ring mt-3 inline-flex min-h-11 items-center text-sm text-primary"
          >
            Sign in to discuss
          </ForumLink>
        </section>
      )}
    </div>
  );
}
