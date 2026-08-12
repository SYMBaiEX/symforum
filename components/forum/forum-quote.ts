import {
  getThreadAuthor,
  type ForumPostRecord,
} from "@/components/forum/forum-refs";
import { isForumUsername } from "@/lib/forum-mentions";

const MAX_QUOTED_BODY_CHARS = 2_000;

export function buildPostQuote(post: ForumPostRecord) {
  const author = getThreadAuthor(post);
  const username = post.authorUsername?.trim().toLowerCase();
  const mention =
    username !== undefined && isForumUsername(username)
      ? `@${username}\n\n`
      : "";
  const cleanBody = post.body
    .replace(/\[quote(?:=[^\]]+)?\][\s\S]*?\[\/quote\]/gi, "")
    .replace(/\[\/?quote[^\]]*\]/gi, "")
    .trim()
    .slice(0, MAX_QUOTED_BODY_CHARS);
  return `${mention}[quote=${author}]\n${cleanBody}\n[/quote]\n\n`;
}
