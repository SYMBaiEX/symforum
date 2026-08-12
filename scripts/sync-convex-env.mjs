import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environmentPath = resolve(projectRoot, ".env");

const convexEnvironmentKeys = [
  "AI_GATEWAY_API_KEY",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "CONTACT_FROM_EMAIL",
  "CONTACT_NOTIFICATION_TO",
  "FORUM_EMAIL_NOTIFICATIONS_ENABLED",
  "FORUM_FROM_EMAIL",
  "FORUM_REPLY_TO",
  "FORUM_SITE_URL",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "JWKS",
  "JWT_PRIVATE_KEY",
  "MUSE_API_BASE_URL",
  "MUSE_API_KEY",
  "OPENROUTER_API_KEY",
  "NEWSLETTER_FROM_EMAIL",
  "NEWSLETTER_REPLY_TO",
  "NEWSLETTER_SITE_URL",
  "OWNER_BOOTSTRAP_TOKEN",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "SITE_URL",
];

if (!existsSync(environmentPath)) {
  console.error("Missing .env. Copy .env.example to .env and add your values.");
  process.exit(1);
}

const loaded = config({ path: environmentPath });
if (loaded.error) {
  console.error(`Could not load .env: ${loaded.error.message}`);
  process.exit(1);
}

const environment = loaded.parsed ?? {};
const configuredVariables = convexEnvironmentKeys.filter((key) =>
  environment[key]?.trim(),
);
const isCheck = process.argv.includes("--check");
const isProduction = process.argv.includes("--prod");

if (configuredVariables.length === 0) {
  console.error("No Convex environment variables are populated in .env.");
  process.exit(1);
}

console.log(
  `${configuredVariables.length} Convex variable${configuredVariables.length === 1 ? "" : "s"} configured in .env:`,
);
for (const key of configuredVariables) {
  console.log(`- ${key}`);
}

if (isCheck) {
  process.exit(0);
}

const target = isProduction ? "production" : "development";
console.log(`Syncing populated values to the Convex ${target} deployment...`);

for (const key of configuredVariables) {
  const value = environment[key];
  const convexArguments = ["convex", "env", "set"];
  if (isProduction) {
    convexArguments.push("--prod");
  }
  convexArguments.push(key);

  const result = spawnSync("bunx", convexArguments, {
    cwd: projectRoot,
    encoding: "utf8",
    input: `${value}\n`,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    console.error(
      `Failed to sync ${key} (Convex CLI exit ${result.status ?? "unknown"}).`,
    );
    process.exit(result.status ?? 1);
  }

  console.log(`Synced ${key}.`);
}

console.log(`Convex ${target} environment is up to date.`);
