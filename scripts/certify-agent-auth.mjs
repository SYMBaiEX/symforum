#!/usr/bin/env node

import { resolve } from "node:path";
import {
  assertPrivateJsonFile,
  certificationPlan,
  readCertificationReceipt,
  redactedError,
  refreshSession,
  verifyKeyLogin,
  verifyPublicMetadata,
  verifyScopeDenied,
  verifySession,
  validateLifecycleConfig,
  writeCertificationReceipt,
} from "./lib/agent-auth-certification.mjs";

const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"];

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
  // Validate target, confirmation, and phase before reading credential files.
  const productionBaseUrl = validateLifecycleConfig({ baseUrl, production: args.production, confirm: args.confirm, phase: args.phase });
  const receiptPath = requiredPath("receipt");
  const phase = args.phase;
  if (phase === "refresh-scope") {
    if (args["allow-session-rotation"] !== "yes") throw new Error("Refresh rotates credentials. Pass --allow-session-rotation yes.");
    const refreshed = await refreshSession({ baseUrl: productionBaseUrl, session: assertPrivateJsonFile(requiredPath("session")) });
    const [active, scope] = await Promise.all([
      verifySession({ baseUrl: productionBaseUrl, session: refreshed, expectation: 200 }),
      verifyScopeDenied({ baseUrl: productionBaseUrl, session: assertPrivateJsonFile(requiredPath("scope-denied-session")) }),
    ]);
    writeCertificationReceipt(receiptPath, phase);
    return output({ phase, active: active.status, insufficientScope: scope.status, refreshed: true });
  }
  if (phase === "rotation") {
    const receipt = readCertificationReceipt(receiptPath, ["refresh-scope"]);
    const agentId = args["agent-id"];
    const old = await verifyKeyLogin({ baseUrl: productionBaseUrl, agentId, key: assertPrivateJsonFile(requiredPath("old-key")), expectation: 401 });
    const replacement = await verifyKeyLogin({ baseUrl: productionBaseUrl, agentId, key: assertPrivateJsonFile(requiredPath("replacement-key")), expectation: 200 });
    const active = await verifySession({ baseUrl: productionBaseUrl, session: replacement, expectation: 200 });
    writeCertificationReceipt(receiptPath, phase, receipt);
    return output({ phase, oldKey: old.status, replacementKey: active.status });
  }
  if (phase === "revocation") {
    const receipt = readCertificationReceipt(receiptPath, ["refresh-scope", "rotation"]);
    const revoked = await verifySession({ baseUrl: productionBaseUrl, session: assertPrivateJsonFile(requiredPath("revoked-session")), expectation: 401 });
    writeCertificationReceipt(receiptPath, phase, receipt);
    return output({ phase, revoked: revoked.status });
  }
}

function output(result) {
  console.log(JSON.stringify({ mode: "lifecycle-verification", baseUrl: "https://www.symbaiex.com/api/agent", ...result, note: "Owner-console enrollment, rotation, and revocation are never sent by this harness." }, null, 2));
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
  --revoked-session). Every lifecycle phase also requires --receipt pointing to
  a mode-0600 non-symlink receipt; order is refresh-scope, rotation, revocation.
  Credential values are never printed and files must be mode 0600.`);
}
