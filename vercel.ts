import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  // The native forum bundler must match the version used by CI and local builds.
  installCommand:
    "npx --yes --prefix /tmp --package=bun@1.4.2 bun install --frozen-lockfile",
  buildCommand: "npx --yes --prefix /tmp --package=bun@1.4.2 bun run build",
  devCommand: "bun run dev",
  headers: [
    {
      source: "/images/:path*",
      headers: [
        {
          key: "Cache-Control",
          value:
            "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800",
        },
      ],
    },
    {
      source: "/((?!_next|api|.*\\..*).*)",
      headers: [{ key: "Vary", value: "Accept, Host" }],
    },
  ],
};
