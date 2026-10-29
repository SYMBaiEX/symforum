import { afterEach, beforeEach, vi } from "vitest";
import installationFixture from "./tests/fixtures/installation.symbaiex.json";
import { installationRoutingBinding, parseInstallationConfig } from "./lib/installation-config";

// Non-secret compatibility fixture. Real deployments must supply their own config.
process.env.NEXT_PUBLIC_INSTALLATION_CONFIG = JSON.stringify(installationFixture);
process.env.INSTALLATION_LEGACY_BINDING = installationRoutingBinding(parseInstallationConfig(JSON.stringify(installationFixture)));
process.env.NEXT_PUBLIC_CONVEX_URL = "https://strong-bee-384.convex.cloud";
process.env.AGENT_AUTH_CERTIFICATION_DEPLOYMENT = "strong-bee-384";

// Convex-test's generated identities use this issuer. Model the platform's
// CONVEX_SITE_URL instead of relaxing issuer checks in production code.
beforeEach(({ task }) => {
  if (task.file.filepath.includes("/convex/"))
    vi.stubEnv("CONVEX_SITE_URL", "https://convex.test");
});
afterEach(() => vi.unstubAllEnvs());
