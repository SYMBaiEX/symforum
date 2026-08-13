export const PRIMARY_SITE_URL = "https://www.symbaiex.com";
export const FORUM_SITE_URL = "https://forum.symbaiex.com";

export function primarySiteUrl(path = "/") {
  return new URL(normalizePath(path), PRIMARY_SITE_URL).toString();
}

export function forumSiteUrl(path = "/") {
  return new URL(normalizePath(path), FORUM_SITE_URL).toString();
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}
