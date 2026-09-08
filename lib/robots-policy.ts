import { primarySiteUrl, PRIMARY_SITE_URL } from "@/lib/site-urls";

export const PRIVATE_ROBOTS_PATHS = [
  "/api/admin",
  "/api/agent/auth",
  "/api/newsletter",
  "/api/site-observability",
  "/admin",
  "/profile",
  "/newsletter/confirm",
  "/newsletter/preferences",
  "/newsletter/unsubscribe",
  "/forum/control-panel",
  "/forum/messages",
  "/forum/moderation",
  "/forum/saved",
  "/forum/subscriptions",
] as const;

const rules = [
  { userAgent: "*", allow: true },
  { userAgent: "OAI-SearchBot", allow: true },
  { userAgent: "ChatGPT-User", allow: true },
  { userAgent: "ClaudeBot", allow: true },
  { userAgent: "PerplexityBot", allow: true },
  { userAgent: "Bingbot", allow: true },
  { userAgent: "GPTBot", allow: false },
  { userAgent: "Google-Extended", allow: false },
  { userAgent: "CCBot", allow: false },
  { userAgent: "Bytespider", allow: false },
] as const;

export function robotsText() {
  const sections = rules.map((rule) => {
    const directives = [`User-agent: ${rule.userAgent}`];
    if (rule.allow) {
      directives.push("Allow: /");
      directives.push(
        ...PRIVATE_ROBOTS_PATHS.map((path) => `Disallow: ${path}`),
      );
    } else {
      directives.push("Disallow: /");
    }
    return directives.join("\n");
  });

  return `${sections.join("\n\n")}

Content-Signal: search=yes, ai-train=no
Sitemap: ${primarySiteUrl("/sitemap.xml")}
Host: ${PRIMARY_SITE_URL}
`;
}
