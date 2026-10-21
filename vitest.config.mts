import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@/app": fileURLToPath(new URL("./apps/platform/app", import.meta.url)),
      "@symbaiex/auth/query-cache": fileURLToPath(
        new URL("./packages/auth/src/query-cache.ts", import.meta.url),
      ),
      "@symbaiex/auth/client": fileURLToPath(
        new URL("./tests/mocks/auth-client.tsx", import.meta.url),
      ),
      "@workos-inc/authkit-nextjs/components": fileURLToPath(
        new URL("./tests/mocks/workos-components.tsx", import.meta.url),
      ),
      "@workos-inc/authkit-nextjs": fileURLToPath(
        new URL("./tests/mocks/workos-server.ts", import.meta.url),
      ),
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    environment: "edge-runtime",
    setupFiles: ["./vitest.setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.claude/worktrees/**",
      "tests/e2e/**",
      "workers/eliza-shadow/**",
      "workers/eliza-shadow-gateway/**",
    ],
    server: {
      deps: {
        inline: ["convex-test", "@convex-dev/auth"],
      },
    },
  },
});
