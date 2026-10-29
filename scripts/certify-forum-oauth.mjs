#!/usr/bin/env node

import { installation } from "../lib/installation.ts";
import { APEX_SITE_URL, PRIMARY_SITE_URL } from "../lib/site-urls.ts";
/**
 * Opt-in real WorkOS certification. Never reads/writes credentials or .env files.
 * All registration credentials, PKCE material, codes and tokens live in memory.
 * No forum writes or provider administration. --run creates temporary DCR clients
 * and normal consent grants; the owner completes consent/disconnect in the browser.
 */
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { createRemoteJWKSet, jwtVerify } from "jose";

export const FORUM_RESOURCE = PRIMARY_SITE_URL + "/api/plugin/mcp";
export const EVIDENCE_RESOURCE = PRIMARY_SITE_URL + "/api/agent/mcp";
export const CLAIMS = {
  grant: "urn:symbaiex:forum-plugin-grant",
  resource: "urn:symbaiex:forum-plugin-resource",
  kind: "urn:symbaiex:forum-plugin-kind",
  evidence: "urn:symbaiex:agent-grant",
};
const DEFAULT_ISSUER = "https://unique-evening-77.authkit.app";
const PROTOCOL = "2025-06-18";
const REQUEST_MS = 20_000;
const CONSENT_MS = 10 * 60_000;
const BODY_LIMIT = 1024 * 1024;

// Only these fixed codes ever reach output; provider bodies and thrown messages do not.
export class CertificationError extends Error {
  constructor(code) {
    super("Certification check failed.");
    this.code = code;
  }
}
function ensure(condition, code) {
  if (!condition) throw new CertificationError(code);
}
export function safeFailure(error) {
  return error instanceof CertificationError
    ? error.code
    : "UNEXPECTED_FAILURE";
}
function text(value, max = 16_384) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\s\x00-\x1f\x7f]/.test(value)
  );
}
function issuerOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CertificationError("INVALID_ISSUER");
  }
  ensure(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      (url.hostname.endsWith(".authkit.app") ||
        (Boolean(installation.identity.cookieDomain) && url.hostname.endsWith("." + installation.identity.cookieDomain))),
    "INVALID_ISSUER",
  );
  return url.origin;
}
export function parseOptions(argv) {
  const result = {
    run: false,
    discoverOnly: false,
    withEvidence: false,
    checkRevocation: false,
    issuer: DEFAULT_ISSUER,
    origin: PRIMARY_SITE_URL,
  };
  const flags = {
    "--run": "run",
    "--discover-only": "discoverOnly",
    "--with-evidence": "withEvidence",
    "--check-revocation": "checkRevocation",
    "--help": "help",
  };
  const values = {
    "--issuer": "issuer",
    "--origin": "origin",
    "--owner-id": "ownerId",
    "--expect-actor": "expectedActor",
    "--expect-mode": "expectedMode",
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flags[flag]) {
      ensure(result[flags[flag]] !== true, "DUPLICATE_OPTION");
      result[flags[flag]] = true;
    } else if (values[flag]) {
      ensure(
        text(argv[i + 1], 256) && !argv[i + 1].startsWith("--"),
        "INVALID_OPTION_VALUE",
      );
      ensure(!argv.slice(0, i).includes(flag), "DUPLICATE_OPTION");
      result[values[flag]] = argv[++i];
    } else throw new CertificationError("UNKNOWN_OPTION");
  }
  result.issuer = issuerOrigin(result.issuer);
  ensure(
    [PRIMARY_SITE_URL, APEX_SITE_URL].includes(
      result.origin,
    ),
    "INVALID_ORIGIN",
  );
  ensure(!(result.run && result.discoverOnly), "CONFLICTING_MODES");
  ensure(
    result.run || (!result.withEvidence && !result.checkRevocation),
    "RUN_REQUIRED",
  );
  ensure(
    !result.expectedActor || ["human", "agent"].includes(result.expectedActor),
    "INVALID_ACTOR",
  );
  ensure(
    !result.expectedMode || ["direct", "review"].includes(result.expectedMode),
    "INVALID_MODE",
  );
  ensure(
    !result.ownerId || /^[a-zA-Z0-9_-]{16,128}$/.test(result.ownerId),
    "INVALID_OWNER_ID",
  );
  return result;
}
export function newPkce() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
  };
}
function providerEndpoint(value, issuer, path) {
  ensure(value === `${issuer}${path}`, "UNTRUSTED_PROVIDER_ENDPOINT");
  return value;
}
export function validateDiscovery(metadata, issuer) {
  ensure(metadata?.issuer === issuer, "ISSUER_MISMATCH");
  for (const [field, path] of Object.entries({
    authorization_endpoint: "/oauth2/authorize",
    token_endpoint: "/oauth2/token",
    registration_endpoint: "/oauth2/register",
    jwks_uri: "/oauth2/jwks",
  }))
    providerEndpoint(metadata[field], issuer, path);
  for (const [field, members] of Object.entries({
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "offline_access"],
    token_endpoint_auth_methods_supported: ["none"],
  }))
    ensure(
      Array.isArray(metadata[field]) &&
        members.every((member) => metadata[field].includes(member)),
      "UNSUPPORTED_OAUTH_METADATA",
    );
  return metadata;
}
async function boundedJson(response) {
  ensure(
    response.headers.get("content-type")?.includes("application/json"),
    "NON_JSON_RESPONSE",
  );
  ensure(response.body, "EMPTY_RESPONSE");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      ensure(size <= BODY_LIMIT, "OVERSIZED_RESPONSE");
      chunks.push(part.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new CertificationError("INVALID_JSON_RESPONSE");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function requestJson(
  url,
  options = {},
  fetchImpl = fetch,
  readTokenError = false,
) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(REQUEST_MS),
    });
  } catch {
    throw new CertificationError("NETWORK_FAILURE");
  }
  const shouldRead =
    response.ok || (readTokenError && [400, 401].includes(response.status));
  if (!shouldRead) await response.body?.cancel().catch(() => {});
  return { response, payload: shouldRead ? await boundedJson(response) : null };
}
export async function discover(options, fetchImpl = fetch) {
  const { response, payload } = await requestJson(
    `${options.issuer}/.well-known/oauth-authorization-server`,
    {},
    fetchImpl,
  );
  ensure(response.status === 200, "DISCOVERY_HTTP_FAILURE");
  validateDiscovery(payload, options.issuer);
  for (const [path, resource] of [
    ["/.well-known/oauth-protected-resource/api/plugin/mcp", FORUM_RESOURCE],
    ["/.well-known/oauth-protected-resource", EVIDENCE_RESOURCE],
  ]) {
    const discovered = await requestJson(
      `${options.origin}${path}`,
      {},
      fetchImpl,
    );
    ensure(
      discovered.response.status === 200 &&
        discovered.payload?.resource === resource &&
        Array.isArray(discovered.payload?.authorization_servers) &&
        discovered.payload.authorization_servers.includes(options.issuer),
      "RESOURCE_DISCOVERY_MISMATCH",
    );
  }
  return payload;
}
export function registrationBody(callbackUri, label) {
  const callback = new URL(callbackUri);
  ensure(
    callback.protocol === "http:" &&
      callback.hostname === "127.0.0.1" &&
      callback.port &&
      callback.pathname === "/callback" &&
      !callback.search &&
      !callback.hash &&
      !callback.username &&
      !callback.password,
    "INVALID_CALLBACK",
  );
  return {
    client_name: `SYMBaiEX ${label} OAuth certification`,
    application_type: "native",
    redirect_uris: [callbackUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: "openid offline_access",
  };
}
export function validateRegistration(payload, callbackUri) {
  ensure(
    text(payload?.client_id, 256) &&
      payload?.token_endpoint_auth_method === "none" &&
      !payload?.client_secret &&
      Array.isArray(payload?.redirect_uris) &&
      payload.redirect_uris.length === 1 &&
      payload.redirect_uris[0] === callbackUri,
    "INVALID_DCR_RESPONSE",
  );
  return { clientId: payload.client_id };
}
export function authorizationUrl(
  metadata,
  clientId,
  callbackUri,
  resource,
  pkce,
) {
  providerEndpoint(
    metadata.authorization_endpoint,
    issuerOrigin(metadata.issuer),
    "/oauth2/authorize",
  );
  ensure(
    [FORUM_RESOURCE, EVIDENCE_RESOURCE].includes(resource),
    "INVALID_RESOURCE",
  );
  ensure(text(clientId, 256), "INVALID_CLIENT_ID");
  registrationBody(callbackUri, "forum");
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: callbackUri,
    resource,
    scope: "openid offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state: pkce.state,
    nonce: pkce.nonce,
  }).toString();
  ensure(url.toString().length <= 3072, "OVERSIZED_AUTHORIZATION_URL");
  return url.toString();
}
/** A bad callback never consumes the outstanding consent. No callback URL is logged. */
export function validateCallback(rawUrl, callbackUri, state) {
  let url;
  try {
    url = new URL(rawUrl, callbackUri);
  } catch {
    throw new CertificationError("INVALID_CALLBACK");
  }
  ensure(
    url.origin === new URL(callbackUri).origin &&
      url.pathname === "/callback" &&
      !url.hash,
    "INVALID_CALLBACK",
  );
  ensure(
    url.searchParams.getAll("state").length === 1 &&
      url.searchParams.get("state") === state,
    "CALLBACK_STATE_MISMATCH",
  );
  if (url.searchParams.has("error"))
    throw new CertificationError("CONSENT_REJECTED");
  ensure(
    url.searchParams.getAll("code").length === 1 &&
      text(url.searchParams.get("code"), 4096),
    "INVALID_AUTHORIZATION_CODE",
  );
  return url.searchParams.get("code");
}
export async function createConsentListener(state, timeoutMs = CONSENT_MS) {
  let resolve,
    reject,
    consumed = false,
    callbackUri,
    timer;
  const result = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Install a rejection handler before DCR networking to prevent timeout warnings.
  void result.catch(() => {});
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (consumed) {
      response.writeHead(409).end("Consent already received.");
      return;
    }
    try {
      ensure(
        request.method === "GET" &&
          request.headers.host === new URL(callbackUri).host,
        "INVALID_CALLBACK",
      );
      const code = validateCallback(request.url, callbackUri, state);
      consumed = true;
      clearTimeout(timer);
      response
        .writeHead(200)
        .end("Consent received. Return to the certification runner.");
      resolve(code);
    } catch (error) {
      response.writeHead(400).end("Invalid or rejected consent callback.");
      if (safeFailure(error) === "CONSENT_REJECTED") {
        consumed = true;
        clearTimeout(timer);
        reject(error);
      }
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  callbackUri = `http://127.0.0.1:${server.address().port}/callback`;
  timer = setTimeout(() => {
    consumed = true;
    reject(new CertificationError("CONSENT_TIMEOUT"));
  }, timeoutMs);
  return {
    callbackUri,
    wait: () => result,
    close: async () => {
      clearTimeout(timer);
      server.closeAllConnections();
      await new Promise((yes) => server.close(yes));
    },
  };
}
export function validateTokens(payload) {
  ensure(
    typeof payload?.token_type === "string" &&
      payload.token_type.toLowerCase() === "bearer" &&
      text(payload.access_token) &&
      text(payload.refresh_token) &&
      Number.isFinite(payload.expires_in) &&
      payload.expires_in > 0,
    "INVALID_TOKEN_RESPONSE",
  );
  // Deliberately discard ID tokens and any unknown fields.
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
  };
}
export async function exchangeToken(metadata, body, fetchImpl = fetch) {
  const { response, payload } = await requestJson(
    metadata.token_endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(body).toString(),
    },
    fetchImpl,
  );
  ensure(response.status === 200, "TOKEN_EXCHANGE_REJECTED");
  return validateTokens(payload);
}
export async function verifyAccessToken(
  token,
  metadata,
  resource,
  expected = {},
  key,
) {
  ensure(
    [FORUM_RESOURCE, EVIDENCE_RESOURCE].includes(resource),
    "INVALID_RESOURCE",
  );
  let payload;
  try {
    ({ payload } = await jwtVerify(
      token,
      key ??
        createRemoteJWKSet(new URL(metadata.jwks_uri), {
          timeoutDuration: 5000,
        }),
      {
        issuer: metadata.issuer,
        audience: resource,
        algorithms: ["RS256"],
        requiredClaims: ["iss", "sub", "aud", "exp"],
      },
    ));
  } catch {
    throw new CertificationError("JWT_VERIFICATION_FAILED");
  }
  ensure(
    payload.aud === resource && text(payload.sub, 256),
    "JWT_RESOURCE_MISMATCH",
  );
  const grantId =
    payload[resource === FORUM_RESOURCE ? CLAIMS.grant : CLAIMS.evidence];
  ensure(text(grantId, 256), "JWT_MISSING_GRANT");
  if (resource === FORUM_RESOURCE)
    ensure(
      payload[CLAIMS.resource] === resource &&
        payload[CLAIMS.kind] === "forum-plugin" &&
        payload[CLAIMS.evidence] === undefined,
      "JWT_FORUM_CLAIMS_MISMATCH",
    );
  else
    ensure(
      payload[CLAIMS.grant] === undefined &&
        payload[CLAIMS.resource] === undefined &&
        payload[CLAIMS.kind] === undefined,
      "JWT_EVIDENCE_CLAIMS_MISMATCH",
    );
  ensure(
    !expected.subject || expected.subject === payload.sub,
    "JWT_SUBJECT_CHANGED",
  );
  ensure(
    !expected.grantId || expected.grantId === grantId,
    "JWT_GRANT_CHANGED",
  );
  return { subject: payload.sub, grantId };
}
export async function refreshSession(
  metadata,
  session,
  clientId,
  resource,
  fetchImpl = fetch,
) {
  const { response, payload } = await requestJson(
    metadata.token_endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: session.refreshToken,
        resource,
      }).toString(),
    },
    fetchImpl,
    true,
  );
  if (
    [400, 401].includes(response.status) &&
    payload?.error === "invalid_grant"
  )
    throw new CertificationError("REFRESH_REJECTED");
  ensure(response.status === 200, "REFRESH_HTTP_FAILURE");
  // Providers may omit refresh_token when retaining the current token.
  return validateTokens({
    ...payload,
    refresh_token: payload?.refresh_token ?? session.refreshToken,
  });
}
let rpcId = 0;
export async function callTool(
  options,
  resource,
  token,
  name,
  expectedStatus = 200,
  fetchImpl = fetch,
) {
  const id = ++rpcId;
  const { response, payload } = await requestJson(
    `${options.origin}${new URL(resource).pathname}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: {} },
      }),
    },
    fetchImpl,
  );
  ensure(response.status === expectedStatus, "MCP_HTTP_STATUS_MISMATCH");
  if (expectedStatus !== 200) {
    ensure(
      response.headers.get("www-authenticate")?.startsWith("Bearer "),
      "MISSING_AUTH_CHALLENGE",
    );
    return null;
  }
  ensure(
    payload?.jsonrpc === "2.0" &&
      payload.id === id &&
      !payload.error &&
      payload.result &&
      payload.result.isError !== true,
    "MCP_TOOL_REJECTED",
  );
  return payload.result;
}
export function verifyForumStatus(result, principal, options) {
  const status = result?.structuredContent;
  ensure(
    status?.status === "completed" &&
      status.data?.connectionId === principal.grantId &&
      Number.isSafeInteger(status.data?.policyVersion) &&
      status.data.policyVersion > 0 &&
      Array.isArray(status.data.capabilities) &&
      ["direct", "review"].includes(status.data.executionMode) &&
      text(status.actingAs?.userId, 256) &&
      typeof status.actingAs?.isAgent === "boolean" &&
      (status.actingAs.isAgent || status.actingAs.userId === principal.subject),
    "FORUM_PRINCIPAL_MISMATCH",
  );
  ensure(
    !options.expectedActor ||
      status.actingAs.isAgent === (options.expectedActor === "agent"),
    "FORUM_ACTOR_MISMATCH",
  );
  ensure(
    !options.expectedMode || status.data.executionMode === options.expectedMode,
    "FORUM_EXECUTION_MODE_MISMATCH",
  );
  return {
    actor: status.actingAs.isAgent ? "agent" : "human",
    executionMode: status.data.executionMode,
    policyVersion: status.data.policyVersion,
  };
}

async function consent(metadata, options, resource, output, fetchImpl) {
  const label = resource === FORUM_RESOURCE ? "forum" : "evidence";
  const pkce = newPkce();
  const listener = await createConsentListener(pkce.state);
  try {
    const registration = await requestJson(
      metadata.registration_endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(registrationBody(listener.callbackUri, label)),
      },
      fetchImpl,
    );
    ensure(
      registration.response.status === 201 ||
        registration.response.status === 200,
      "DCR_REGISTRATION_REJECTED",
    );
    const { clientId } = validateRegistration(
      registration.payload,
      listener.callbackUri,
    );
    output(
      `Open this ${label} authorization URL in the browser on this computer; choose ${label} access in SYMBaiEX, then complete WorkOS consent. Authorization expires in 10 minutes.`,
    );
    output(
      authorizationUrl(
        metadata,
        clientId,
        listener.callbackUri,
        resource,
        pkce,
      ),
    );
    const code = await listener.wait();
    const session = await exchangeToken(
      metadata,
      {
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: listener.callbackUri,
        code_verifier: pkce.verifier,
        resource,
      },
      fetchImpl,
    );
    const principal = await verifyAccessToken(
      session.accessToken,
      metadata,
      resource,
      { subject: options.ownerId },
    );
    return { clientId, session, principal };
  } finally {
    await listener.close();
  }
}
export async function certify(
  options,
  {
    fetchImpl = fetch,
    output = console.log,
    consentImpl = consent,
    verifyTokenImpl = verifyAccessToken,
    confirmRevocation,
  } = {},
) {
  const summary = {
    mode: options.run
      ? "live-oauth"
      : options.discoverOnly
        ? "public-discovery"
        : "plan",
    checks: [],
    hostVerification: "not_tested",
    forumWrites: "not_tested",
    reverseBoundary: "not_tested",
    revocation: "not_tested",
  };
  const checked = async (name, action) => {
    try {
      const detail = await action();
      summary.checks.push({
        name,
        status: "passed",
        ...(detail ? { detail } : {}),
      });
      return detail;
    } catch (error) {
      summary.checks.push({ name, status: "failed", code: safeFailure(error) });
      throw error;
    }
  };
  if (!options.run && !options.discoverOnly) {
    output(
      "Plan only: no network requests or mutations. --discover-only reads metadata. --run creates DCR clients and opens normal browser consent; tokens stay in process memory. --with-evidence uses a second normal evidence consent. --check-revocation waits for owner disconnect. No forum content is changed. Temporary clients/grants remain until owner/provider cleanup.",
    );
    return summary;
  }
  try {
    let metadata;
    await checked("public resource and issuer discovery", async () => {
      metadata = await discover(options, fetchImpl);
    });
    if (!options.run) return summary;
    const forum = await consentImpl(
      metadata,
      options,
      FORUM_RESOURCE,
      output,
      fetchImpl,
    );
    summary.checks.push({
      name: "forum code/PKCE and signed resource grant",
      status: "passed",
    });
    const checkForum = async (session) =>
      verifyForumStatus(
        await callTool(
          options,
          FORUM_RESOURCE,
          session.accessToken,
          "forum_status",
          200,
          fetchImpl,
        ),
        forum.principal,
        options,
      );
    await checked("selected forum principal", () => checkForum(forum.session));
    await checked("forum token rejected by evidence", () =>
      callTool(
        options,
        EVIDENCE_RESOURCE,
        forum.session.accessToken,
        "evidence_status",
        401,
        fetchImpl,
      ),
    );
    const refreshed = await refreshSession(
      metadata,
      forum.session,
      forum.clientId,
      FORUM_RESOURCE,
      fetchImpl,
    );
    await verifyTokenImpl(
      refreshed.accessToken,
      metadata,
      FORUM_RESOURCE,
      forum.principal,
    );
    await checked("rotated refresh retains forum principal", () =>
      checkForum(refreshed),
    );
    let evidence;
    if (options.withEvidence) {
      evidence = await consentImpl(
        metadata,
        options,
        EVIDENCE_RESOURCE,
        output,
        fetchImpl,
      );
      summary.checks.push({
        name: "separate evidence consent and signed grant",
        status: "passed",
      });
      await checked("evidence grant still works", async () => {
        await callTool(
          options,
          EVIDENCE_RESOURCE,
          evidence.session.accessToken,
          "evidence_status",
          200,
          fetchImpl,
        );
      });
      await checked("evidence token rejected by forum", () =>
        callTool(
          options,
          FORUM_RESOURCE,
          evidence.session.accessToken,
          "forum_status",
          401,
          fetchImpl,
        ),
      );
      summary.reverseBoundary = "passed";
    }
    if (options.checkRevocation) {
      ensure(confirmRevocation, "REVOCATION_CONFIRMATION_UNAVAILABLE");
      await confirmRevocation();
      await checked("disconnected original forum token denied", () =>
        callTool(
          options,
          FORUM_RESOURCE,
          forum.session.accessToken,
          "forum_status",
          401,
          fetchImpl,
        ),
      );
      await checked("disconnected refreshed forum token denied", () =>
        callTool(
          options,
          FORUM_RESOURCE,
          refreshed.accessToken,
          "forum_status",
          401,
          fetchImpl,
        ),
      );
      // Local revocation need not revoke the provider refresh grant. Prove the new
      // access token is denied if WorkOS still permits refresh; do not reuse spent tokens.
      let minted;
      try {
        minted = await refreshSession(
          metadata,
          refreshed,
          forum.clientId,
          FORUM_RESOURCE,
          fetchImpl,
        );
      } catch (error) {
        if (safeFailure(error) !== "REFRESH_REJECTED") throw error;
      }
      if (minted) {
        await verifyTokenImpl(
          minted.accessToken,
          metadata,
          FORUM_RESOURCE,
          forum.principal,
        );
        await checked("post-disconnect refresh-derived token denied", () =>
          callTool(
            options,
            FORUM_RESOURCE,
            minted.accessToken,
            "forum_status",
            401,
            fetchImpl,
          ),
        );
      } else
        summary.checks.push({
          name: "provider rejected post-disconnect refresh",
          status: "passed",
        });
      if (evidence)
        await checked("evidence access survives forum disconnect", async () => {
          await callTool(
            options,
            EVIDENCE_RESOURCE,
            evidence.session.accessToken,
            "evidence_status",
            200,
            fetchImpl,
          );
        });
      summary.revocation = "passed";
    }
    return summary;
  } catch (error) {
    // consent/token failures occur between named checks; still record their fixed code.
    if (!summary.checks.some((entry) => entry.status === "failed"))
      summary.checks.push({
        name: "OAuth lifecycle",
        status: "failed",
        code: safeFailure(error),
      });
    return summary;
  } finally {
    if (options.run)
      output(
        "OAuth credentials will be discarded when this process exits. Disconnect temporary forum/evidence connections in their owner consoles; remove certification DCR clients in WorkOS if desired. This runner never deletes provider applications.",
      );
  }
}

const HELP = `Usage: bun scripts/certify-forum-oauth.mjs [--discover-only | --run]
  --issuer HTTPS_ORIGIN      Expected WorkOS issuer (production issuer by default)
  --origin HTTPS_ORIGIN      configured primary origin (default)
  --with-evidence            Second normal evidence consent; proves reverse boundary
  --check-revocation         Pause for the owner to disconnect the forum connection
  --owner-id CONVEX_USER_ID  Optional expected immutable owner subject (never an email)
  --expect-actor human|agent Assert the selected acting profile
  --expect-mode direct|review Assert the selected execution mode
Default: zero-network plan. No token/client-secret/file arguments are accepted.
Browser consent must run on the same computer as the loopback listener.
--run registers temporary public OAuth clients, creates consent grants and rotates
refresh tokens. It makes authenticated status reads only, never forum writes.
Outputs are bounded assertions and a JSON summary; no credentials are persisted.
Local runner success does not certify ChatGPT/Codex UI, schedules or write behavior.`;
export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseOptions(argv);
    if (options.help) {
      console.log(HELP);
      return 0;
    }
    ensure(
      !options.checkRevocation || process.stdin.isTTY,
      "REVOCATION_REQUIRES_INTERACTIVE_TTY",
    );
    const summary = await certify(options, {
      confirmRevocation: async () => {
        ensure(process.stdin.isTTY, "REVOCATION_REQUIRES_INTERACTIVE_TTY");
        const prompt = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        try {
          const answer = await prompt.question(
            "Disconnect only this certification forum connection in Agent access; leave evidence active. Type disconnected to continue: ",
            { signal: AbortSignal.timeout(CONSENT_MS) },
          );
          ensure(answer.trim() === "disconnected", "REVOCATION_NOT_CONFIRMED");
        } finally {
          prompt.close();
        }
      },
    });
    console.log(JSON.stringify(summary));
    return summary.checks.some((entry) => entry.status === "failed") ? 1 : 0;
  } catch (error) {
    console.log(JSON.stringify({ status: "failed", code: safeFailure(error) }));
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main();
