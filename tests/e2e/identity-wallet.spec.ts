import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let bundle: string;
let stylesheet: string;
test.beforeAll(() => {
  stylesheet =
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
      "bun",
      [
        "-e",
        `
      import postcss from "postcss";
      import tailwind from "tailwindcss";
      import config from "./tailwind.config.ts";
      const css = (await Bun.file("apps/platform/app/globals.css").text()).replace(/^@import.*$/m, "");
      process.stdout.write((await postcss([tailwind(config)]).process(css, {from: undefined})).css);
    `,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  bundle = execFileSync(
    "bun",
    [
      "-e",
      `
    const result = await Bun.build({
      entrypoints: ["tests/e2e/fixtures/identity-wallet.tsx"],
      target: "browser", format: "iife", minify: true,
      define: {"process.env": JSON.stringify({NODE_ENV: "production"})},
      plugins: [{name: "isolated-convex", setup(build) {
        build.onResolve({filter: /^convex\\/react$/}, () => ({path: process.cwd()+"/tests/e2e/fixtures/identity-convex.ts"}));
        build.onResolve({filter: /^next\\/navigation$/}, () => ({path: process.cwd()+"/tests/e2e/fixtures/identity-navigation.ts"}));
      }}],
    });
    if (!result.success) throw new Error(result.logs.join("\\n"));
    process.stdout.write(await result.outputs[0].text());
  `,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});

async function harness(
  page: Page,
  options: {
    expired?: boolean;
    fail?: boolean;
    deferred?: boolean;
    proofFail?: boolean;
    sessionFail?: boolean;
    focusDeferred?: boolean;
    initialDeferred?: boolean;
  } = {},
) {
  page.on("pageerror", (error) => {
    throw error;
  });
  const requests: string[] = [];
  let signedIn = false;
  let sessions = 0;
  let release: (() => void) | undefined;
  let releaseSession: (() => void) | undefined;
  const gate = options.deferred
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  const sessionGate =
    options.focusDeferred || options.initialDeferred
      ? new Promise<void>((resolve) => {
          releaseSession = resolve;
        })
      : Promise.resolve();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43192" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${stylesheet}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    requests.push(url.pathname);
    if (url.pathname === "/api/identity/get-session") {
      sessions++;
      if (options.initialDeferred || (options.focusDeferred && sessions === 2))
        await sessionGate;
      const now = new Date().toISOString();
      return route.fulfill({
        json:
          signedIn && !options.sessionFail
            ? {
                session: {
                  id: "fixture-session",
                  userId: "fixture-user",
                  token: "fixture-only",
                  createdAt: now,
                  updatedAt: now,
                  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
                },
                user: {
                  id: "fixture-user",
                  name: "Fixture",
                  email: "fixture@example.test",
                  emailVerified: false,
                  createdAt: now,
                  updatedAt: now,
                },
              }
            : null,
      });
    }
    if (url.pathname === "/api/identity/identity/challenge") {
      await gate;
      if (options.fail)
        return route.fulfill({ status: 503, body: "unavailable" });
      const now = Date.now();
      const nonce = `fixtureNonce12345678${requests.length}`;
      return route.fulfill({
        json: {
          nonce,
          expiresAt: now + 300_000,
          clientId: "12345",
          input: {
            domain: url.host,
            uri: url.origin + "/auth/wallet",
            nonce,
            chainId: "solana:mainnet",
            version: "1",
            statement: "Sign in. No transaction.",
            issuedAt: new Date(now).toISOString(),
            expirationTime: new Date(
              now + (options.expired ? -1 : 300_000),
            ).toISOString(),
          },
        },
      });
    }
    if (url.pathname === "/api/identity/sign-in/solana") {
      if (options.proofFail)
        return route.fulfill({ status: 503, body: "unavailable" });
      signedIn = true;
      return route.fulfill({ json: { authenticated: true } });
    }
    if (url.origin === "https://oauth.telegram.org")
      return route.fulfill({
        contentType: "text/javascript",
        body: "window.Telegram = { Login: { auth() {} } };",
      });
    return route.abort(); // Every request intercepted; no real provider/production traffic.
  });
  return {
    requests,
    release: () => release?.(),
    releaseSession: () => releaseSession?.(),
  };
}
async function open(page: Page, query = "") {
  await page.goto("http://127.0.0.1:43192/" + query);
  await expect(page.getByLabel("Session state")).toHaveText("guest");
  await page.getByRole("button", { name: "Solana wallet" }).click();
}
async function choose(page: Page) {
  await page.getByRole("button", { name: /Phantom Installed/ }).click();
}
function signButton(page: Page) {
  return page.getByRole("button", {
    name: "Sign in with Phantom",
    exact: true,
  });
}
async function events(page: Page) {
  return JSON.parse(
    (await page.getByLabel("Wallet events").textContent()) ?? "[]",
  ) as { action: string; userActivated: boolean; account?: string }[];
}
const count = (requests: string[], suffix: string) =>
  requests.filter((path) => path.endsWith(suffix)).length;

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1280]) {
    test(`current wallet surface fits ${theme} at ${width}px without changing auth`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const run = await harness(page);
      await page.goto("http://127.0.0.1:43192/");
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        theme === "dark",
      );
      await page
        .getByRole("button", { name: "Solana wallet", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("data-surface", "forum");
      await expect(dialog).toHaveCSS("border-top-left-radius", "16px");
      await expect(dialog).toHaveCSS(
        "background-color",
        theme === "dark" ? "rgb(22, 22, 24)" : "rgb(255, 255, 255)",
      );
      const wallet = page.getByRole("button", { name: /Phantom Installed/ });
      await expect(wallet).toBeFocused();
      expect((await wallet.boundingBox())!.height).toBeGreaterThanOrEqual(60);
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(15);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 15);
      expect(bounds.y).toBeGreaterThanOrEqual(15);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(785);
      await expect(
        dialog.getByText(
          "Message signature only. No transaction or spending approval.",
        ),
      ).toBeVisible();
      await page.screenshot({
        path: `tmp/wallet-picker-${theme}-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Solana wallet", exact: true }),
      ).toBeFocused();
      expect(await events(page)).toEqual([]);
      expect(count(run.requests, "/identity/challenge")).toBe(0);
    });
  }
}

test("opt-in diagnostics locate an internal connect failure without auth requests or automatic retries", async ({
  page,
}) => {
  const run = await harness(page);
  await open(page, "?connectinternal&walletDebug=1");
  await choose(page);
  await expect(page.getByRole("alert")).toContainText(
    "internal connection error",
  );
  const diagnostics = JSON.parse(
    (await page.getByLabel("Wallet diagnostics").textContent()) ?? "[]",
  );
  expect(diagnostics.map((event: { stage: string }) => event.stage)).toEqual([
    "selected",
    "connect_requested",
    "failed",
  ]);
  expect(diagnostics.at(-1)).toMatchObject({
    wallet: "Phantom",
    phase: "connect",
    errorCode: -32603,
    secureContext: true,
    topLevel: true,
    userActivated: true,
  });
  expect((await events(page)).map((event) => event.action)).toEqual([
    "connect",
  ]);
  expect(count(run.requests, "/identity/challenge")).toBe(0);
  expect(count(run.requests, "/sign-in/solana")).toBe(0);
});

test("successful opt-in diagnostics report stages without proof or account data", async ({
  page,
}) => {
  await harness(page);
  await open(page, "?walletDebug=1");
  await choose(page);
  await signButton(page).click();
  await expect(page.getByText("Signed in successfully")).toBeVisible();
  const text =
    (await page.getByLabel("Wallet diagnostics").textContent()) ?? "[]";
  const diagnostics = JSON.parse(text);
  expect(diagnostics.map((event: { stage: string }) => event.stage)).toEqual([
    "selected",
    "connect_requested",
    "connect_succeeded",
    "challenge_requested",
    "challenge_ready",
    "signature_requested",
    "signature_succeeded",
    "proof_requested",
    "proof_verified",
    "session_confirmed",
  ]);
  expect(text).not.toContain("11111111111111111111111111111111");
  expect(text).not.toContain("fixtureNonce");
  expect(text).not.toContain("fixture-session");
});

test("expired diagnostic challenge never reports a signature request that was not sent", async ({
  page,
}) => {
  const run = await harness(page, { expired: true });
  await open(page, "?walletDebug=1");
  await choose(page);
  await signButton(page).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const diagnostics = JSON.parse(
    (await page.getByLabel("Wallet diagnostics").textContent()) ?? "[]",
  );
  expect(
    diagnostics.some(
      (entry: { stage: string }) => entry.stage === "signature_requested",
    ),
  ).toBe(false);
  expect(diagnostics.at(-1)).toMatchObject({ stage: "failed", phase: "sign" });
  expect(count(run.requests, "/sign-in/solana")).toBe(0);
  expect((await events(page)).map((event) => event.action)).toEqual([
    "connect",
  ]);
});

test("connects first, prepares a fresh challenge, signs explicitly and updates the real subscribed session", async ({
  page,
}) => {
  const run = await harness(page, { deferred: true });
  await open(page, "?internal"); // Combined Phantom signIn is deliberately broken.
  expect(count(run.requests, "/identity/challenge")).toBe(0);
  await choose(page);
  await expect(page.getByText("Preparing secure sign-in…")).toBeVisible();
  expect((await events(page)).map((event) => event.action)).toEqual([
    "connect",
  ]);
  run.release();
  await signButton(page).click({ clickCount: 2 });
  await expect(page.getByText("Signed in successfully")).toBeVisible();
  await expect(page.getByLabel("Session state")).toHaveText("authenticated");
  await expect(page.getByRole("dialog")).toBeHidden();
  const calls = await events(page);
  expect(calls.map((event) => event.action)).toEqual([
    "connect",
    "signMessage",
  ]);
  expect(calls.every((event) => event.userActivated)).toBe(true);
  expect(count(run.requests, "/sign-in/solana")).toBe(1);
  expect(count(run.requests, "/identity/challenge")).toBe(1);
  expect(run.requests).not.toContain("/js/telegram-login.js");
});

test("popup focus refresh does not unmount the active wallet flow", async ({
  page,
}) => {
  const run = await harness(page, { focusDeferred: true });
  await open(page, "?deferconnect&internal");
  await choose(page);
  await expect(page.getByRole("status")).toContainText("Connect your account");
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByLabel("Session state")).toHaveText("pending");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Connect your account");
  run.releaseSession();
  await expect(page.getByLabel("Session state")).toHaveText("guest");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("wallet-fixture:connect")),
  );
  await signButton(page).click();
  await expect(page.getByText("Signed in successfully")).toBeVisible();
  await expect(page.getByLabel("Session state")).toHaveText("authenticated");
  expect((await events(page)).map((event) => event.action)).toEqual([
    "connect",
    "signMessage",
  ]);
  expect(count(run.requests, "/sign-in/solana")).toBe(1);
});

test("protected pages remain blocked during actual session loading", async ({
  page,
}) => {
  const run = await harness(page, { initialDeferred: true });
  await page.goto("http://127.0.0.1:43192/?protected");
  await expect(page.getByLabel("Session state")).toHaveText("pending");
  await expect(
    page.getByText("Verifying your account…", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Solana wallet" })).toHaveCount(
    0,
  );
  run.releaseSession();
  await expect(page.getByLabel("Session state")).toHaveText("guest");
});

test("connection cancellation never prepares, signs, or automatically retries", async ({
  page,
}) => {
  const run = await harness(page);
  await open(page, "?connectcancel");
  await choose(page);
  await expect(page.getByRole("alert")).toContainText("cancelled");
  expect(count(run.requests, "/identity/challenge")).toBe(0);
  expect(count(run.requests, "/sign-in/solana")).toBe(0);
  expect((await events(page)).map((event) => event.action)).toEqual([
    "connect",
  ]);
});

test("expiry fails closed before requesting a signature", async ({ page }) => {
  const run = await harness(page, { expired: true });
  await open(page);
  await choose(page);
  await signButton(page).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await events(page)).map((event) => event.action)).toEqual([
    "connect",
  ]);
  expect(count(run.requests, "/sign-in/solana")).toBe(0);
});

test("discovers a late message-only wallet, supports Escape and restores focus", async ({
  page,
}) => {
  await harness(page);
  await open(page, "?empty&messageonly");
  await expect(page.getByText(/No compatible wallet found/)).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("wallet-fixture:register")),
  );
  await expect(
    page.getByRole("button", { name: /Phantom Installed/ }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Solana wallet" }),
  ).toBeFocused();
});

test("failed preparation allows explicit retry without signing", async ({
  page,
}) => {
  const run = await harness(page, { fail: true });
  await open(page);
  await choose(page);
  await expect(page.getByRole("alert")).toContainText("Could not prepare");
  await choose(page);
  await expect.poll(() => count(run.requests, "/identity/challenge")).toBe(2);
  expect((await events(page)).map((event) => event.action)).toEqual([
    "connect",
  ]);
  expect(count(run.requests, "/sign-in/solana")).toBe(0);
});

test("Telegram SDK loads only after Telegram is chosen", async ({ page }) => {
  const run = await harness(page);
  await page.goto("http://127.0.0.1:43192/");
  await expect(page.getByLabel("Session state")).toHaveText("guest");
  expect(run.requests).not.toContain("/js/telegram-login.js");
  await page.getByRole("button", { name: "Telegram", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Telegram" }),
  ).toBeEnabled();
  expect(count(run.requests, "/js/telegram-login.js")).toBe(1);
});

test("server verification failures are not mislabeled as wallet failures", async ({
  page,
}) => {
  await harness(page, { proofFail: true });
  await open(page);
  await choose(page);
  await signButton(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "server could not verify",
  );
  await expect(page.getByRole("alert")).not.toContainText("locked");
  await expect(page.getByLabel("Session state")).toHaveText("guest");
});

test("multiple connected accounts require explicit selection before preparing", async ({
  page,
}) => {
  const run = await harness(page);
  await open(page, "?multi");
  await choose(page);
  await expect(
    page.getByText("Choose the Solana account you want to sign in with."),
  ).toBeVisible();
  expect(count(run.requests, "/identity/challenge")).toBe(0);
  await expect(signButton(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Use 4vJ9JU…kLKi" }).click();
  await signButton(page).click();
  await expect(page.getByText("Signed in successfully")).toBeVisible();
  expect((await events(page)).at(-1)?.account).toBe(
    "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
  );
});

test("cancelled signature never posts or retries; a new selection gets a fresh challenge", async ({
  page,
}) => {
  const run = await harness(page);
  await open(page, "?messagecancel");
  await choose(page);
  await signButton(page).click();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  await expect(signButton(page)).toHaveCount(0);
  expect(count(run.requests, "/sign-in/solana")).toBe(0);
  expect((await events(page)).map((event) => event.action)).toEqual([
    "connect",
    "signMessage",
  ]);
  await choose(page);
  await expect(signButton(page)).toBeEnabled();
  expect(count(run.requests, "/identity/challenge")).toBe(2);
});

test("a missing session fails closed despite successful proof exchange", async ({
  page,
}) => {
  const run = await harness(page, { sessionFail: true });
  await open(page);
  await choose(page);
  await signButton(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "session could not be confirmed",
  );
  await expect(page.getByText("Signed in successfully")).toHaveCount(0);
  await expect(page.getByLabel("Session state")).toHaveText("guest");
  expect(count(run.requests, "/sign-in/solana")).toBe(1);
});

test("SIWS-only wallets prepare first and sign on a separate direct click", async ({
  page,
}) => {
  const run = await harness(page);
  await open(page, "?siwsonly");
  await choose(page);
  await expect(signButton(page)).toBeEnabled();
  expect(await events(page)).toEqual([]);
  await signButton(page).click();
  await expect(page.getByText("Signed in successfully")).toBeVisible();
  expect((await events(page)).map((event) => event.action)).toEqual(["signIn"]);
  expect((await events(page))[0].userActivated).toBe(true);
  expect(count(run.requests, "/sign-in/solana")).toBe(1);
});

test("an exposed account signs in without issuing a failing reconnect RPC", async ({
  page,
}) => {
  const run = await harness(page);
  await open(page, "?preconnected&connectinternal");
  await choose(page);
  await expect(signButton(page)).toBeEnabled();
  expect(await events(page)).toEqual([]);
  expect(count(run.requests, "/identity/challenge")).toBe(1);
  expect(count(run.requests, "/sign-in/solana")).toBe(0);
  await signButton(page).click();
  await expect(page.getByText("Signed in successfully")).toBeVisible();
  await expect(page.getByLabel("Session state")).toHaveText("authenticated");
  expect((await events(page)).map((event) => event.action)).toEqual([
    "signMessage",
  ]);
  expect(count(run.requests, "/sign-in/solana")).toBe(1);
});

for (const mode of ["accountchange", "changedmessage"])
  test(`SDK ${mode} fails closed before any server proof exchange`, async ({
    page,
  }) => {
    const run = await harness(page);
    await open(page, "?" + mode);
    await choose(page);
    await signButton(page).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(count(run.requests, "/sign-in/solana")).toBe(0);
    await expect(page.getByLabel("Session state")).toHaveText("guest");
  });

test("SDK rejects a wallet-provided address/public-key mismatch before challenge allocation", async ({
  page,
}) => {
  const run = await harness(page);
  await open(page, "?badkey");
  await choose(page);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(count(run.requests, "/identity/challenge")).toBe(0);
  expect(count(run.requests, "/sign-in/solana")).toBe(0);
  await expect(page.getByLabel("Session state")).toHaveText("guest");
});

test("SDK excludes wallets that do not support the intended mainnet chain", async ({
  page,
}) => {
  const run = await harness(page);
  await open(page, "?devnet");
  await expect(page.getByText(/No compatible wallet found/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Phantom Installed/ }),
  ).toHaveCount(0);
  expect(count(run.requests, "/identity/challenge")).toBe(0);
});
