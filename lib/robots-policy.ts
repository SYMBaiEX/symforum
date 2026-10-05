import { primarySiteUrl, PRIMARY_SITE_URL } from "@/lib/site-urls";

export const PRIVATE_ROBOTS_PATHS = [
  "/api/admin",
  "/api/agent/auth",
  "/api/newsletter",
  "/api/site-observability",
  "/admin",
  "/profile",
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
  "/forum/subscriptions",
] as const;

const PUBLIC_ROBOTS_EXCEPTIONS = [
  // Public service_auth discovery documents; other /agent-auth operations stay disallowed.
  "/agent-auth/.well-known/oauth-authorization-server",
  "/agent-auth/jwks",
] as const;

const SEARCH_ONLY_SIGNAL = "search=yes, ai-train=no";

const rules = [
  { userAgent: "*", allow: true, contentSignal: SEARCH_ONLY_SIGNAL },
  {
    userAgent: "OAI-SearchBot",
    allow: true,
    contentSignal: SEARCH_ONLY_SIGNAL,
  },
  { userAgent: "ChatGPT-User", allow: true, contentSignal: SEARCH_ONLY_SIGNAL },
  { userAgent: "ClaudeBot", allow: true, contentSignal: SEARCH_ONLY_SIGNAL },
  {
    userAgent: "Claude-SearchBot",
    allow: true,
    contentSignal: SEARCH_ONLY_SIGNAL,
  },
  {
    userAgent: "PerplexityBot",
    allow: true,
    contentSignal: SEARCH_ONLY_SIGNAL,
  },
  { userAgent: "Bingbot", allow: true, contentSignal: SEARCH_ONLY_SIGNAL },
  {
    userAgent: "GPTBot",
    allow: true,
    contentSignal: "search=yes, ai-train=yes",
  },
  {
    userAgent: "Google-Extended",
    allow: false,
    contentSignal: SEARCH_ONLY_SIGNAL,
  },
  { userAgent: "CCBot", allow: false, contentSignal: SEARCH_ONLY_SIGNAL },
  {
    userAgent: "Bytespider",
    allow: false,
    contentSignal: SEARCH_ONLY_SIGNAL,
  },
] as const;

export function robotsText() {
  const sections = rules.map((rule) => {
    const directives = [
      `User-agent: ${rule.userAgent}`,
      `Content-Signal: ${rule.contentSignal}`,
    ];
    if (rule.allow) {
      directives.push("Allow: /");
      directives.push(
        ...PRIVATE_ROBOTS_PATHS.map((path) => `Disallow: ${path}`),
      );
      directives.push(
        ...PUBLIC_ROBOTS_EXCEPTIONS.map((path) => `Allow: ${path}`),
      );
    } else {
      directives.push("Disallow: /");
    }
    return directives.join("\n");
  });

  return `${sections.join("\n\n")}

Schemamap: ${primarySiteUrl("/schemamap.xml")}
Sitemap: ${primarySiteUrl("/sitemap.xml")}
Host: ${PRIMARY_SITE_URL}
`;
}
