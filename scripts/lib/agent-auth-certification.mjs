import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SECRET_FIELD = /(?:access|refresh|private|secret|signature|challenge|token|authorization)/i;
export const PRODUCTION_AGENT_API_BASE_URL = "https://www.symbaiex.com/api/agent";
const DEFAULT_BASE_URL = PRODUCTION_AGENT_API_BASE_URL;

export function normalizeAgentApiBaseUrl(value = DEFAULT_BASE_URL) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Agent API base URL must be a valid absolute URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Agent API base URL must be HTTPS and contain no credentials, query, or fragment.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  const normalized = url.toString().replace(/\/$/, "");
  if (normalized !== PRODUCTION_AGENT_API_BASE_URL) throw new Error("PLAT-01 certification is pinned to https://www.symbaiex.com/api/agent.");
  return normalized;
}

export function assertPrivateJsonFile(path) {
  const link = lstatSync(path);
  if (link.isSymbolicLink() || !link.isFile()) throw new Error("Credential file must be a regular non-symlink file.");
  if (typeof process.getuid === "function" && link.uid !== process.getuid()) throw new Error("Credential file must be owned by the current user.");
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error("Refusing to read a group/world-accessible credential file.");
  }
  assertSafeCredentialParents(path);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Credential file must contain a JSON object.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing")) throw error;
    throw new Error("Could not read credential file.");
  }
}

function assertSafeCredentialParents(path) {
  return inspectSafeParentChain(dirname(resolve(path)));
}

function inspectSafeParentChain(start) {
  const snapshots = [];
  const unresolvedStart = resolve(start);
  const directStart = lstatSync(unresolvedStart);
  if (directStart.isSymbolicLink() || !directStart.isDirectory()) throw new Error("Credential parent must be a real directory.");
  let current = realpathSync(unresolvedStart);
  while (true) {
    const entry = lstatSync(current);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Credential parent must be a real directory.");
    if ((entry.mode & 0o022) !== 0) throw new Error("Credential parent must not be group/world writable.");
    if (typeof process.getuid === "function" && entry.uid !== process.getuid() && entry.uid !== 0) throw new Error("Credential parent must be owned by the current user or root.");
    snapshots.push({ path: current, dev: entry.dev, ino: entry.ino });
    const parent = dirname(current);
    if (parent === current) return snapshots;
    current = parent;
  }
}

export function validateLifecycleConfig({ baseUrl, production, confirm, phase }) {
  const normalized = normalizeAgentApiBaseUrl(baseUrl);
  if (production !== "strong-bee-384") throw new Error("Lifecycle verification is blocked. Pass --production strong-bee-384 for the named production target.");
  if (confirm !== "PLAT-01") throw new Error("Lifecycle verification is blocked. Pass --confirm PLAT-01 after completing owner-console enrollment, rotation, and revocation.");
  if (!["refresh-scope", "rotation", "revocation"].includes(phase)) throw new Error("--phase must be refresh-scope, rotation, or revocation.");
  return normalized;
}

/** Validates the exact credential-path contract before a phase reads a file. */
export function validatePhaseInputs(phase, args) {
  const requireValue = (name) => {
    if (typeof args[name] !== "string" || args[name].length === 0) throw new Error(`--${name} is required for ${phase} verification.`);
  };
  if (phase === "refresh-scope") {
    if (args["allow-session-rotation"] !== "yes") throw new Error("Refresh rotates credentials. Pass --allow-session-rotation yes.");
    requireValue("session");
    requireValue("scope-denied-session");
    return;
  }
  if (phase === "rotation") {
    requireValue("agent-id");
    requireValue("old-key");
    requireValue("replacement-key");
    return;
  }
  requireValue("revoked-session");
}

export function redactedError(error) {
  const message = error instanceof Error ? error.message : "Certification request failed.";
  return redactText(message).slice(0, 240);
}

export function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_FIELD.test(key) ? "[REDACTED]" : redactValue(item),
      ]),
    );
  }
  return typeof value === "string" ? redactText(value) : value;
}

function redactText(value) {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:eyJ[a-zA-Z0-9_-]{10,}|[A-Za-z0-9_-]{32,})\b/g, "[REDACTED]");
}

export function certificationPlan({ baseUrl, agentId, includesLifecycle }) {
  return {
    mode: "dry-plan",
    baseUrl: normalizeAgentApiBaseUrl(baseUrl),
    agentId: agentId ?? "[required for lifecycle]",
    networkRequests: 0,
    mutations: 0,
    lifecycleEnabled: includesLifecycle,
    steps: [
      "Create a dedicated human-owned certification agent in the owner console with the smallest intended scope.",
      "Record only the agent ID, approved scopes, public-key fingerprint, and test timestamp in the release evidence.",
      "Run authenticated verification with a normal session and a separate no-evidence session.",
      "Use the owner console to rotate the dedicated agent key, then verify old credentials fail and replacement credentials work.",
      "Use the owner console to revoke the dedicated agent, then verify its stored bearer is rejected.",
      "Delete local certification sessions and keys from the test host after recording redacted results.",
    ],
  };
}

export async function verifyPublicMetadata({ fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL }) {
  const normalized = normalizeAgentApiBaseUrl(baseUrl);
  const origin = new URL(normalized).origin;
  const protectedResource = await fetchJson(fetchImpl, `${origin}/.well-known/oauth-protected-resource`);
  const authMetadata = await fetchJson(fetchImpl, `${origin}/.well-known/symbaiex-agent-authentication`);
  if (protectedResource.status !== 200 || authMetadata.status !== 200) {
    throw new Error("Public authentication metadata did not return 200.");
  }
  if (protectedResource.body?.["x-symbaiex-authentication"]?.oauth2 !== false || authMetadata.body?.oauth2?.supported !== false) {
    throw new Error("Authentication metadata overclaims OAuth support.");
  }
  if (authMetadata.body?.protocol !== "symbaiex_ed25519_challenge_v1") {
    throw new Error("Authentication metadata does not identify the Ed25519 protocol.");
  }
  return { mode: "public-metadata", baseUrl: normalized, protectedResource: "ok", authentication: "ed25519" };
}

export async function verifySession({ fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL, session, expectation }) {
  if (!session || typeof session.accessToken !== "string" || session.accessToken.length < 16) {
    throw new Error("Session does not contain an access token.");
  }
  const normalized = normalizeAgentApiBaseUrl(baseUrl);
  const response = await fetchImpl(`${normalized}/v1/status`, {
    method: "GET",
    headers: { accept: "application/json", authorization: `Bearer ${session.accessToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== expectation) {
    throw new Error(`Session verification returned ${response.status}; expected ${expectation}.`);
  }
  return { status: response.status, expectation };
}

/** Refreshes in memory only; callers deliberately control secure persistence. */
export async function refreshSession({ fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL, session }) {
  if (!session || typeof session.refreshToken !== "string" || session.refreshToken.length < 16) throw new Error("Session does not contain a refresh token.");
  const normalized = normalizeAgentApiBaseUrl(baseUrl);
  const response = await fetchImpl(`${normalized}/auth/refresh`, {
    method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }), redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 200 || typeof body?.tokens?.token !== "string" || typeof body?.tokens?.refreshToken !== "string") throw new Error("Refresh did not return a rotated session.");
  return { ...session, accessToken: body.tokens.token, refreshToken: body.tokens.refreshToken };
}

export async function verifyKeyLogin({ fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL, agentId, key, expectation }) {
  if (typeof agentId !== "string" || agentId.length < 2 || !key || key.algorithm !== "Ed25519" || typeof key.privateKeyPkcs8 !== "string") throw new Error("Agent ID and a valid Ed25519 key file are required.");
  const normalized = normalizeAgentApiBaseUrl(baseUrl);
  const challengeResponse = await fetchImpl(`${normalized}/auth/challenge`, {
    method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ agentId }), redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  const challenge = await challengeResponse.json().catch(() => null);
  if (challengeResponse.status !== 200 || typeof challenge?.message !== "string" || typeof challenge?.challenge !== "string") throw new Error("Could not obtain an active-agent login challenge.");
  const privateKey = await crypto.subtle.importKey("pkcs8", Buffer.from(key.privateKeyPkcs8, "base64url"), { name: "Ed25519" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(challenge.message));
  const response = await fetchImpl(`${normalized}/auth/sign-in`, {
    method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ agentId, challenge: challenge.challenge, audience: challenge.audience, signature: Buffer.from(signature).toString("base64url") }), redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (response.status !== expectation) throw new Error(`Key login returned ${response.status}; expected ${expectation}.`);
  if (expectation === 200 && typeof body?.tokens?.token !== "string") throw new Error("Replacement key login returned no access token.");
  return expectation === 200 ? { accessToken: body.tokens.token, refreshToken: body.tokens.refreshToken } : { status: 401 };
}

export async function verifyScopeDenied({ fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL, session }) {
  if (!session || typeof session.accessToken !== "string" || session.accessToken.length < 16) {
    throw new Error("Scope-denied session does not contain an access token.");
  }
  const normalized = normalizeAgentApiBaseUrl(baseUrl);
  const response = await fetchImpl(`${normalized}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "evidence.status",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "plat-01-scope-denial", method: "tools/call", params: { name: "evidence.status", arguments: {} } }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const challenge = response.headers.get("www-authenticate") ?? "";
  if (response.status !== 403 || !challenge.includes('error="insufficient_scope"')) {
    throw new Error("Restricted agent did not receive the expected insufficient-scope denial.");
  }
  return { status: 403, scope: "evidence", denial: "insufficient_scope" };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
