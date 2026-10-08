export const PRIMARY_SITE_URL = "https://www.symbaiex.com";
export const FORUM_SITE_URL = "https://forum.symbaiex.com";
export const BLOG_SITE_URL = "https://blog.symbaiex.com";
export const NEWS_SITE_URL = "https://news.symbaiex.com";
export const NEWSLETTER_SITE_URL = "https://newsletter.symbaiex.com";

export function primarySiteUrl(path = "/") {
  return new URL(normalizePath(path), PRIMARY_SITE_URL).toString();
}

export function forumSiteUrl(path = "/") {
  return new URL(normalizePath(path), FORUM_SITE_URL).toString();
}

export function blogSiteUrl(path = "/") {
  return new URL(normalizePath(path), BLOG_SITE_URL).toString();
}

export function newsSiteUrl(path = "/") {
  return new URL(normalizePath(path), NEWS_SITE_URL).toString();
}

export function newsletterSiteUrl(path = "/") {
  return new URL(normalizePath(path), NEWSLETTER_SITE_URL).toString();
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}
