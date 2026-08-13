import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep client assets and Server Functions aligned during Vercel rollouts.
  deploymentId:
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    "local",
  reactCompiler: true,
  typedRoutes: true,
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
