import { installation } from "../../lib/installation";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { NextConfig } from "next";

const appDirectory = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: join(appDirectory, "../.."),
  poweredByHeader: false,
  reactCompiler: true,
  // Shared components also contain destinations owned by the primary app.
  typedRoutes: false,
  transpilePackages: ["@symbaiex/auth"],
  turbopack: {
    root: join(appDirectory, "../.."),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: new URL(installation.sites.primary).hostname },
      { protocol: "https", hostname: new URL(installation.sites.blog).hostname },
      { protocol: "https", hostname: "*.convex.cloud" },
      { protocol: "https", hostname: "*.convex.site" },
    ],
  },
};

export default nextConfig;
