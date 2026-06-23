import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "npm run build",
  devCommand: "npm run dev",
  crons: [
    {
      path: "/api/cron/news",
      schedule: "0 11 * * *",
    },
  ],
};
