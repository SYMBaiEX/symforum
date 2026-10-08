import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appDirectory = dirname(fileURLToPath(import.meta.url));
const forumSiteUrl = process.env.NEXT_PUBLIC_FORUM_SITE_URL ?? "https://forum.symbaiex.com";
const blogSiteUrl = process.env.NEXT_PUBLIC_BLOG_SITE_URL ?? "https://blog.symbaiex.com";
const newsSiteUrl = process.env.NEXT_PUBLIC_NEWS_SITE_URL ?? "https://news.symbaiex.com";
const newsletterSiteUrl =
  process.env.NEXT_PUBLIC_NEWSLETTER_SITE_URL ?? "https://newsletter.symbaiex.com";

const nextConfig: NextConfig = {
  outputFileTracingRoot: join(appDirectory, "../.."),
  deploymentId: (
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    "local"
  ).slice(0, 32),
  poweredByHeader: false,
  reactCompiler: true,
  // Shared components contain routes owned by the sibling apps.
  typedRoutes: false,
  transpilePackages: [
    "@symbaiex/auth",
    "@symbaiex/forum-plugin-contract",
    "@symbaiex/forum-ui",
  ],
  turbopack: {
    root: join(appDirectory, "../.."),
  },
  async redirects() {
    return [
      {
        source: "/forum",
        destination: forumSiteUrl,
        permanent: true,
      },
      {
        source: "/forum/:path*",
        destination: `${forumSiteUrl}/:path*`,
        permanent: true,
      },
      {
        source: "/agent/forum-connect",
        destination: `${forumSiteUrl}/agent/forum-connect`,
        permanent: true,
      },
      {
        source: "/blog",
        destination: `${blogSiteUrl}/blog`,
        permanent: true,
      },
      {
        source: "/blog/:path*",
        destination: `${blogSiteUrl}/blog/:path*`,
        permanent: true,
      },
      {
        source: "/news",
        destination: `${newsSiteUrl}/news`,
        permanent: true,
      },
      {
        source: "/news/:path*",
        destination: `${newsSiteUrl}/news/:path*`,
        permanent: true,
      },
      {
        source: "/newsletter",
        destination: `${newsletterSiteUrl}/newsletter`,
        permanent: true,
      },
      {
        source: "/newsletter/:path*",
        destination: `${newsletterSiteUrl}/newsletter/:path*`,
        permanent: true,
      },
      {
        source: "/register",
        destination: "/signin?mode=signUp&redirectTo=/forum",
        permanent: false,
      },
      {
        source: "/signup",
        destination: "/signin?mode=signUp&redirectTo=/forum",
        permanent: false,
      },
      {
        source: "/login",
        destination: "/signin?mode=signIn&redirectTo=/forum",
        permanent: false,
      },
      {
        source: "/images/forum/agents/:slug.png",
        destination: "/images/forum/agents/:slug.webp",
        permanent: true,
      },
      {
        source: "/images/forum/suki-space-pirate.png",
        destination: "/images/forum/suki-space-pirate.webp",
        permanent: true,
      },
      {
        source: "/images/forum/belle-neko-news.png",
        destination: "/images/forum/belle-neko-news.webp",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/images/:path*",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800",
          },
        ],
      },
      {
        source: "/((?!_next|api|.*\\..*).*)",
        headers: [{ key: "Vary", value: "Accept, Host" }],
      },
    ];
  },
  images: {
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "symbaiex.com" },
      { protocol: "https", hostname: "www.symbaiex.com" },
      { protocol: "https", hostname: "*.convex.cloud" },
      { protocol: "https", hostname: "*.convex.site" },
    ],
  },
};

export default nextConfig;
