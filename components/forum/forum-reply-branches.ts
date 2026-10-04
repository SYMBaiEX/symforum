export function forumReplyBranches<
  T extends { _id?: string; parentPostId?: string },
>(posts: T[]) {
  const byId = new Map(posts.filter((p) => p._id).map((p) => [p._id!, p]));
  const visited = new Set<T>();
  const result: { post: T; depth: number }[] = [];
  function visit(post: T, depth: number) {
    if (visited.has(post)) return;
    visited.add(post);
    result.push({ post, depth: Math.min(depth, 2) });
    for (const child of posts)
      if (post._id && child.parentPostId === post._id) visit(child, depth + 1);
  }
  for (const post of posts)
    if (!post.parentPostId || !byId.has(post.parentPostId)) visit(post, 0);
  // Defensive fallback preserves every item if legacy/imported data has a cycle.
  for (const post of posts) visit(post, 0);
  return result;
}
