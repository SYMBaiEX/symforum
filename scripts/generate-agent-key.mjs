#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputArgIndex = process.argv.indexOf("--output");
const outputPath = resolve(
  outputArgIndex >= 0
    ? (process.argv[outputArgIndex + 1] ?? "")
    : "symbaiex-agent-key.json",
);
const force = process.argv.includes("--force");

if (existsSync(outputPath) && !force) {
  throw new Error(
    `Refusing to overwrite ${outputPath}; pass --force only after a deliberate rotation.`,
  );
}

const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]);
const publicKey = new Uint8Array(
  await crypto.subtle.exportKey("raw", keyPair.publicKey),
);
const privateKeyPkcs8 = new Uint8Array(
  await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
);

const publicKeyBase64Url = base64Url(publicKey);
const fingerprint = createHash("sha256").update(publicKey).digest("base64url");
const record = {
  version: 1,
  algorithm: "Ed25519",
  publicKey: publicKeyBase64Url,
  privateKeyPkcs8: base64Url(privateKeyPkcs8),
  fingerprint,
  createdAt: new Date().toISOString(),
};

mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
chmodSync(outputPath, 0o600);

console.log(`Created ${outputPath}`);
console.log(`Public-key fingerprint: ${fingerprint}`);
console.log(
  "Keep the private key in an OS keychain or secret manager; never paste it into model context, logs, or source control.",
);

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}
