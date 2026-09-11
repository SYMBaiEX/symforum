import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    environment: "edge-runtime",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["**/node_modules/**", "**/.claude/worktrees/**"],
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
