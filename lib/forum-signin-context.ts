import { safeIdentityReturnTo } from "./identity-config";

// Display/navigation state only. Never carry an auth payload or nested return URL.
const contextKeys = new Set([
  "view",
  "scope",
  "authors",
  "author",
  "sort",
  "q",
  "mint",
  "page",
  "perPage",
  "size",
  "postPage",
  "threadPage",
  "replyPage",
  "board",
  "type",
  "target",
  "days",
  "section",
]);

export function forumSignInHref(
  pathname: string | null,
  search = "",
  hash = "",
) {
  let path = pathname ?? "/forum";
  try {
    // Keep ordinary UTF-8 slugs, but reject encoded routing delimiters,
    // double encoding, control characters and normalized dot-segment paths.
    const decoded = decodeURIComponent(path);
    if (
      path.length > 1024 ||
      /[?#]/.test(path) ||
      /%(?:2f|5c|25|3f|23)/i.test(path) ||
      /[\\\u0000-\u001f\u007f]/.test(decoded) ||
      decoded.split("/").some((part) => part === "." || part === "..") ||
      /^\/(?:forum\/)?(?:api|auth|signin|signup|login|register)(?:\/|$)/i.test(
        decoded,
      ) ||
      !path.startsWith("/") ||
      path.startsWith("//")
    )
      path = "/forum";
    else path = safeIdentityReturnTo(path);
  } catch {
    path = "/forum";
  }
  const params = new URLSearchParams(search);
  const retained = new URLSearchParams();
  for (const [key, value] of params) {
    if (
      !contextKeys.has(key) ||
      params.getAll(key).length !== 1 ||
      value.length > 256 ||
      /[\\\u0000-\u001f\u007f]/.test(value)
    )
      continue;
    retained.set(key, value);
  }
  // Fragment identifiers, not fragment-carried credentials or URL payloads.
  const anchor = /^#[\p{L}\p{N}_.:-]{1,128}$/u.test(hash) ? hash : "";
  const query = retained.toString();
  const destination = safeIdentityReturnTo(
    `${path}${query ? `?${query}` : ""}${anchor}`,
  );
  return `/signin?${new URLSearchParams({ redirectTo: destination })}`;
}
