import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  installCommand: "bun install --frozen-lockfile",
  buildCommand: "bun run build",
  devCommand: "bun run dev",
  headers: [
    {
      source: "/((?!_next|api|.*\\..*).*)",
      headers: [{ key: "Vary", value: "Accept, Host" }],
    },
  ],
};
