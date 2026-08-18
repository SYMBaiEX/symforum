#!/usr/bin/env node

import { resolve } from "node:path";
import {
  assertPrivateJsonFile,
  certificationPlan,
  redactedError,
  refreshSession,
  verifyKeyLogin,
  verifyPublicMetadata,
  verifyScopeDenied,
  verifySession,
} from "./lib/agent-auth-certification.mjs";

const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"] ?? process.env.SYMBAIEX_AGENT_API_BASE_URL;

try {
  if (args.help) {
    printHelp();
  } else if (args["verify-public"]) {
    console.log(JSON.stringify(await verifyPublicMetadata({ baseUrl }), null, 2));
  } else if (args["run-lifecycle"]) {
    await verifyLifecycle();
  } else {
    console.log(JSON.stringify(certificationPlan({ baseUrl, agentId: args["agent-id"], includesLifecycle: false }), null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: redactedError(error) }));
  process.exitCode = 1;
}

async function verifyLifecycle() {
  if (args.production !== "strong-bee-384") {
    throw new Error("Lifecycle verification is blocked. Pass --production strong-bee-384 for the named production target.");
  }
  if (args.confirm !== "PLAT-01") {
    throw new Error("Lifecycle verification is blocked. Pass --confirm PLAT-01 after completing owner-console enrollment, rotation, and revocation.");
  }
  const phase = args.phase;
  if (phase === "refresh-scope") {
    if (args["allow-session-rotation"] !== "yes") throw new Error("Refresh rotates credentials. Pass --allow-session-rotation yes.");
    const refreshed = await refreshSession({ baseUrl, session: assertPrivateJsonFile(requiredPath("session")) });
    const [active, scope] = await Promise.all([
      verifySession({ baseUrl, session: refreshed, expectation: 200 }),
      verifyScopeDenied({ baseUrl, session: assertPrivateJsonFile(requiredPath("scope-denied-session")) }),
    ]);
    return output({ phase, active: active.status, insufficientScope: scope.status, refreshed: true });
  }
  if (phase === "rotation") {
    const agentId = args["agent-id"];
    const old = await verifyKeyLogin({ baseUrl, agentId, key: assertPrivateJsonFile(requiredPath("old-key")), expectation: 401 });
    const replacement = await verifyKeyLogin({ baseUrl, agentId, key: assertPrivateJsonFile(requiredPath("replacement-key")), expectation: 200 });
    const active = await verifySession({ baseUrl, session: replacement, expectation: 200 });
    return output({ phase, oldKey: old.status, replacementKey: active.status });
  }
  if (phase === "revocation") {
    const revoked = await verifySession({ baseUrl, session: assertPrivateJsonFile(requiredPath("revoked-session")), expectation: 401 });
    return output({ phase, revoked: revoked.status });
  }
  throw new Error("--phase must be refresh-scope, rotation, or revocation.");
}

function output(result) {
  console.log(JSON.stringify({ mode: "lifecycle-verification", baseUrl: baseUrl ?? "https://www.symbaiex.com/api/agent", ...result, note: "Owner-console enrollment, rotation, and revocation are never sent by this harness." }, null, 2));
}

function requiredPath(name) {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} is required for lifecycle verification.`);
  return resolve(value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (["help", "verify-public", "run-lifecycle"].includes(key)) result[key] = true;
    else { result[key] = argv[index + 1]; index += 1; }
  }
  return result;
}

function printHelp() {
  console.log(`Usage: bun scripts/certify-agent-auth.mjs [--verify-public]

Default: print a zero-network, zero-mutation certification plan.
--verify-public: read only public Ed25519 metadata.
--run-lifecycle --production strong-bee-384 --confirm PLAT-01: choose one phase
  after owner-console work: refresh-scope (requires --session,
  --scope-denied-session, --allow-session-rotation yes), rotation (requires
  --agent-id, --old-key, --replacement-key), or revocation (requires
  --revoked-session). Credential values are never printed and files must be
  mode 0600.`);
}
