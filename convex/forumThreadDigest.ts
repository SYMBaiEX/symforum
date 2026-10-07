import type { Doc } from "./_generated/dataModel";

export const FORUM_FEED_DIGEST_BACKFILL_KEY = "forum-feed-digests-v1";

export function compactFeedExcerpt(body: string) {
  const text = body
    .slice(0, 4_096)
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, " ")
    .replace(/\[(?:\/?)[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(
      /&#(?:x([a-f0-9]+)|(\d+));/gi,
      (_, hex: string | undefined, decimal: string | undefined) => {
        const code = parseInt(hex ?? decimal ?? "0", hex ? 16 : 10);
        return code > 0 &&
          code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : " ";
      },
    )
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/gi,
      (_, entity: string) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[
          entity.toLowerCase()
        ] ?? " ",
    );
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 280 ? clean : `${clean.slice(0, 279)}…`;
}

export function forumThreadEditorialDigestValues(thread: Doc<"forumThreads">) {
  return {
    threadId: thread._id,
    threadCreatedAt: thread._creationTime,
    categoryId: thread.categoryId,
    categorySlug: thread.categorySlug,
    prefixId: thread.prefixId,
    prefixSlug: thread.prefixSlug,
    prefixLabel: thread.prefixLabel,
    prefixColor: thread.prefixColor,
    slug: thread.slug,
    title: thread.title,
    feedExcerpt: compactFeedExcerpt(thread.body),
    kind: thread.kind,
    sourceUrl: thread.sourceUrl,
    agentAssisted: thread.agentAssisted,
    acceptedPostId: thread.acceptedPostId,
    authorId: thread.authorId,
    status: thread.status,
    pinned: thread.pinned,
    replyCount: thread.replyCount,
    ratingCount: thread.ratingCount,
    ratingTotal: thread.ratingTotal,
    lastAssignedPostNumber: thread.lastAssignedPostNumber,
    viewCount: thread.viewCount,
    lastPostId: thread.lastPostId,
    lastPostAt: thread.lastPostAt,
    lastPostUserId: thread.lastPostUserId,
    moderationActivityAt: thread.moderationActivityAt,
    moderationRootActivityAt: thread.moderationRootActivityAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}
