import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  // Keep the native forum bundle reproducible with the repository's runtime.
  // Vercel's default Bun version can lag behind packageManager.
  installCommand:
    "cd ../.. && bunx --package bun@1.4.2 bun install --frozen-lockfile",
  buildCommand: "bunx --package bun@1.4.2 bun run build",
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
