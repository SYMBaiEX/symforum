#!/usr/bin/env node
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// Local artifact generation only. No provider calls or environment mutations.
const output = process.argv[2];
if (!output || process.argv.length !== 3) {
  console.error(
    "Usage: bun scripts/setup-agent-service-auth.mjs /absolute/new/private-directory",
  );
  process.exit(1);
}
try {
  const directory = resolve(output);
  if (directory !== output) throw new Error("Use an absolute new directory.");
  await mkdir(directory, { mode: 0o700 }); // Refuse existing output; never overwrite keys.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
  });
  const kid = `service-${randomBytes(12).toString("hex")}`;
  const privateJwk = {
    ...privateKey.export({ format: "jwk" }),
    kid,
    alg: "RS256",
    use: "sig",
  };
  const publicJwks = {
    keys: [
      { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" },
    ],
  };
  const values = {
    AGENT_SERVICE_AUTH_PRIVATE_JWK: JSON.stringify(privateJwk),
    AGENT_SERVICE_AUTH_PUBLIC_JWKS: JSON.stringify(publicJwks),
    AGENT_SERVICE_AUTH_RELAY_SECRET: randomBytes(48).toString("base64url"),
  };
  for (const [name, value] of Object.entries(values))
    await writeFile(join(directory, name), value, { mode: 0o600, flag: "wx" });
  console.log(
    `Created three protected configuration files in ${directory}. Nothing deployed or enabled. Do not paste their contents into chat or logs.`,
  );
} catch {
  console.error(
    "Setup failed; verify the absolute output directory is new and writable. No secrets were printed.",
  );
  process.exitCode = 1;
}
