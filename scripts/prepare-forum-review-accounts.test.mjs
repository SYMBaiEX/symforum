// @vitest-environment node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "vitest";
import { fileURLToPath } from "node:url";
import { getFunctionName } from "convex/server";
import {
  parseReviewOptions,
  prepareReviewAccounts,
  REVIEW_DEPLOYMENT_URL,
} from "./prepare-forum-review-accounts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const accessToken = "TEST_ACCESS_TOKEN_NEVER_EMIT";
const refreshToken = "TEST_REFRESH_TOKEN_NEVER_EMIT";

// All fixture files are unique, ignored, and removed in finally. This suite
// never constructs a real Convex client or calls the network.
async function fixture(run) {
  await mkdir(resolve(root, "tmp"), { recursive: true });
  const path = resolve(
    root,
    "tmp",
    `review-test-${randomBytes(8).toString("hex")}.json`,
  );
  const output = [];
  const options = {
    deploymentUrl: REVIEW_DEPLOYMENT_URL,
    credentialsFile: path,
    execute: true,
    initializeAccounts: true,
  };
  try {
    await run({ path, options, output });
  } finally {
    await rm(path, { force: true });
    await rm(path + ".lock", { force: true });
  }
}

function mockServer({ opaqueSignIn = false, queryFailure = false } = {}) {
  const accounts = new Map();
  const calls = [];
  let clients = 0;
  const clientFactory = (url) => {
    assert.equal(url, REVIEW_DEPLOYMENT_URL);
    clients++;
    let current;
    let token;
    return {
      async action(reference, args) {
        const name = getFunctionName(reference);
        calls.push({ name, flow: args.params?.flow });
        if (name === "auth:signOut") {
          assert.equal(token, accessToken);
          return null;
        }
        assert.equal(name, "auth:signIn");
        assert.equal(args.provider, "password");
        const { username, password, email, flow } = args.params;
        assert.equal(email, `${username}@users.symbaiex.local`);
        let account = accounts.get(username);
        if (flow === "signIn" && opaqueSignIn)
          throw new Error(
            `Server Error ${password} ${accessToken} ${refreshToken}`,
          );
        // Matches installed Password behavior: same-password signUp reuses;
        // different-password collisions reject without replacing the account.
        if (account && account.password !== password)
          throw new Error(`Account already exists ${password} ${accessToken}`);
        if (!account && flow === "signIn") throw new Error("InvalidAccountId");
        if (!account) {
          assert.equal(flow, "signUp");
          account = {
            password,
            viewer: {
              username,
              role: "reader",
              _id: `user${accounts.size + 1}`,
            },
          };
          accounts.set(username, account);
        }
        current = account;
        return { tokens: { token: accessToken, refreshToken } };
      },
      setAuth(value) {
        token = value;
      },
      clearAuth() {
        token = undefined;
      },
      async query(reference) {
        assert.equal(getFunctionName(reference), "users:maybeViewer");
        assert.equal(token, accessToken);
        if (queryFailure) throw new Error(`${accessToken} ${refreshToken}`);
        return current.viewer;
      },
    };
  };
  return { accounts, calls, clientFactory, clientCount: () => clients };
}

test("initialization persists private ignored credentials, and retries reuse them", async () => {
  await fixture(async ({ path, options, output }) => {
    const server = mockServer();
    const dependencies = {
      clientFactory: server.clientFactory,
      emit: (value) => output.push(value),
    };
    await prepareReviewAccounts(options, dependencies);
    const original = await readFile(path, "utf8");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(
      spawnSync("git", ["check-ignore", "--quiet", "--", path], { cwd: root })
        .status,
      0,
    );
    assert.equal(server.accounts.size, 3);
    assert.equal(server.clientCount(), 3);
    await prepareReviewAccounts(options, dependencies);
    assert.equal(server.accounts.size, 3);
    assert.equal(await readFile(path, "utf8"), original);
    await prepareReviewAccounts(
      { ...options, initializeAccounts: false },
      dependencies,
    );
    assert.equal(
      server.calls.filter((call) => call.flow === "signIn").length,
      3,
    );
    assert.equal(
      server.calls.filter((call) => call.name === "auth:signOut").length,
      9,
    );
    const serialized = JSON.stringify(output);
    for (const entry of Object.values(JSON.parse(original)))
      assert.ok(!serialized.includes(entry.password));
    assert.ok(!serialized.includes(accessToken));
    assert.ok(!serialized.includes(refreshToken));
    assert.deepEqual(Object.keys(JSON.parse(original)).sort(), [
      "member",
      "recipient",
      "scopedStaff",
    ]);
    for (const entry of Object.values(JSON.parse(original)))
      assert.deepEqual(Object.keys(entry).sort(), ["password", "username"]);
  });
});

test("opaque production sign-in failure never attempts sign-up or exposes secrets", async () => {
  await fixture(async ({ path, options, output }) => {
    await prepareReviewAccounts(options, {
      clientFactory: mockServer().clientFactory,
      emit: () => {},
    });
    const server = mockServer({ opaqueSignIn: true });
    let error;
    try {
      await prepareReviewAccounts(
        { ...options, initializeAccounts: false },
        {
          clientFactory: server.clientFactory,
          emit: (value) => output.push(value),
        },
      );
    } catch (caught) {
      error = caught;
    }
    assert.match(error?.message, /no sign-up fallback was attempted/);
    assert.deepEqual(server.calls, [{ name: "auth:signIn", flow: "signIn" }]);
    assert.equal(server.accounts.size, 0);
    const text = JSON.stringify(output) + error.message;
    for (const entry of Object.values(JSON.parse(await readFile(path, "utf8"))))
      assert.ok(!text.includes(entry.password));
    assert.ok(!text.includes(accessToken));
    assert.ok(!text.includes(refreshToken));
  });
});

test("wrong-password initialization collision cannot reset an existing account", async () => {
  await fixture(async ({ path, options }) => {
    const server = mockServer();
    const dependencies = {
      clientFactory: server.clientFactory,
      emit: () => {},
    };
    await prepareReviewAccounts(options, dependencies);
    const credentials = JSON.parse(await readFile(path, "utf8"));
    const originalPassword = credentials.member.password;
    credentials.member.password = randomBytes(32).toString("base64url");
    await writeFile(path, JSON.stringify(credentials));
    await assert.rejects(
      prepareReviewAccounts(options, dependencies),
      /different-password collision is never reset/,
    );
    assert.equal(server.accounts.size, 3);
    assert.equal(
      server.accounts.get(credentials.member.username).password,
      originalPassword,
    );
  });
});

test("unsafe mode, non-ignored path and wrong deployment fail before client creation", async () => {
  await fixture(async ({ path, options }) => {
    const server = mockServer();
    const dependencies = {
      clientFactory: server.clientFactory,
      emit: () => {},
    };
    await writeFile(path, "{}", { mode: 0o600 });
    await chmod(path, 0o644);
    await assert.rejects(
      prepareReviewAccounts(options, dependencies),
      /mode-0600/,
    );
    await assert.rejects(
      prepareReviewAccounts(
        { ...options, credentialsFile: resolve(root, "review-public.json") },
        dependencies,
      ),
      /immediate tmp/,
    );
    await assert.rejects(
      prepareReviewAccounts(
        {
          ...options,
          deploymentUrl: "https://dependable-warbler-666.convex.cloud",
        },
        dependencies,
      ),
      /fixed reviewer target/,
    );
    assert.equal(server.clientCount(), 0);
    assert.throws(
      () =>
        parseReviewOptions([
          "--deployment-url",
          "https://dependable-warbler-666.convex.cloud",
          "--credentials-file",
          path,
        ]),
      /same exact HTTPS/,
    );
    assert.throws(
      () =>
        parseReviewOptions([
          "--deployment-url",
          REVIEW_DEPLOYMENT_URL,
          "--credentials-file",
          path,
          "--initialize-accounts",
        ]),
      /both --execute/,
    );
  });
});

test("unexpected authenticated failures redact raw errors and invalidate temporary session", async () => {
  await fixture(async ({ options, output }) => {
    const server = mockServer({ queryFailure: true });
    await assert.rejects(
      prepareReviewAccounts(options, {
        clientFactory: server.clientFactory,
        emit: (value) => output.push(value),
      }),
      (error) => {
        assert.match(error.message, /No raw server error/);
        assert.ok(!error.message.includes(accessToken));
        assert.ok(!error.message.includes(refreshToken));
        return true;
      },
    );
    assert.equal(server.calls.at(-1).name, "auth:signOut");
    assert.deepEqual(output, []);
  });
});
