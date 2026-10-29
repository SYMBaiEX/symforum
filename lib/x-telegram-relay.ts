/** Only authenticated X timeline results enter this parser; never arbitrary webhooks. */
import { installation } from "./installation";
export const SYMFORUM_X_USER_ID = installation.x.publisherUserId;
export function relayPost(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (
    typeof p.id !== "string" ||
    !/^\d{1,19}$/.test(p.id) ||
    p.author_id !== SYMFORUM_X_USER_ID ||
    typeof p.text !== "string" ||
    !p.text.trim() ||
    p.text.length > 25000 ||
    typeof p.created_at !== "string" ||
    !Number.isFinite(Date.parse(p.created_at)) ||
    p.possibly_sensitive === true ||
    (p.referenced_tweets !== undefined && !Array.isArray(p.referenced_tweets))
  )
    return null;
  if (
    Array.isArray(p.referenced_tweets) &&
    p.referenced_tweets.some(
      (r: unknown) =>
        !r ||
        typeof r !== "object" ||
        !["replied_to", "quoted"].includes(
          String((r as Record<string, unknown>).type),
        ),
    )
  )
    return null;
  return {
    id: p.id,
    authorId: SYMFORUM_X_USER_ID,
    text: p.text,
    createdAt: Date.parse(p.created_at),
  };
}
export function relayMessage(text: string, postId: string) {
  if (!/^\d{1,19}$/.test(postId)) throw Error("Invalid public post ID");
  // Plain text: X content cannot inject Telegram formatting or hidden links.
  const excerpt =
    text.length > 3500
      ? text.slice(0, 3499).replace(/[\uD800-\uDBFF]$/, "") + "…"
      : text;
  return `@${installation.x.accounts.symforum} on X\n\n${excerpt}\n\nhttps://x.com/${installation.x.accounts.symforum}/status/${postId}`;
}
