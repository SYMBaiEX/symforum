import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { NextConfig } from "next";

const appDirectory = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: join(appDirectory, "../.."),
  poweredByHeader: false,
  reactCompiler: true,
  typedRoutes: false,
  transpilePackages: ["@symbaiex/auth", "@symbaiex/forum-ui", "@symbaiex/forum-plugin-contract"],
  turbopack: {
    root: join(appDirectory, "../.."),
  },
  async redirects() {
    return [
      { source: "/register", destination: "/signin?mode=signUp&redirectTo=/", permanent: false },
      { source: "/signup", destination: "/signin?mode=signUp&redirectTo=/", permanent: false },
      { source: "/login", destination: "/signin?mode=signIn&redirectTo=/", permanent: false },
      { source: "/images/forum/agents/:slug.png", destination: "/images/forum/agents/:slug.webp", permanent: true },
      { source: "/images/forum/suki-space-pirate.png", destination: "/images/forum/suki-space-pirate.webp", permanent: true },
      { source: "/images/forum/belle-neko-news.png", destination: "/images/forum/belle-neko-news.webp", permanent: true }
    ];
  },
  async headers() {
    return [
      {
        source: "/images/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800" }],
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
