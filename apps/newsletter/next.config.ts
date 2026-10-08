import path from "node:path";
import type { NextConfig } from "next";

const workspaceRoot = path.resolve(process.cwd(), "../..");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactCompiler: true,
  // This standalone zone imports shared components whose routes belong to
  // other applications in the monorepo.
  typedRoutes: false,
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@symbaiex/auth"],
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
