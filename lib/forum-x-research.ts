export const X_RESEARCH_DESKS = ["solana", "pumpfun", "bags"] as const;
export type XResearchDesk = (typeof X_RESEARCH_DESKS)[number];
export const X_RESEARCH_QUERIES: Record<XResearchDesk, string> = {
  solana:
    "Solana (launches OR announces OR funding OR integration OR shipped) -is:retweet -is:reply lang:en",
  pumpfun:
    '("pump.fun" OR pumpfun) (launch OR announces OR shipped OR release) -is:retweet -is:reply lang:en',
  bags: '("bags.fm" OR bagsapp OR "Bags app") (launch OR announces OR shipped OR release) -is:retweet -is:reply lang:en',
};
export type PublicXResearchPost = {
  id: string;
  authorId: string;
  username: string;
  text: string;
  publishedAt: number;
};
/** Fail closed for missing author privacy, private posts, partial responses and
 * malformed dates. Search membership is never proof of a platform or ticker. */
export function publicXResearchPosts(
  raw: unknown,
  now: number,
): PublicXResearchPost[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const root = raw as Record<string, unknown>;
  if (root.errors || !Array.isArray(root.data) || root.data.length > 10)
    return [];
  const includes = root.includes as { users?: unknown[] } | undefined;
  if (!Array.isArray(includes?.users) || includes.users.length > 10) return [];
  const users = new Map<string, Record<string, unknown>>();
  for (const value of includes?.users ?? []) {
    if (value && typeof value === "object") {
      const u = value as Record<string, unknown>;
      if (typeof u.id === "string") {
        if (users.has(u.id)) return [];
        users.set(u.id, u);
      }
    }
  }
  return root.data.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const p = value as Record<string, unknown>;
    const user =
      typeof p.author_id === "string" ? users.get(p.author_id) : null;
    const at =
      typeof p.created_at === "string" ? Date.parse(p.created_at) : NaN;
    if (
      typeof p.id !== "string" ||
      !/^\d{8,20}$/.test(p.id) ||
      typeof p.author_id !== "string" ||
      !/^\d{1,20}$/.test(p.author_id) ||
      !user ||
      user.protected !== false ||
      typeof user.username !== "string" ||
      !/^[A-Za-z0-9_]{1,15}$/.test(user.username) ||
      typeof p.text !== "string" ||
      !p.text.trim() ||
      p.text.length > 4000 ||
      p.possibly_sensitive === true ||
      !Number.isFinite(at) ||
      at > now + 5 * 60_000 ||
      now - at > 24 * 3600_000 ||
      (Array.isArray(p.referenced_tweets) &&
        p.referenced_tweets.some(
          (r) =>
            r &&
            typeof r === "object" &&
            ["retweeted", "replied_to"].includes(
              String((r as Record<string, unknown>).type),
            ),
        ))
    )
      return [];
    return [
      {
        id: p.id,
        authorId: p.author_id,
        username: user.username,
        text: p.text,
        publishedAt: at,
      },
    ];
  });
}
