import { installation } from "./installation";
export const PRIMARY_SITE_URL = installation.sites.primary;
export const FORUM_SITE_URL = installation.sites.forum;
export const FORUM_TELEGRAM_URL = installation.telegram.url;
export const BLOG_SITE_URL = installation.sites.blog;
export const NEWS_SITE_URL = installation.sites.news;
export const NEWSLETTER_SITE_URL = installation.sites.newsletter;

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

export const INSTALLATION_NAMESPACE = installation.identity.cookieDomain || new URL(PRIMARY_SITE_URL).hostname;

/** Explicit owned apex preserves canonical legacy contracts without inventing a host. */
export const APEX_SITE_URL = installation.identity.extraOrigins.find(origin => Boolean(installation.identity.cookieDomain) && new URL(origin).hostname === installation.identity.cookieDomain && origin.startsWith("https:")) ?? PRIMARY_SITE_URL;
