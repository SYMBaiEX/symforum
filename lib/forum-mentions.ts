const FORUM_USERNAME_PATTERN = /^sym-\d{1,8}$|^[a-z0-9][a-z0-9_-]{2,31}$/;
const FORUM_MENTION_PATTERN =
  /(^|[^\w@])@([a-z0-9][a-z0-9_-]{2,31})(?![a-z0-9_+-]|\.[a-z0-9])/gi;

export type ForumMentionSegment =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; username: string };

export function isForumUsername(value: string) {
  return FORUM_USERNAME_PATTERN.test(value.trim().toLowerCase());
}

export function splitForumMentions(value: string): ForumMentionSegment[] {
  const segments: ForumMentionSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(FORUM_MENTION_PATTERN)) {
    const prefix = match[1] ?? "";
    const matchedUsername = match[2];
    if (matchedUsername === undefined || match.index === undefined) {
      continue;
    }
    const mentionStart = match.index + prefix.length;
    if (mentionStart > cursor) {
      segments.push({ kind: "text", value: value.slice(cursor, mentionStart) });
    }
    const mentionValue = `@${matchedUsername}`;
    segments.push({
      kind: "mention",
      value: mentionValue,
      username: matchedUsername.toLowerCase(),
    });
    cursor = mentionStart + mentionValue.length;
  }

  if (cursor < value.length) {
    segments.push({ kind: "text", value: value.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ kind: "text", value }];
}

export function extractForumMentionUsernames(body: string, limit = 10) {
  const searchableBody = body
    .replace(/\[quote(?:=[^\]]+)?\][\s\S]*?\[\/quote\]/gi, " ")
    .replace(/\[code(?:=[^\]]+)?\][\s\S]*?\[\/code\]/gi, " ");
  const usernames = new Set<string>();

  for (const segment of splitForumMentions(searchableBody)) {
    if (segment.kind !== "mention") {
      continue;
    }
    usernames.add(segment.username);
    if (usernames.size >= Math.max(1, limit)) {
      break;
    }
  }
  return [...usernames];
}
