import { parseInstallationConfig } from "./installation-config";

// Public identity only. Next inlines this exact reference in browser builds.
// Convex declares the same public variable and validates it in its own adapter.
export const installation = parseInstallationConfig(
  process.env.NEXT_PUBLIC_INSTALLATION_CONFIG,
);
