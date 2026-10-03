#!/usr/bin/env node
/**
 * Sample forum fixtures through supported first-party APIs only.
 * Inspect: bun scripts/prepare-forum-review-content.mjs --deployment-url
 * https://strong-bee-384.convex.cloud --credentials-file tmp/forum-review-credentials.json
 * --receipt-file tmp/forum-review-content.json
 * Add --execute to seed/reuse fixtures. Never grants roles/trust, creates
 * connections, reads mail, or bypasses verification. Keep the same receipt.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { REVIEW_DEPLOYMENT_URL } from "./prepare-forum-review-accounts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const board = "plugin-review";
const restrictedBoard = "plugin-review-staff";
export const REVIEW_CONTENT_FIXTURES = [
  {
    key: "welcome",
    actor: "member",
    title: "Welcome to Plugin Review",
    body: "Sample-only SYMBaiEX plugin review thread. Use this topic to test forum discovery, owner-assisted replies, attachments, bookmarks and subscriptions. Do not post private information.",
  },
  {
    key: "moderation",
    actor: "member",
    title: "Moderation rehearsal",
    body: "Disposable sample-only moderation fixture. Authorized review staff may lock, unlock, hide and restore this topic during the plugin walkthrough. This is not a real moderation report.",
  },
  {
    key: "poll",
    actor: "recipient",
    title: "Plugin Review voting rehearsal",
    body: "Sample-only poll by the unrelated review recipient. Use it to confirm one owner voting identity across delegated agent profiles.",
    poll: {
      question: "Which sample forum feature would you try first?",
      options: ["Find a topic", "Reply to a topic", "Bookmark a topic"],
    },
  },
];
class SafeContentError extends Error {}
const fail = (message) => {
  throw new SafeContentError(message);
};
const ref = (name) => makeFunctionReference(name);

export function parseContentOptions(argv) {
  const options = { execute: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) fail("Duplicate arguments are not allowed.");
    seen.add(flag);
    if (flag === "--execute") options.execute = true;
    else {
      const field = {
        "--deployment-url": "deploymentUrl",
        "--credentials-file": "credentialsFile",
        "--receipt-file": "receiptFile",
      }[flag];
      if (!field || !argv[i + 1] || argv[i + 1].startsWith("--"))
        fail("Unsupported or missing argument; use --help.");
      options[field] = argv[++i];
    }
  }
  if (options.deploymentUrl !== REVIEW_DEPLOYMENT_URL)
    fail(
      "Supply the exact production --deployment-url https://strong-bee-384.convex.cloud.",
    );
  if (!options.credentialsFile || !options.receiptFile)
    fail("Explicit ignored tmp credential and receipt paths are required.");
  return options;
}
async function checkedPath(value, required) {
  const temp = resolve(await realpath(root), "tmp");
  const path = resolve(value);
  if (
    dirname(path) !== temp ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/.test(basename(path))
  )
    fail("Files must be immediate tmp/NAME.json children of this checkout.");
  if (
    spawnSync("git", ["check-ignore", "--quiet", "--", path], {
      cwd: root,
      stdio: "ignore",
    }).status !== 0
  )
    fail("Credential and receipt files must be Git-ignored and untracked.");
  const directory = await lstat(temp);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (await realpath(temp)) !== temp
  )
    fail("The tmp directory must be real and local to this checkout.");
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.uid !== process.getuid() ||
      metadata.size > 32768
    )
      fail(
        "Files must be owned regular mode-0600 files without links and within size limits.",
      );
  } catch (error) {
    if (error?.code !== "ENOENT" || required) throw error;
  }
  return path;
}
async function readJson(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}
function validCredentials(value) {
  if (
    !value ||
    Object.keys(value).sort().join() !== "member,recipient,scopedStaff"
  )
    fail(
      "Expected the existing three-account username/password credential file.",
    );
  const passwords = new Set(),
    usernames = new Set();
  for (const [group, prefix] of Object.entries({
    member: "member",
    recipient: "recipient",
    scopedStaff: "staff",
  })) {
    const entry = value[group];
    if (
      !entry ||
      Object.keys(entry).sort().join() !== "password,username" ||
      !new RegExp(`^review-${prefix}-[a-f0-9]{12}$`).test(entry.username) ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(entry.password)
    )
      fail(
        "Credentials must use generated sample-only accounts and contain only username/password pairs.",
      );
    passwords.add(entry.password);
    usernames.add(entry.username);
  }
  if (passwords.size !== 3 || usernames.size !== 3)
    fail("Sample credentials must be distinct.");
  return value;
}
function newClient(url) {
  return new ConvexHttpClient(url, {
    logger: false,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      }),
  });
}
function validateReceipt(value) {
  if (
    !value ||
    value.version !== 1 ||
    value.deploymentUrl !== REVIEW_DEPLOYMENT_URL ||
    value.board !== board ||
    typeof value.fixtures !== "object" ||
    Array.isArray(value.fixtures) ||
    Object.keys(value).some(
      (key) =>
        ![
          "version",
          "deploymentUrl",
          "board",
          "fixtures",
          "accounts",
          "restrictedRead",
        ].includes(key),
    )
  )
    fail(
      "Receipt does not match this production fixture set; do not overwrite it.",
    );
  for (const [key, entry] of Object.entries(value.fixtures)) {
    if (
      !REVIEW_CONTENT_FIXTURES.some((fixture) => fixture.key === key) ||
      !entry ||
      Object.keys(entry).some(
        (field) =>
          !["state", "threadId", "threadSlug", "status"].includes(field),
      ) ||
      !["in_flight", "prepared"].includes(entry.state) ||
      (entry.state === "prepared" &&
        (!/^[a-zA-Z0-9]+$/.test(entry.threadId) ||
          !/^[a-z0-9-]+$/.test(entry.threadSlug) ||
          !["active", "pending"].includes(entry.status)))
    )
      fail("Unexpected fixture receipt; stop for operator reconciliation.");
  }
  // Validate every public account projection too: receipts never contain secrets.
  if (value.accounts)
    for (const [group, entry] of Object.entries(value.accounts)) {
      if (
        !["member", "recipient", "scopedStaff"].includes(group) ||
        !entry ||
        Object.keys(entry).some(
          (field) =>
            !["userId", "username", "emailVerified", "agentCreation"].includes(
              field,
            ),
        ) ||
        !/^[a-zA-Z0-9]+$/.test(entry.userId) ||
        !/^review-(member|staff|recipient)-[a-f0-9]{12}$/.test(
          entry.username,
        ) ||
        typeof entry.emailVerified !== "boolean" ||
        entry.agentCreation !== "skipped_connection_consent_required"
      )
        fail("Unexpected account receipt projection.");
    }
  if (
    value.restrictedRead !== undefined &&
    !["denied", "unconfirmed_error"].includes(value.restrictedRead)
  )
    fail("Unexpected restricted read status.");
  return value;
}
async function allThreads(client) {
  const threads = [];
  for (let page = 1; page <= 20; page++) {
    const result = await client.query(ref("forum:listThreads"), {
      categorySlug: board,
      page,
      pageSize: 50,
    });
    if (
      !Array.isArray(result?.threads) ||
      !result.pagination ||
      result.pagination.limited
    )
      fail(
        "Fixture board scan is incomplete; stop instead of risking duplicates.",
      );
    threads.push(...result.threads);
    if (!result.pagination.hasNextPage) return threads;
  }
  fail("Fixture board exceeds the safe full-scan limit.");
}
function matchingDetail(detail, fixture, username) {
  const thread = detail?.thread;
  if (
    !thread ||
    thread.title !== fixture.title ||
    thread.author !== username ||
    thread.body !== fixture.body
  )
    fail(
      "An existing fixture title has different ownership or content; no replacement or duplicate was created.",
    );
  if (
    fixture.poll &&
    (detail.poll?.question !== fixture.poll.question ||
      JSON.stringify(detail.poll.options?.map((option) => option.label)) !==
        JSON.stringify(fixture.poll.options))
  )
    fail(
      "Existing poll differs from the expected sample poll; no duplicate was created.",
    );
  return thread;
}

export async function prepareReviewContent(
  options,
  {
    clientFactory = newClient,
    emit = (value) => console.log(JSON.stringify(value)),
    sleep = (milliseconds) =>
      new Promise((done) => setTimeout(done, milliseconds)),
  } = {},
) {
  if (options.deploymentUrl !== REVIEW_DEPLOYMENT_URL)
    fail("Wrong production deployment target.");
  const credentialPath = await checkedPath(options.credentialsFile, true);
  const receiptPath = await checkedPath(options.receiptFile, false);
  if (credentialPath === receiptPath)
    fail("Receipt must be separate from credentials.");
  if (!options.execute) {
    emit({
      status: "inspection_only",
      board,
      restrictedBoard,
      nextStep:
        "Add --execute to seed sample content using existing accounts; no network calls were made.",
    });
    return;
  }
  const credentials = validCredentials(await readJson(credentialPath));
  let receipt;
  let lock;
  try {
    lock = await open(receiptPath + ".lock", "wx", 0o600);
  } catch {
    fail(
      "Receipt is locked; confirm no preparation is running before reconciling a stale lock.",
    );
  }
  const save = async () => {
    validateReceipt(receipt);
    const temporary = receiptPath + "." + randomBytes(8).toString("hex");
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(receipt, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, receiptPath);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  };
  try {
    // Receipt snapshots are authoritative only while holding this lock. Never
    // read before acquiring it: a delayed process could otherwise retain an
    // old snapshot after another process recorded a pending/hidden write.
    await checkedPath(options.receiptFile, false);
    try {
      receipt = validateReceipt(await readJson(receiptPath));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      receipt = {
        version: 1,
        deploymentUrl: REVIEW_DEPLOYMENT_URL,
        board,
        fixtures: {},
        accounts: {},
      };
    }
    for (const group of ["member", "recipient", "scopedStaff"]) {
      const client = clientFactory(REVIEW_DEPLOYMENT_URL);
      let authenticated = false;
      try {
        const credential = credentials[group];
        const result = await client.action(ref("auth:signIn"), {
          provider: "password",
          params: {
            flow: "signIn",
            username: credential.username,
            email: `${credential.username}@users.symbaiex.local`,
            password: credential.password,
          },
        });
        if (!result?.tokens?.token)
          fail(
            "Normal sample sign-in did not return a session; no signup was attempted.",
          );
        client.setAuth(result.tokens.token);
        authenticated = true;
        const viewer = await client.query(ref("users:maybeViewer"), {});
        if (
          !viewer ||
          viewer.username !== credential.username ||
          viewer.isAgent ||
          viewer.role !== "reader" ||
          !/^[a-zA-Z0-9]+$/.test(viewer._id)
        )
          fail("Session is not the expected sample-only human reader.");
        receipt.accounts ??= {};
        if (
          receipt.accounts[group] &&
          receipt.accounts[group].userId !== viewer._id
        )
          fail(
            "Receipt belongs to different sample accounts; do not reuse it for another fixture set.",
          );
        receipt.accounts[group] = {
          userId: viewer._id,
          username: credential.username,
          emailVerified: viewer.emailVerified === true,
          agentCreation: "skipped_connection_consent_required",
        };
        await save();
        const categories = await client.query(ref("forum:listCategories"), {
          limit: 200,
        });
        if (
          !Array.isArray(categories) ||
          !categories.some((category) => category.slug === board)
        )
          fail(
            "Public Plugin Review board is not visible; create it through owner controls first.",
          );
        if (group === "member") {
          if (categories.some((category) => category.slug === restrictedBoard))
            fail(
              "Member can see the restricted staff board; fix board permissions before reviewing.",
            );
          try {
            await client.query(ref("forum:listThreads"), {
              categorySlug: restrictedBoard,
            });
            fail("Member could read the restricted staff board.");
          } catch (error) {
            if (error instanceof SafeContentError) throw error;
            receipt.restrictedRead =
              error?.data?.code === "CATEGORY_NOT_FOUND"
                ? "denied"
                : "unconfirmed_error";
          }
          await save();
          emit({ group, restrictedRead: receipt.restrictedRead });
        }
        const threads = await allThreads(client);
        let actorHasWritten = false;
        for (const fixture of REVIEW_CONTENT_FIXTURES.filter(
          (item) => item.actor === group,
        )) {
          const matches = threads.filter(
            (thread) => thread.title === fixture.title,
          );
          if (matches.length > 1)
            fail(
              "Multiple fixture titles exist; operator reconciliation is required.",
            );
          const prior = receipt.fixtures[fixture.key];
          let thread;
          if (matches.length) {
            const detail = await client.query(ref("forum:getThread"), {
              categorySlug: board,
              threadSlug: matches[0].slug,
            });
            thread = matchingDetail(detail, fixture, credential.username);
            if (prior?.threadId && prior.threadId !== thread._id)
              fail(
                "Receipt points to a different thread; reconcile before continuing.",
              );
          } else if (prior) {
            if (prior.state === "prepared" && prior.status === "pending") {
              emit({
                fixture: fixture.key,
                status: "pending_approval",
                threadId: prior.threadId,
              });
              continue;
            }
            fail(
              "An in-flight or prepared fixture is absent from the full board scan. Do not retry blindly; inspect pending/hidden content and reconcile the receipt.",
            );
          } else {
            // Normal forum posting enforces a 15-second per-author interval.
            // Keep a margin and preserve that server rule; tests inject sleep.
            if (actorHasWritten) await sleep(15_500);
            receipt.fixtures[fixture.key] = { state: "in_flight" };
            await save();
            let result;
            try {
              result = await client.mutation(ref("forum:createThread"), {
                categorySlug: board,
                title: fixture.title,
                body: fixture.body,
                ...(fixture.poll ? { poll: fixture.poll } : {}),
              });
            } catch (error) {
              // This exact application rejection happens before inserts and
              // aborts the mutation. Opaque/transport errors remain in_flight.
              if (
                error instanceof ConvexError &&
                error.data?.code === "THREAD_RATE_LIMITED"
              ) {
                delete receipt.fixtures[fixture.key];
                await save();
                fail(
                  "Forum posting interval rejected this attempt before commit. The attempted fixture receipt was cleared safely; retain the same receipt and rerun after waiting at least 15 seconds. Earlier prepared fixtures remain recorded.",
                );
              }
              throw error;
            }
            if (
              !/^[a-zA-Z0-9]+$/.test(result?.threadId) ||
              !/^[a-z0-9-]+$/.test(result.threadSlug) ||
              !["active", "pending"].includes(result.status)
            )
              fail(
                "Unexpected thread creation result; reconcile the in-flight receipt.",
              );
            thread = {
              _id: result.threadId,
              slug: result.threadSlug,
              status: result.status,
            };
            actorHasWritten = true;
          }
          receipt.fixtures[fixture.key] = {
            state: "prepared",
            threadId: thread._id,
            threadSlug: thread.slug,
            status: thread.status,
          };
          await save();
          emit({
            fixture: fixture.key,
            ...receipt.fixtures[fixture.key],
            url: `https://forum.symbaiex.com/${board}/${thread.slug}`,
          });
        }
      } catch (error) {
        if (error instanceof SafeContentError) throw error;
        fail(
          "Preparation failed without exposing server errors or credentials. Retain the receipt; inspect normal login, permissions, pending content and any in-flight fixture before retrying.",
        );
      } finally {
        try {
          if (authenticated) await client.action(ref("auth:signOut"), {});
        } catch {
          fail(
            "Temporary session invalidation failed; no token was stored. Inspect server availability.",
          );
        } finally {
          client.clearAuth();
        }
      }
    }
    emit({
      status: "prepared",
      receiptFile: receiptPath,
      nextStep:
        "Root/operator must complete verified profile creation and browser/OAuth consents separately. No profiles, connections, permissions or verified flags were created.",
    });
  } finally {
    await lock.close();
    await unlink(receiptPath + ".lock");
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes("--help"))
    console.log(
      "Usage: bun scripts/prepare-forum-review-content.mjs --deployment-url https://strong-bee-384.convex.cloud --credentials-file tmp/NAME.json --receipt-file tmp/NAME.json [--execute]\nInspection is the default. Existing sample accounts only; no signup, grants, profile creation or connection consent. Retain the same receipt on retries.",
    );
  else
    try {
      await prepareReviewContent(parseContentOptions(process.argv.slice(2)));
    } catch (error) {
      console.error(
        error instanceof SafeContentError
          ? error.message
          : "Preparation failed; raw errors are redacted. Check ignored paths and mode-0600 files.",
      );
      process.exitCode = 1;
    }
}
