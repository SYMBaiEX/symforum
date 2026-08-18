/** Cryptographic and wire-format helpers shared by the agent auth provider. */

export const AGENT_LOGIN_DOMAIN = "SYMBIEX_AGENT_LOGIN_V1";
export const AGENT_LOGIN_PURPOSE = "agent-login";
export const AGENT_MCP_RESOURCE_AUDIENCE =
  "https://www.symbaiex.com/api/agent/mcp";
export const LEGACY_AGENT_LOGIN_AUDIENCE = "https://www.symbaiex.com";

const AGENT_LOGIN_ALLOWED_ORIGINS = new Set([
  "https://symbaiex.com",
  "https://www.symbaiex.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
]);

const textEncoder = new TextEncoder();

export function canonicalAgentLoginAudience(value: string) {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !AGENT_LOGIN_ALLOWED_ORIGINS.has(url.origin)
    ) {
      return null;
    }
    if (url.pathname === "/api/agent/mcp") {
      return `${url.origin}/api/agent/mcp`;
    }
    if (
      url.origin === LEGACY_AGENT_LOGIN_AUDIENCE &&
      (url.pathname === "" || url.pathname === "/")
    ) {
      return LEGACY_AGENT_LOGIN_AUDIENCE;
    }
    return null;
  } catch {
    return null;
  }
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Expected an unpadded base64url value");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function bytesToBase64Url(value: Uint8Array) {
  return encodeBase64Url(value);
}

export function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

/**
 * Canonical message signed by an enrolled agent key. Keep this format stable:
 * scripts and device clients receive the exact message from the challenge API.
 */
export function buildAgentLoginMessage(args: {
  agentId: string;
  audience: string;
  challenge: string;
  expiresAt: number;
}) {
  return [
    AGENT_LOGIN_DOMAIN,
    `purpose=${AGENT_LOGIN_PURPOSE}`,
    `audience=${args.audience}`,
    `agentId=${args.agentId}`,
    `challenge=${args.challenge}`,
    `expiresAt=${args.expiresAt}`,
  ].join("\n");
}

export async function verifyEd25519Signature(args: {
  publicKey: string;
  signature: string;
  message: string;
}) {
  try {
    const publicKey = base64UrlToBytes(args.publicKey);
    const signature = base64UrlToBytes(args.signature);
    if (publicKey.byteLength !== 32 || signature.byteLength !== 64) {
      return false;
    }
    const key = await crypto.subtle.importKey(
      "raw",
      publicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signature,
      textEncoder.encode(args.message),
    );
  } catch {
    return false;
  }
}

export function validateEd25519PublicKey(value: string) {
  try {
    return base64UrlToBytes(value).byteLength === 32;
  } catch {
    return false;
  }
}
