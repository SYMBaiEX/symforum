import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep client assets and Server Functions aligned during Vercel rollouts.
  deploymentId: (
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    "local"
  ).slice(0, 32),
  poweredByHeader: false,
  reactCompiler: true,
  typedRoutes: true,
  async redirects() {
    return [
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
        source: "/forum/register",
        destination: "/signin?mode=signUp&redirectTo=/forum",
        permanent: false,
      },
      {
        source: "/forum/login",
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
  async rewrites() {
    return {
      fallback: [
        {
          source: "/:path*",
          has: [
            {
              type: "header",
              key: "x-symbaiex-markdown-404",
              value: "1",
            },
          ],
          destination: "/markdown/__not-found",
        },
      ],
    };
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
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "symbaiex.com",
      },
      {
        protocol: "https",
        hostname: "www.symbaiex.com",
      },
      {
        protocol: "https",
        hostname: "*.convex.cloud",
      },
      {
        protocol: "https",
        hostname: "*.convex.site",
      },
    ],
  },
};

export default nextConfig;
