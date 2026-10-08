import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  retries: 0,
  outputDir: "./tmp/forum-render-tests",
  reporter: "list",
  use: { browserName: "chromium", headless: true },
});
