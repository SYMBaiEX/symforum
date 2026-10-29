import { PRIMARY_SITE_URL } from "../lib/site-urls.ts";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  registryArguments,
  boundedRegistryText,
  verifyRegistryEntry,
} from "./lib/mcp-registry-release.mjs";

const registry = "https://registry.modelcontextprotocol.io";
const domain = new URL(PRIMARY_SITE_URL).hostname;
const { publish, keyPath } = registryArguments(process.argv.slice(2));

async function request(url, options = {}, allowMissing = false) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (allowMissing && response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok)
    throw new Error(
      `Registry release request failed: HTTP ${response.status} at ${new URL(url).pathname}`,
    );
  return boundedRegistryText(response);
}

const entries = await Promise.all(
  ["evidence", "docs"].map(async (name) => {
    const entry = JSON.parse(
      await readFile(
        fileURLToPath(
          new URL(`../registry/${name}.server.json`, import.meta.url),
        ),
        "utf8",
      ),
    );
    if (
      entry.name !== `com.symbaiex.www/${name}` ||
      entry.description.length > 100 ||
      entry.remotes.length !== 1 ||
      !entry.version
    )
      throw new Error("Invalid registry release document");
    const expectedUrl = `https://${domain}/api/${name === "docs" ? "docs" : "agent"}/mcp`;
    if (
      entry.remotes[0].url !== expectedUrl ||
      entry.remotes[0].type !== "streamable-http"
    )
      throw new Error("Unexpected remote transport");
    const card = JSON.parse(await request(`${expectedUrl}/server-card`));
    if (
      card.name !== entry.name ||
      card.version !== entry.version ||
      card.remotes[0].url !== expectedUrl
    )
      throw new Error(`Deployed card does not match ${entry.name}`);
    const handshake = JSON.parse(
      await request(expectedUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "MCP-Protocol-Version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "registry-preflight",
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: {
              name: "symbaiex-registry-preflight",
              version: "1.0.0",
            },
          },
        }),
      }),
    );
    if (handshake.error || handshake.result?.protocolVersion !== "2025-06-18")
      throw new Error(`MCP handshake failed for ${entry.name}`);
    return entry;
  }),
);

const proof = await request(`https://${domain}/.well-known/mcp-registry-auth`, {
  headers: { Accept: "text/plain", "User-Agent": "mcp-registry/1.0" },
});
if (!/^v=MCPv1; k=ed25519; p=[A-Za-z0-9+/]{43}=\n?$/.test(proof))
  throw new Error("Invalid public registry proof");

if (!publish) {
  console.log(
    "Registry preflight passed: domain proof, 2 matching cards and 2 MCP handshakes. No publication performed.",
  );
} else {
  // Read a dedicated key in-process. Never put key bytes in argv, env, logs, or the publisher's shared credential file.
  const info = await stat(keyPath);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new Error("Registry private-key file must be owner-only (0600)");
  const key = createPrivateKey(await readFile(keyPath));
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Registry publication requires its dedicated Ed25519 key");
  const publicKey = createPublicKey(key)
    .export({ type: "spki", format: "der" })
    .subarray(-32)
    .toString("base64");
  if (proof.trim() !== `v=MCPv1; k=ed25519; p=${publicKey}`)
    throw new Error("Signing key does not match deployed domain proof");
  const timestamp = new Date().toISOString();
  const auth = JSON.parse(
    await request(`${registry}/v0/auth/http`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain,
        timestamp,
        signed_timestamp: sign(null, Buffer.from(timestamp), key).toString(
          "hex",
        ),
      }),
    }),
  );
  if (typeof auth.registry_token !== "string" || !auth.registry_token)
    throw new Error("Registry did not issue publishing credentials");
  for (const entry of entries) {
    const versionUrl = `${registry}/v0.1/servers/${encodeURIComponent(entry.name)}/versions/${encodeURIComponent(entry.version)}`;
    const existing = await request(versionUrl, {}, true);
    if (existing !== null) {
      verifyRegistryEntry(entry, JSON.parse(existing));
      console.log(
        `Already published and verified ${entry.name}@${entry.version}`,
      );
      continue;
    }
    await request(`${registry}/v0/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.registry_token}`,
      },
      body: JSON.stringify(entry),
    });
    verifyRegistryEntry(entry, JSON.parse(await request(versionUrl)));
    console.log(`Published and verified ${entry.name}@${entry.version}`);
  }
}
