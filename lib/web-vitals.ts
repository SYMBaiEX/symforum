export const WEB_VITAL_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export const WEB_VITAL_RATINGS = ["good", "needs-improvement", "poor"] as const;
export const WEB_VITAL_NAVIGATION_TYPES = [
  "navigate",
  "reload",
  "back-forward",
  "prerender",
] as const;

export type WebVitalMetricName = (typeof WEB_VITAL_METRICS)[number];
export type WebVitalRating = (typeof WEB_VITAL_RATINGS)[number];
export type WebVitalNavigationType =
  (typeof WEB_VITAL_NAVIGATION_TYPES)[number];

export const WEB_VITAL_BUDGETS: Record<WebVitalMetricName, number> = {
  LCP: 2_500,
  INP: 200,
  CLS: 0.1,
  FCP: 1_800,
  TTFB: 800,
};

const PRIVATE_PATH_PREFIXES = [
  "/admin",
  "/profile",
  "/signin",
  "/agent/signup",
  "/newsletter/confirm",
  "/newsletter/preferences",
  "/newsletter/unsubscribe",
  "/forum/control-panel",
  "/forum/messages",
  "/forum/moderation",
  "/forum/saved",
  "/forum/search",
  "/forum/subscriptions",
] as const;

const STATIC_PUBLIC_ROUTES = new Set([
  "/",
  "/about",
  "/agent",
  "/ai-policy",
  "/blog",
  "/contact",
  "/developer",
  "/forum",
  "/forum/agents",
  "/forum/announcements",
  "/forum/calendar",
  "/forum/help",
  "/forum/members",
  "/forum/new-posts",
  "/forum/online",
  "/forum/todays-posts",
  "/news",
  "/newsletter",
  "/portfolio",
  "/research",
  "/research/ai-readable-web",
  "/research/editorial-trust-and-contracts",
  "/research/methodology",
]);

const PUBLIC_DYNAMIC_ROUTES: Array<{ pattern: RegExp; template: string }> = [
  { pattern: /^\/blog\/[^/]+$/, template: "/blog/[slug]" },
  {
    pattern: /^\/forum\/announcements\/[^/]+$/,
    template: "/forum/announcements/[slug]",
  },
  {
    pattern: /^\/forum\/calendar\/[^/]+$/,
    template: "/forum/calendar/[slug]",
  },
  { pattern: /^\/forum\/help\/[^/]+$/, template: "/forum/help/[slug]" },
  {
    pattern: /^\/forum\/members\/[^/]+$/,
    template: "/forum/members/[username]",
  },
  {
    pattern: /^\/forum\/[^/]+\/[^/]+$/,
    template: "/forum/[categorySlug]/[threadSlug]",
  },
  { pattern: /^\/forum\/[^/]+$/, template: "/forum/[categorySlug]" },
  { pattern: /^\/news\/[^/]+$/, template: "/news/[hnItemId]" },
  { pattern: /^\/newsletter\/[^/]+$/, template: "/newsletter/[slug]" },
  { pattern: /^\/portfolio\/[^/]+$/, template: "/portfolio/[slug]" },
  { pattern: /^\/u\/[^/]+$/, template: "/u/[username]" },
];

export function publicRouteTemplate(pathname: string): string | null {
  const path = pathname.split("?")[0]?.split("#")[0] ?? "";
  if (!path.startsWith("/") || path.includes("//")) return null;
  if (
    PRIVATE_PATH_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  ) {
    return null;
  }
  if (STATIC_PUBLIC_ROUTES.has(path)) return path;
  return (
    PUBLIC_DYNAMIC_ROUTES.find(({ pattern }) => pattern.test(path))?.template ??
    null
  );
}

export function isWebVitalsEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() !== "false";
}
