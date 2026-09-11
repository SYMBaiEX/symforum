import { afterEach, beforeEach, vi } from "vitest";

// Convex-test's generated identities use this issuer. Model the platform's
// CONVEX_SITE_URL instead of relaxing issuer checks in production code.
beforeEach(({ task }) => {
  if (task.file.filepath.includes("/convex/"))
    vi.stubEnv("CONVEX_SITE_URL", "https://convex.test");
});
afterEach(() => vi.unstubAllEnvs());
