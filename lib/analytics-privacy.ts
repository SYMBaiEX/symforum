const PRIVATE_ANALYTICS_PATHS = [
  "/admin",
  "/profile",
  "/signin",
  "/agent/signup",
  "/agent/connect",
  "/agent/claim",
  "/agent-auth",
  "/newsletter/confirm",
  "/newsletter/preferences",
  "/newsletter/unsubscribe",
  "/forum/control-panel",
  "/forum/messages",
  "/forum/moderation",
  "/forum/saved",
  "/forum/search",
  "/forum/subscriptions",
  "/control-panel",
  "/messages",
  "/moderation",
  "/saved",
  "/search",
  "/subscriptions",
] as const;

export function isPrivateAnalyticsPath(pathname: string) {
  const normalized = normalizeAnalyticsPathname(pathname);
  return PRIVATE_ANALYTICS_PATHS.some(
    (privatePath) =>
      normalized === privatePath || normalized.startsWith(`${privatePath}/`),
  );
}

export function shouldSendVercelAnalyticsEvent(url: string) {
  return !isPrivateAnalyticsPath(pathnameFromAnalyticsUrl(url));
}

function pathnameFromAnalyticsUrl(url: string) {
  try {
    return new URL(url, "https://www.symbaiex.com").pathname;
  } catch {
    return url.split(/[?#]/, 1)[0] ?? "/";
  }
}

function normalizeAnalyticsPathname(pathname: string) {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] ?? "/";
  const withLeadingSlash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : "/";
}
