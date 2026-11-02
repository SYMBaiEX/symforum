"use client";

import { useId } from "react";
import { useQuery } from "convex/react";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import { ForumLink } from "@/components/forum/forum-link";
import {
  forumPath,
  forumRefs,
  formatForumDateTime,
} from "@/components/forum/forum-refs";
import { TerminalBoundary } from "@/components/trading/terminal-boundary";
import { SYMF_TOKEN } from "@/lib/symf-token";
import styles from "./symf-project-discussions.module.css";

const discussionLimit = 6;
// Installation configuration validates this first-party announcement path.
const announcementBoard = SYMF_TOKEN.announcementPath.split("/").at(-2);
const searchQuery = new URLSearchParams({
  q: SYMF_TOKEN.symbol,
  ...(announcementBoard ? { board: announcementBoard } : {}),
  type: "threads",
});
const searchHref = `/forum/search?${searchQuery}`;

export function SymfProjectDiscussions() {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>From the forum</p>
          <h2 id={headingId}>Related forum discussions</h2>
        </div>
        <ForumLink
          className={styles.searchLink}
          href={searchHref}
          prefetch={false}
        >
          Search discussions <ArrowUpRight size={16} aria-hidden="true" />
        </ForumLink>
      </header>
      <p className={styles.context}>
        {SYMF_TOKEN.symbol} text mentions in the token announcement’s board,
        visible to you. These are not verified mint associations or a complete
        discussion history.
      </p>
      <ForumLink
        className={styles.announcement}
        href={SYMF_TOKEN.announcementPath}
        prefetch={false}
      >
        <MessageSquare size={20} aria-hidden="true" />
        <span>
          <span className={styles.eyebrow}>Official starting point</span>
          <strong>Read the {SYMF_TOKEN.symbol} token announcement</strong>
        </span>
        <ArrowUpRight size={18} aria-hidden="true" />
      </ForumLink>
      <TerminalBoundary label="Related forum discussions" recovery="read-only">
        <RelatedMentions />
      </TerminalBoundary>
    </section>
  );
}

function RelatedMentions() {
  const result = useQuery(forumRefs.search, {
    query: SYMF_TOKEN.symbol,
    ...(announcementBoard ? { categorySlug: announcementBoard } : {}),
    resultType: "threads",
    page: 1,
    pageSize: discussionLimit,
  });
  if (result === undefined)
    return (
      <p className={styles.state} role="status">
        Loading related discussions…
      </p>
    );
  const threads = result.threads
    .filter(
      (thread) => thread.status === "active" || thread.status === "locked",
    )
    .map((thread) => ({
      thread,
      href: forumPath(
        encodeURIComponent(thread.categorySlug),
        encodeURIComponent(thread.slug),
      ),
    }))
    .filter(({ href }) => href !== SYMF_TOKEN.announcementPath)
    .slice(0, discussionLimit);
  if (!threads.length)
    return (
      <p className={styles.state} role="status">
        No additional discussions are shown in this search page. Start with the
        announcement above or search the forum.
      </p>
    );
  return (
    <>
      <ul className={styles.list}>
        {threads.map(({ thread, href }) => (
          <li key={thread.threadId}>
            <ForumLink
              className={styles.discussion}
              href={href}
              prefetch={false}
            >
              <span className={styles.discussionCopy}>
                <strong>{thread.title}</strong>
                <span className={styles.excerpt}>{thread.excerpt}</span>
                <span className={styles.meta}>
                  <span>
                    {thread.replyCount}{" "}
                    {thread.replyCount === 1 ? "reply" : "replies"}
                  </span>
                  <span>
                    Last activity {formatForumDateTime(thread.lastPostAt)}
                  </span>
                  {thread.status === "locked" && <span>Locked</span>}
                </span>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </ForumLink>
          </li>
        ))}
      </ul>
      <p className={styles.coverage}>
        {threads.length} additional{" "}
        {threads.length === 1 ? "discussion" : "discussions"} shown from one
        search page (up to {discussionLimit} results).
        {result.limited || result.threadPagination.hasNextPage
          ? " More matches may be available in forum search."
          : ""}
      </p>
    </>
  );
}
