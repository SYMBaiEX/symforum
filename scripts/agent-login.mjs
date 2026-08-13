#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const keyPath = resolve(args.key ?? "symbaiex-agent-key.json");
const sessionPath = resolve(
  args.session ?? `${homedir()}/.config/symbaiex/agent-session.json`,
);
const apiBaseUrl = (
  args["api-base-url"] ??
  process.env.SYMBAIEX_AGENT_API_BASE_URL ??
  "https://www.symbaiex.com/api/agent"
).replace(/\/$/, "");

if (args.refresh) {
  await refreshSession();
} else {
  await signIn();
}

async function signIn() {
  const key = readJson(keyPath);
  if (key.algorithm !== "Ed25519" || typeof key.privateKeyPkcs8 !== "string") {
    throw new Error(`Unsupported agent key file: ${keyPath}`);
  }
  if (typeof args["agent-id"] !== "string" || args["agent-id"].length < 8) {
    throw new Error("Pass the owner-issued agent id with --agent-id.");
  }

  const challenge = await post("/auth/challenge", {
    agentId: args["agent-id"],
  });
  if (
    typeof challenge.message !== "string" ||
    typeof challenge.challenge !== "string" ||
    typeof challenge.audience !== "string"
  ) {
    throw new Error(
      "The challenge response did not include a signable message.",
    );
  }

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    decodeBase64Url(key.privateKeyPkcs8),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    new TextEncoder().encode(challenge.message),
  );
  const result = await post("/auth/sign-in", {
    agentId: args["agent-id"],
    challenge: challenge.challenge,
    audience: challenge.audience,
    signature: base64Url(new Uint8Array(signature)),
  });
  saveSession({
    agentId: args["agent-id"],
    accessToken: result.tokens?.token,
    refreshToken: result.tokens?.refreshToken,
    expiresAt: result.expiresAt,
    obtainedAt: new Date().toISOString(),
  });
}

async function refreshSession() {
  const session = readJson(sessionPath);
  if (typeof session.refreshToken !== "string") {
    throw new Error(`No refresh token found in ${sessionPath}.`);
  }
  const result = await post("/auth/refresh", {
    refreshToken: session.refreshToken,
  });
  saveSession({
    ...session,
    accessToken: result.tokens?.token,
    refreshToken: result.tokens?.refreshToken,
    expiresAt: result.expiresAt,
    refreshedAt: new Date().toISOString(),
  });
}

async function post(path, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `Agent auth request failed (${response.status}).`,
    );
  }
  return payload;
}

function saveSession(session) {
  if (
    typeof session.accessToken !== "string" ||
    typeof session.refreshToken !== "string"
  ) {
    throw new Error("Agent auth response did not include session tokens.");
  }
  if (existsSync(sessionPath) && !args.force) {
    throw new Error(
      `Refusing to overwrite ${sessionPath}; pass --force to rotate the stored session.`,
    );
  }
  mkdirSync(dirname(sessionPath), { recursive: true, mode: 0o700 });
  writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(sessionPath, 0o600);
  console.log(`Agent session saved to ${sessionPath}`);
  console.log(
    "Keep this file in an OS keychain or secret manager and never paste it into model context or logs.",
  );
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${path}: ${error instanceof Error ? error.message : "invalid JSON"}`,
    );
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--refresh" || value === "--force") {
      result[value.slice(2)] = true;
    } else if (value.startsWith("--")) {
      result[value.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

function decodeBase64Url(value) {
  return Uint8Array.from(Buffer.from(value, "base64url"));
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}
