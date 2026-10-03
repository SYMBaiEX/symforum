// @vitest-environment node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "vitest";
import { fileURLToPath } from "node:url";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { REVIEW_DEPLOYMENT_URL } from "./prepare-forum-review-accounts.mjs";
import {
  prepareReviewContent as prepareReviewContentImplementation,
  REVIEW_CONTENT_FIXTURES,
} from "./prepare-forum-review-content.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prepareReviewContent = (options, dependencies = {}) =>
  prepareReviewContentImplementation(options, {
    sleep: async () => {},
    ...dependencies,
  });
async function fixture(run) {
  await mkdir(resolve(root, "tmp"), { recursive: true });
  const stem = `content-test-${randomBytes(8).toString("hex")}`;
  const credentialPath = resolve(root, "tmp", `${stem}-credentials.json`);
  const receiptPath = resolve(root, "tmp", `${stem}-receipt.json`);
  const credentials = Object.fromEntries(
    Object.entries({
      member: "member",
      scopedStaff: "staff",
      recipient: "recipient",
    }).map(([key, prefix]) => [
      key,
      {
        username: `review-${prefix}-${randomBytes(6).toString("hex")}`,
        password: randomBytes(32).toString("base64url"),
      },
    ]),
  );
  await writeFile(credentialPath, JSON.stringify(credentials), { mode: 0o600 });
  try {
    await run({
      credentials,
      receiptPath,
      options: {
        deploymentUrl: REVIEW_DEPLOYMENT_URL,
        credentialsFile: credentialPath,
        receiptFile: receiptPath,
        execute: true,
      },
    });
  } finally {
    for (const path of [credentialPath, receiptPath, receiptPath + ".lock"])
      await rm(path, { force: true });
  }
}
function server(
  credentials,
  {
    lostWrite = false,
    mismatched = false,
    restrictedVisible = false,
    pendingWrites = false,
    mutationError,
  } = {},
) {
  const threads = [];
  const calls = [];
  let writes = 0;
  const clientFactory = () => {
    let actor,
      authenticated = false;
    return {
      async action(reference, args) {
        const name = getFunctionName(reference);
        calls.push(name);
        if (name === "auth:signOut") return null;
        assert.equal(name, "auth:signIn");
        assert.equal(args.params.flow, "signIn");
        actor = Object.keys(credentials).find(
          (key) => credentials[key].username === args.params.username,
        );
        assert.equal(args.params.password, credentials[actor].password);
        return {
          tokens: { token: "SECRET_ACCESS", refreshToken: "SECRET_REFRESH" },
        };
      },
      setAuth() {
        authenticated = true;
      },
      clearAuth() {
        authenticated = false;
      },
      async query(reference, args) {
        assert.equal(authenticated, true);
        const name = getFunctionName(reference);
        calls.push(name);
        if (name === "users:maybeViewer")
          return {
            _id: `user${actor}`,
            username: credentials[actor].username,
            role: "reader",
            emailVerified: actor === "member",
          };
        if (name === "forum:listCategories")
          return [
            { slug: "plugin-review" },
            ...(restrictedVisible ? [{ slug: "plugin-review-staff" }] : []),
          ];
        if (name === "forum:listThreads") {
          if (args.categorySlug === "plugin-review-staff") {
            const error = new Error("SECRET_SERVER_ERROR");
            error.data = { code: "CATEGORY_NOT_FOUND" };
            throw error;
          }
          return {
            threads: threads.filter((thread) => thread.status === "active"),
            pagination: { hasNextPage: false, limited: false },
          };
        }
        if (name === "forum:getThread") {
          const thread = threads.find((item) => item.slug === args.threadSlug);
          const fixture = REVIEW_CONTENT_FIXTURES.find(
            (item) => item.title === thread.title,
          );
          return {
            thread: {
              ...thread,
              body: mismatched ? "different content" : fixture.body,
            },
            ...(fixture.poll
              ? {
                  poll: {
                    question: fixture.poll.question,
                    options: fixture.poll.options.map((label) => ({ label })),
                  },
                }
              : {}),
          };
        }
        assert.fail("Unexpected query");
      },
      async mutation(reference, args) {
        assert.equal(getFunctionName(reference), "forum:createThread");
        writes++;
        if (mutationError) throw mutationError;
        if (lostWrite) throw new Error("SECRET_ACCESS SECRET_SERVER_ERROR");
        const thread = {
          _id: `thread${writes}`,
          slug: `sample-${writes}`,
          title: args.title,
          author: credentials[actor].username,
          status: pendingWrites ? "pending" : "active",
        };
        threads.push(thread);
        return {
          threadId: thread._id,
          threadSlug: thread.slug,
          status: thread.status,
        };
      },
    };
  };
  return { clientFactory, threads, calls, writes: () => writes };
}
test("concurrent starts lock before reading snapshots and later retries reuse hidden pending receipts", async () => {
  await fixture(async ({ credentials, receiptPath, options }) => {
    const mock = server(credentials, { pendingWrites: true });
    let release, signalEntered;
    const gate = new Promise((resolveGate) => {
      release = resolveGate;
    });
    const entered = new Promise((resolveEntered) => {
      signalEntered = resolveEntered;
    });
    let firstCall = true;
    const gatedFactory = () => {
      const client = mock.clientFactory();
      const action = client.action.bind(client);
      client.action = async (...args) => {
        if (firstCall) {
          firstCall = false;
          signalEntered();
          await gate;
        }
        return action(...args);
      };
      return client;
    };
    const running = prepareReviewContent(options, {
      clientFactory: gatedFactory,
      emit: () => {},
    });
    try {
      await entered;
      // A second process must reject the held lock before parsing any receipt
      // snapshot. The deliberately incomplete snapshot makes pre-lock reading
      // observable; the prior implementation threw SyntaxError here instead.
      await writeFile(receiptPath, "{incomplete concurrent snapshot", {
        mode: 0o600,
      });
      await assert.rejects(
        prepareReviewContent(options, {
          clientFactory: () =>
            assert.fail("locked process cannot authenticate"),
          emit: () => {},
        }),
        /Receipt is locked/,
      );
    } finally {
      release();
      await running;
    }
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(
      Object.values(receipt.fixtures).filter(
        (item) => item.status === "pending",
      ).length,
      3,
    );
    await prepareReviewContent(options, {
      clientFactory: mock.clientFactory,
      emit: () => {},
    });
    assert.equal(mock.writes(), 3);
  });
});
test("fixtures initialize, persist only public receipt data, and reuse without duplicate writes", async () => {
  await fixture(async ({ credentials, receiptPath, options }) => {
    const mock = server(credentials),
      output = [];
    const deps = {
      clientFactory: mock.clientFactory,
      emit: (value) => output.push(value),
    };
    await prepareReviewContent(options, deps);
    await prepareReviewContent(options, deps);
    assert.equal(mock.writes(), 3);
    assert.equal(mock.threads.length, 3);
    assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
    const raw = await readFile(receiptPath, "utf8"),
      receipt = JSON.parse(raw);
    assert.equal(receipt.restrictedRead, "denied");
    assert.equal(receipt.accounts.member.emailVerified, true);
    assert.equal(receipt.accounts.scopedStaff.emailVerified, false);
    assert.equal(
      receipt.accounts.member.agentCreation,
      "skipped_connection_consent_required",
    );
    for (const entry of Object.values(credentials))
      assert.ok(!(raw + JSON.stringify(output)).includes(entry.password));
    assert.ok(!raw.includes("SECRET_"));
    assert.ok(
      !mock.calls.some(
        (name) => name.includes("Connection") || name.includes("Agent"),
      ),
    );
  });
});
test("consecutive successful writes by one actor wait beyond the forum posting interval", async () => {
  await fixture(async ({ credentials, options }) => {
    const mock = server(credentials),
      delays = [];
    const dependencies = {
      clientFactory: mock.clientFactory,
      emit: () => {},
      sleep: async (duration) => {
        delays.push({ duration, writes: mock.writes() });
      },
    };
    await prepareReviewContent(options, dependencies);
    assert.deepEqual(delays, [{ duration: 15500, writes: 1 }]);
    await prepareReviewContent(options, dependencies);
    assert.equal(delays.length, 1);
    assert.equal(mock.writes(), 3);
  });
});
test("only an exact structured Convex posting-interval rejection clears the attempted receipt", async () => {
  const opaque = new Error("THREAD_RATE_LIMITED");
  opaque.data = { code: "THREAD_RATE_LIMITED" };
  for (const [error, clear] of [
    [
      new ConvexError({
        code: "THREAD_RATE_LIMITED",
        message: "SECRET_SERVER_ERROR",
      }),
      true,
    ],
    [
      new ConvexError({ code: "OTHER_ERROR", message: "SECRET_SERVER_ERROR" }),
      false,
    ],
    [opaque, false],
  ])
    await fixture(async ({ credentials, receiptPath, options }) => {
      const mock = server(credentials, { mutationError: error });
      await assert.rejects(
        prepareReviewContent(options, {
          clientFactory: mock.clientFactory,
          emit: () => {},
        }),
        (caught) => {
          assert.ok(!caught.message.includes("SECRET_"));
          assert.equal(caught.message.includes("cleared safely"), clear);
          return true;
        },
      );
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      if (clear) assert.equal(receipt.fixtures.welcome, undefined);
      else assert.equal(receipt.fixtures.welcome.state, "in_flight");
    });
});
test("lost write response is redacted and in-flight receipt blocks automatic retry", async () => {
  await fixture(async ({ credentials, receiptPath, options }) => {
    const mock = server(credentials, { lostWrite: true });
    await assert.rejects(
      prepareReviewContent(options, {
        clientFactory: mock.clientFactory,
        emit: () => {},
      }),
      (error) => {
        assert.ok(!error.message.includes("SECRET_"));
        return true;
      },
    );
    assert.equal(
      JSON.parse(await readFile(receiptPath, "utf8")).fixtures.welcome.state,
      "in_flight",
    );
    await assert.rejects(
      prepareReviewContent(options, {
        clientFactory: mock.clientFactory,
        emit: () => {},
      }),
      /Do not retry blindly/,
    );
    assert.equal(mock.writes(), 1);
  });
});
test("same-title content mismatch fails without replacement or additional writes", async () => {
  await fixture(async ({ credentials, options }) => {
    const mock = server(credentials, { mismatched: true });
    await prepareReviewContent(options, {
      clientFactory: mock.clientFactory,
      emit: () => {},
    });
    await assert.rejects(
      prepareReviewContent(options, {
        clientFactory: mock.clientFactory,
        emit: () => {},
      }),
      /different ownership or content/,
    );
    assert.equal(mock.writes(), 3);
  });
});
test("restricted visibility and wrong target reject before any fixture write", async () => {
  await fixture(async ({ credentials, options }) => {
    const mock = server(credentials, { restrictedVisible: true });
    await assert.rejects(
      prepareReviewContent(options, {
        clientFactory: mock.clientFactory,
        emit: () => {},
      }),
      /restricted staff board/,
    );
    assert.equal(mock.writes(), 0);
    await assert.rejects(
      prepareReviewContent(
        { ...options, deploymentUrl: "https://wrong.convex.cloud" },
        { clientFactory: () => assert.fail("must not create client") },
      ),
      /Wrong production/,
    );
  });
});
