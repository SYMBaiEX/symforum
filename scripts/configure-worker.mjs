#!/usr/bin/env bun
import { readFile, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

// Only explicit deployment metadata. Credentials remain in Wrangler secrets.
const worker = process.argv[2];
if (
  process.argv.length !== 3 ||
  !["socials", "eliza-shadow-gateway"].includes(worker)
)
  throw Error("Usage: bun run setup:worker socials|eliza-shadow-gateway");
function setting(key, pattern) {
  const value = process.env[key] ?? "";
  if (!pattern.test(value))
    throw Error(`Set a valid ${key} for your own resources.`);
  return value;
}
const account = setting("CLOUDFLARE_ACCOUNT_ID", /^[a-f0-9]{32}$/);
const name = setting("CLOUDFLARE_WORKER_NAME", /^[a-z][a-z0-9-]{0,62}$/);
const root = resolve(import.meta.dirname, "..", "workers", worker);
const template = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  await readFile(resolve(root, "wrangler.jsonc"), "utf8"),
);
if (template.error) throw Error("Invalid worker configuration template.");
const configuration = { ...template.config, account_id: account, name };
if (worker === "socials") {
  const database = setting(
    "SOCIALS_D1_DATABASE_ID",
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,
  );
  const databaseName = setting(
    "SOCIALS_D1_DATABASE_NAME",
    /^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/,
  );
  const domain = setting(
    "SOCIALS_DOMAIN",
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/,
  );
  configuration.routes = [{ pattern: domain, custom_domain: true }];
  configuration.d1_databases = configuration.d1_databases.map((d) => ({
    ...d,
    database_name: databaseName,
    database_id: database,
  }));
}
// Same directory preserves Docker context, assets and migration path boundaries.
const output = resolve(root, "wrangler.deploy.local.json");
await writeFile(output, JSON.stringify(configuration, null, 2) + "\n", {
  mode: 0o600,
});
await chmod(output, 0o600);
console.log(
  `Wrote ${output}. Review your target before deploying; no resources were created.`,
);
