#!/usr/bin/env node
/**
 * Supported Password sign-up/sign-in only. No deploy key, owner impersonation,
 * role assignment, verification bypass, account deletion, or secret logging.
 *
 * Inspect first (no network, directory creation, or credential generation):
 * bun scripts/prepare-forum-review-accounts.mjs \
 *   --deployment-url https://strong-bee-384.convex.cloud \
 *   --credentials-file tmp/forum-review-credentials.json
 *
 * Explicitly initialize the three sample accounts (or reuse a same-password account):
 * bun scripts/prepare-forum-review-accounts.mjs \
 *   --deployment-url https://strong-bee-384.convex.cloud \
 *   --credentials-file tmp/forum-review-credentials.json --execute --initialize-accounts
 *
 * On later runs, omit --initialize-accounts for sign-in only. The production
 * server hides missing-account errors, so sign-in failure NEVER starts sign-up.
 *
 * Optionally request normal email verification (sends email):
 * add --member-contact-email OPERATOR_CONTROLLED_EMAIL \
 *     --request-member-email-verification
 * or  --staff-contact-email OPERATOR_CONTROLLED_EMAIL \
 *     --request-staff-email-verification
 * Complete verification through the ordinary account UI; this script cannot
 * read mail or mark an account verified. Reuse the SAME credentials file on
 * retries. Never print or attach that file to a public package/recording.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export const REVIEW_DEPLOYMENT_URL = "https://strong-bee-384.convex.cloud";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const groupPrefixes = {
  member: "member",
  scopedStaff: "staff",
  recipient: "recipient",
};
const references = {
  signIn: makeFunctionReference("auth:signIn"),
  signOut: makeFunctionReference("auth:signOut"),
  viewer: makeFunctionReference("users:maybeViewer"),
  requestVerification: makeFunctionReference(
    "accountEmailVerification:request",
  ),
};
class SafePreparationError extends Error {}
function fail(message) {
  throw new SafePreparationError(message);
}

export function parseReviewOptions(argv) {
  const options = {
    execute: false,
    initializeAccounts: false,
    requestMemberVerification: false,
    requestStaffVerification: false,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (seen.has(flag)) fail("Duplicate arguments are not allowed.");
    seen.add(flag);
    if (flag === "--execute") options.execute = true;
    else if (flag === "--initialize-accounts")
      options.initializeAccounts = true;
    else if (flag === "--request-staff-email-verification")
      options.requestStaffVerification = true;
    else if (flag === "--request-member-email-verification")
      options.requestMemberVerification = true;
    else if (
      [
        "--deployment-url",
        "--credentials-file",
        "--member-contact-email",
        "--staff-contact-email",
      ].includes(flag)
    ) {
      const value = argv[++index];
      if (!value || value.startsWith("--"))
        fail("A required argument value is missing.");
      const key = {
        "--deployment-url": "deploymentUrl",
        "--credentials-file": "credentialsFile",
        "--member-contact-email": "memberContactEmail",
        "--staff-contact-email": "staffContactEmail",
      }[flag];
      options[key] = value;
    } else fail("Unknown argument. Use --help to see the supported options.");
  }
  if (options.deploymentUrl !== REVIEW_DEPLOYMENT_URL)
    fail(
      "Supply the exact production --deployment-url https://strong-bee-384.convex.cloud; no environment fallback or other target is allowed.",
    );
  if (!options.credentialsFile)
    fail("Explicit --credentials-file tmp/NAME.json is required.");
  for (const field of ["memberContactEmail", "staffContactEmail"]) {
    if (options[field] === undefined) continue;
    const email = options[field].trim().toLowerCase();
    if (
      email.length > 254 ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
      /[\u0000-\u001f\u007f]/.test(email)
    )
      fail("Contact email must be a valid operator-controlled address.");
    options[field] = email;
  }
  if (options.requestMemberVerification && !options.memberContactEmail)
    fail(
      "Member verification requires an explicit operator-controlled --member-contact-email.",
    );
  if (options.requestStaffVerification && !options.staffContactEmail)
    fail(
      "Staff verification requires an explicit operator-controlled --staff-contact-email.",
    );
  if (options.initializeAccounts && !options.execute)
    fail(
      "First account initialization requires both --execute and --initialize-accounts.",
    );
  return options;
}

async function maybeStat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
async function checkedCredentialPath(value, createDirectory) {
  const canonicalRoot = await realpath(repoRoot);
  const tempRoot = resolve(canonicalRoot, "tmp");
  const path = resolve(value);
  if (
    dirname(path) !== tempRoot ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/.test(basename(path))
  )
    fail(
      "Credentials must be an immediate tmp/NAME.json child in this checkout; nested paths and symlinks are not allowed.",
    );
  const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", path], {
    cwd: canonicalRoot,
    stdio: "ignore",
  });
  if (ignored.status !== 0)
    fail(
      "The opted-in credential path must actually be Git-ignored and untracked in this checkout.",
    );
  let directory = await maybeStat(tempRoot);
  if (directory && (!directory.isDirectory() || directory.isSymbolicLink()))
    fail("The checkout tmp path must be a real directory, not a symlink.");
  if (!directory && createDirectory) {
    await mkdir(tempRoot, { mode: 0o700 });
    directory = await lstat(tempRoot);
  }
  if (directory && (await realpath(tempRoot)) !== tempRoot)
    fail("The tmp directory resolves outside the expected checkout.");
  const existing = await maybeStat(path);
  if (
    existing &&
    (!existing.isFile() ||
      existing.isSymbolicLink() ||
      existing.nlink !== 1 ||
      (existing.mode & 0o777) !== 0o600 ||
      (process.getuid && existing.uid !== process.getuid()))
  )
    fail(
      "Existing credentials must be a single-owner regular mode-0600 file without symlinks or hard links.",
    );
  return path;
}
function validateCredentials(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      Object.keys(groupPrefixes).sort().join(",")
  )
    fail(
      "Credential file must contain exactly member, scopedStaff and recipient username/password pairs.",
    );
  const usernames = new Set(),
    passwords = new Set();
  for (const [group, prefix] of Object.entries(groupPrefixes)) {
    const entry = value[group];
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== "password,username"
    )
      fail("Credential entries may contain only username and password.");
    if (
      typeof entry.username !== "string" ||
      !new RegExp(`^review-${prefix}-[a-f0-9]{12}$`).test(entry.username) ||
      entry.username.length > 32
    )
      fail(
        "Credential usernames must use this script's generated sample-only review prefixes.",
      );
    if (
      typeof entry.password !== "string" ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(entry.password)
    )
      fail(
        "Credential passwords must be generated high-entropy base64url values.",
      );
    usernames.add(entry.username);
    passwords.add(entry.password);
  }
  if (usernames.size !== 3 || passwords.size !== 3)
    fail("All three sample accounts require distinct usernames and passwords.");
  return value;
}
async function loadOrCreateCredentials(path) {
  const existing = await maybeStat(path);
  if (existing) {
    if (existing.size > 8192) fail("Credential file is unexpectedly large.");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      let parsed;
      try {
        parsed = JSON.parse(await handle.readFile("utf8"));
      } catch {
        fail(
          "Credential file is not valid JSON; do not overwrite it or create a second fixture set.",
        );
      }
      return validateCredentials(parsed);
    } finally {
      await handle.close();
    }
  }
  const credentials = Object.fromEntries(
    Object.entries(groupPrefixes).map(([group, prefix]) => [
      group,
      {
        username: `review-${prefix}-${randomBytes(6).toString("hex")}`,
        password: randomBytes(32).toString("base64url"),
      },
    ]),
  );
  validateCredentials(credentials);
  // Persist before any network operation: a lost sign-up response can be
  // recovered by signing in on the next run with the same saved credentials.
  const handle = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(JSON.stringify(credentials, null, 2) + "\n", "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return credentials;
}
function createClient(url) {
  const client = new ConvexHttpClient(url, {
    logger: false,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      }),
  });
  client.setFetchOptions({ redirect: "error" });
  return client;
}

export async function prepareReviewAccounts(
  options,
  {
    clientFactory = createClient,
    emit = (value) => console.log(JSON.stringify(value)),
  } = {},
) {
  if (options.deploymentUrl !== REVIEW_DEPLOYMENT_URL)
    fail("Production deployment does not match the fixed reviewer target.");
  const credentialPath = await checkedCredentialPath(
    options.credentialsFile,
    options.execute,
  );
  if (!options.execute) {
    emit({
      status: "inspection_only",
      deploymentUrl: REVIEW_DEPLOYMENT_URL,
      credentialsFile: credentialPath,
      nextStep:
        "Pass --execute for existing-account sign-in; add --initialize-accounts for explicit first initialization using the same saved credentials. No network calls or credentials were generated.",
    });
    return;
  }
  let lock;
  try {
    lock = await open(credentialPath + ".lock", "wx", 0o600);
  } catch {
    fail(
      "Credential preparation is already locked. Verify no prior process is running before removing a stale adjacent .lock file.",
    );
  }
  try {
    const credentials = await loadOrCreateCredentials(credentialPath);
    for (const group of Object.keys(groupPrefixes)) {
      const client = clientFactory(REVIEW_DEPLOYMENT_URL);
      let authenticated = false,
        primaryFailure = false;
      try {
        const credential = credentials[group];
        const params = {
          username: credential.username,
          email: `${credential.username}@users.symbaiex.local`,
          password: credential.password,
        };
        const contactEmail =
          group === "member"
            ? options.memberContactEmail
            : group === "scopedStaff"
              ? options.staffContactEmail
              : undefined;
        const requestVerification =
          group === "member"
            ? options.requestMemberVerification
            : group === "scopedStaff"
              ? options.requestStaffVerification
              : false;
        if (contactEmail) params.contactEmail = contactEmail;
        let result;
        // Explicit opt-in selects the supported signUp flow. Installed Password
        // createAccountFromCredentials reuses a matching existing account and
        // rejects a collision with a different password; it does not reset it.
        // Production redacts InvalidAccountId, so NEVER infer absence from an
        // unknown sign-in failure and NEVER fall back between flows.
        const flow = options.initializeAccounts ? "signUp" : "signIn";
        const status = options.initializeAccounts
          ? "initialized_or_existing"
          : "signed_in_existing";
        try {
          result = await client.action(references.signIn, {
            provider: "password",
            params: { ...params, flow },
          });
        } catch {
          fail(
            options.initializeAccounts
              ? `The ${group} initialization did not return successfully. Retain the same credential file; a matching account may exist after a lost response. A different-password collision is never reset. No alternate flow or second fixture set was attempted.`
              : `The ${group} sign-in failed. Production may redact the reason; no sign-up fallback was attempted. Retain the same credential file. Use --execute --initialize-accounts only after confirming intentional fixture initialization.`,
          );
        }
        if (typeof result?.tokens?.token !== "string" || !result.tokens.token)
          fail(
            `The ${group} Password flow did not return a session. Stop and inspect the normal sign-in configuration.`,
          );
        client.setAuth(result.tokens.token);
        authenticated = true;
        result = undefined; // Access and refresh tokens are never written or emitted.
        const viewer = await client.query(references.viewer, {});
        if (
          !viewer ||
          viewer.username !== credential.username ||
          viewer.isAgent ||
          viewer.role !== "reader" ||
          typeof viewer._id !== "string" ||
          !/^[a-zA-Z0-9]+$/.test(viewer._id)
        )
          fail(
            `The ${group} session did not resolve to the expected sample-only human reader. No role or trust changes were attempted.`,
          );
        emit({ group, status, userId: viewer._id });
        if (requestVerification) {
          let verification;
          try {
            verification = await client.mutation(
              references.requestVerification,
              { email: contactEmail },
            );
          } catch {
            fail(
              `Normal ${group} email-verification request failed. Earlier fixture accounts may already be prepared; retain the credential file. Do not bypass verification or automatically resend. Check the ordinary account UI and mail configuration.`,
            );
          }
          if (!["queued", "already_verified"].includes(verification?.status))
            fail(
              "Unexpected email-verification response; no verification success is assumed.",
            );
          emit({
            group,
            emailVerificationRequest: verification.status,
            nextStep:
              verification.status === "queued"
                ? `Complete the normal email code flow in the ${group} account UI. No mailbox is read and no verified flag is set by this script.`
                : `The server reports this ${group} account was already verified.`,
          });
        }
      } catch (error) {
        primaryFailure = true;
        if (error instanceof SafePreparationError) throw error;
        fail(
          `The ${group} preparation failed. No raw server error, token or password is printed. Retain the credential file and inspect the normal login/account path.`,
        );
      } finally {
        try {
          if (authenticated) await client.action(references.signOut, {});
        } catch {
          if (!primaryFailure)
            fail(
              `The ${group} temporary session could not be invalidated. No token was stored; inspect server availability before continuing.`,
            );
        } finally {
          client.clearAuth();
        }
      }
    }
    emit({
      status: "prepared",
      credentialsFile: credentialPath,
      nextStep:
        "A human site owner must separately grant posting trust to the sample accounts, assign only the needed forum role/board authority to scopedStaff, and prepare sample boards/threads/owned agents. No roles, trust or verification state were granted here. Copy reviewer credentials only into the secure portal form.",
    });
  } finally {
    await lock.close();
    await unlink(credentialPath + ".lock");
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.slice(2).includes("--help")) {
    console.log(
      "Usage: bun scripts/prepare-forum-review-accounts.mjs --deployment-url https://strong-bee-384.convex.cloud --credentials-file tmp/NAME.json [--execute] [--initialize-accounts] [--member-contact-email ADDRESS] [--request-member-email-verification] [--staff-contact-email ADDRESS] [--request-staff-email-verification]\nDefault is inspection only. --execute signs in existing sample accounts with mode-0600 credential persistence. Add --initialize-accounts for explicit supported Password signUp (same-password existing accounts are reused; collisions are not reset). No unknown sign-in failure starts sign-up. Email is sent only with its explicit verification-request flag. Reuse the same credential file on retries.",
    );
  } else {
    try {
      await prepareReviewAccounts(parseReviewOptions(process.argv.slice(2)));
    } catch (error) {
      console.error(
        error instanceof SafePreparationError
          ? error.message
          : "Preparation failed without printing sensitive error data. Retain the credential file and inspect paths, permissions and server availability.",
      );
      process.exitCode = 1;
    }
  }
}
