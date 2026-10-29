#!/usr/bin/env node

import { PRIMARY_SITE_URL } from "../lib/site-urls.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Live, owner-approved smoke. Never prints tokens, assertions, codes or attempt URLs.
const origin = PRIMARY_SITE_URL;
const issuer = `${origin}/agent-auth`;
const workosIssuer = "https://unique-evening-77.authkit.app";
const resource = `${origin}/api/agent/mcp`;
const grant = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const claimGrant = "urn:workos:agent-auth:grant-type:claim";
const email = process.argv[2];
if (
  !email ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  process.argv.length !== 3
) {
  console.error("Usage: bun scripts/smoke-agent-service-auth.mjs OWNER_EMAIL");
  process.exit(1);
}
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
let handoffDirectory;
let accessToken;
const issuedTokens = [];
async function call(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  check(body.length <= 256 * 1024, "Response too large");
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    throw new Error("Non-JSON response");
  }
  return { status: response.status, headers: response.headers, data };
}
const form = (url, input) =>
  call(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(input),
  });
const status = (token) =>
  call(`${origin}/api/agent/v1/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
const mcpStatus = (token) =>
  call(resource, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "evidence_status",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "service-auth-smoke-status",
      method: "tools/call",
      params: {
        name: "evidence_status",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "symbaiex-service-auth-smoke",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
async function checkMcpAccess(token) {
  const response = await mcpStatus(token);
  const result = response.data?.result;
  check(
    response.status === 200 &&
      response.data?.id === "service-auth-smoke-status" &&
      !response.data.error &&
      result?.resultType === "complete" &&
      !result.isError,
    "Approved credential failed on MCP tools/call",
  );
  const content = result.content?.find((item) => item.type === "text");
  let evidence;
  try {
    evidence = JSON.parse(content?.text ?? "null");
  } catch {
    throw new Error("Invalid MCP evidence response");
  }
  check(evidence?.status === "available", "MCP did not return evidence status");
}
try {
  const metadata = await call(
    `${origin}/.well-known/oauth-authorization-server/agent-auth`,
  );
  check(
    metadata.status === 200 && metadata.data.issuer === issuer,
    "Discovery is not enabled or issuer mismatched",
  );
  for (const [field, path] of [
    ["token_endpoint", "/token"],
    ["revocation_endpoint", "/revoke"],
    ["jwks_uri", "/jwks"],
  ])
    check(
      metadata.data[field] === issuer + path,
      "Unexpected authorization endpoint",
    );
  check(
    JSON.stringify(metadata.data.agent_auth?.identity_types_supported) ===
      '["service_auth"]',
    "Unexpected identity types",
  );
  const prm = await call(`${origin}/.well-known/oauth-protected-resource`);
  check(
    prm.status === 200 &&
      prm.data.resource === resource &&
      prm.data.authorization_servers.includes(issuer) &&
      prm.data.authorization_servers.includes(workosIssuer),
    "PRM must retain WorkOS alongside the service issuer",
  );
  const hostedWorkos = await call(
    `${workosIssuer}/.well-known/oauth-authorization-server`,
  );
  const mirroredWorkos = await call(
    `${origin}/.well-known/oauth-authorization-server`,
  );
  check(
    hostedWorkos.status === 200 &&
      mirroredWorkos.status === 200 &&
      hostedWorkos.data.issuer === workosIssuer &&
      mirroredWorkos.data.issuer === workosIssuer,
    "Existing WorkOS issuer was not preserved",
  );
  for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri"])
    check(
      typeof hostedWorkos.data[field] === "string" &&
        new URL(hostedWorkos.data[field]).origin === workosIssuer &&
        mirroredWorkos.data[field] === hostedWorkos.data[field],
      "WorkOS mirror must preserve hosted authorization endpoints",
    );
  console.log("PASS service discovery and preserved WorkOS issuer/endpoints");
  const registration = await call(`${issuer}/identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "service_auth", login_hint: email }),
  });
  check(
    registration.status === 200 &&
      !registration.data.access_token &&
      !registration.data.identity_assertion,
    "Registration must not issue credentials before approval",
  );
  const claim = registration.data.claim;
  const verification = new URL(claim.verification_uri);
  check(
    verification.origin === origin &&
      verification.pathname === "/agent/claim" &&
      /^\d{6}$/.test(claim.user_code),
    "Invalid claim handoff",
  );
  const pending = await form(`${issuer}/token`, {
    grant_type: claimGrant,
    claim_token: registration.data.claim_token,
  });
  check(
    pending.status === 400 && pending.data.error === "authorization_pending",
    "Pre-approval token issuance was not denied",
  );
  handoffDirectory = await mkdtemp(
    join(tmpdir(), "symbaiex-service-auth-smoke-"),
  );
  const handoffFile = join(handoffDirectory, "approval.html");
  await writeFile(
    handoffFile,
    `<!doctype html><meta name="referrer" content="no-referrer"><title>SYMBaiEX owner approval</title><h1>Approve only this smoke request</h1><p>Open the verified SYMBaiEX page, sign in as ${escape(email)}, select your evidence agent, and enter <strong>${escape(claim.user_code)}</strong>.</p><p><a rel="noreferrer" href="${escape(verification.href)}">Open the owner approval page</a></p><p>No access tokens or private keys are stored in this file. It is removed after the smoke.</p>`,
    { mode: 0o600 },
  );
  console.log(
    `PASS no pre-approval credentials. Human handoff: open ${handoffFile}. Waiting up to ten minutes for your approval.`,
  );
  const deadline = Date.now() + 10 * 60_000;
  let interval = Math.max(5, claim.interval ?? 5);
  let received;
  while (Date.now() < deadline) {
    await delay(interval * 1000);
    const poll = await form(`${issuer}/token`, {
      grant_type: claimGrant,
      claim_token: registration.data.claim_token,
    });
    if (poll.status === 200) {
      received = poll;
      break;
    }
    if (poll.data?.error === "slow_down") {
      interval += 5;
      continue;
    }
    check(
      poll.data?.error === "authorization_pending",
      "Claim expired, denied or unavailable; restart after checking the owner account",
    );
  }
  check(received, "Approval timed out");
  accessToken = received.data.access_token;
  issuedTokens.push(accessToken);
  check(
    received.data.identity_assertion &&
      !received.data.refresh_token &&
      received.data.scope === "evidence",
    "Incorrect credential response",
  );
  check(
    received.headers.get("cache-control")?.includes("no-store"),
    "Credential response is cacheable",
  );
  check(
    (await status(accessToken)).status === 200,
    "Approved credential failed on evidence API",
  );
  check(
    (await status(received.data.identity_assertion)).status === 401,
    "Assertion accepted as an API access token",
  );
  await checkMcpAccess(accessToken);
  check(
    (await mcpStatus(received.data.identity_assertion)).status === 401,
    "Assertion accepted as an MCP access token",
  );
  console.log(
    "PASS owner approval, evidence REST/MCP tools/call and assertion isolation",
  );
  const revoked = await form(`${issuer}/revoke`, {
    token: accessToken,
    token_type_hint: "access_token",
  });
  check(
    revoked.status === 200 &&
      (await status(accessToken)).status === 401 &&
      (await mcpStatus(accessToken)).status === 401,
    "Token revocation failed",
  );
  const refresh = await form(`${issuer}/token`, {
    grant_type: grant,
    assertion: received.data.identity_assertion,
    resource,
  });
  check(
    refresh.status === 200,
    "Token revocation incorrectly revoked assertion",
  );
  accessToken = refresh.data.access_token;
  issuedTokens.push(accessToken);
  check(
    (await status(accessToken)).status === 200,
    "Refreshed token cannot access evidence API",
  );
  await checkMcpAccess(accessToken);
  console.log(
    `PASS token revoke and bounded assertion reuse. Now disconnect registration ${registration.data.registration_id} at ${origin}/agent/claim. Waiting up to five minutes.`,
  );
  let denied = false;
  const revokeDeadline = Date.now() + 5 * 60_000;
  while (Date.now() < revokeDeadline) {
    await delay(10_000);
    if ((await status(accessToken)).status === 401) {
      denied = true;
      break;
    }
  }
  check(denied, "Owner revocation timed out");
  check(
    (await mcpStatus(accessToken)).status === 401,
    "Owner revocation did not block MCP access",
  );
  const blocked = await form(`${issuer}/token`, {
    grant_type: grant,
    assertion: received.data.identity_assertion,
    resource,
  });
  check(
    blocked.status === 400 && blocked.data.error === "invalid_grant",
    "Owner revocation did not block token issuance",
  );
  console.log(
    "PASS owner disconnect invalidates REST/MCP access and future issuance. Service-auth activation smoke complete.",
  );
} catch (error) {
  console.error(
    `FAIL ${error instanceof Error ? error.message : "Service-auth smoke failed"}. No bearer material printed. Disconnect any smoke registration in the owner console.`,
  );
  process.exitCode = 1;
} finally {
  for (const token of issuedTokens) {
    try {
      await form(`${issuer}/revoke`, { token });
    } catch {
      /* Owner console and short expiry remain recovery paths. */
    }
  }
  // Exact temporary directory created by this process, never caller-supplied.
  if (handoffDirectory)
    await rm(handoffDirectory, { recursive: true, force: true });
}
