import { primarySiteUrl, PRIMARY_SITE_URL } from "@/lib/site-urls";
import type { MetadataRoute } from "next";

const PRIVATE_PATHS = [
  "/admin",
  "/profile",
  "/signin",
  "/newsletter/confirm",
  "/newsletter/preferences",
  "/newsletter/unsubscribe",
  "/forum/control-panel",
  "/forum/messages",
  "/forum/moderation",
  "/forum/saved",
  "/forum/subscriptions",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      // Search discovery is allowed; training-oriented crawlers remain explicit.
      { userAgent: "OAI-SearchBot", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "GPTBot", disallow: "/" },
      { userAgent: "Google-Extended", disallow: "/" },
      { userAgent: "Bingbot", allow: "/", disallow: PRIVATE_PATHS },
    ],
    sitemap: primarySiteUrl("/sitemap.xml"),
    host: PRIMARY_SITE_URL,
  };
}
