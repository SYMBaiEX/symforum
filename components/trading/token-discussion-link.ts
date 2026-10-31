import { forumHrefForPathname } from "../forum/forum-refs";
import { FORUM_SITE_URL, forumSiteUrl } from "../../lib/site-urls";

/** Share an existing validated discussion path on the canonical website, never the host iframe. */
export function tokenDiscussionLink(path: string | null): string | null {
  if (
    !path ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(path)
  )
    return null;
  try {
    const url = new URL(forumSiteUrl(forumHrefForPathname(path, "/")));
    return url.origin === new URL(FORUM_SITE_URL).origin &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
