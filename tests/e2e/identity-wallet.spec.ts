import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

let bundle: string;
test.beforeAll(() => {
  bundle = execFileSync(
    "bun",
    [
      "-e",
      `
    const result = await Bun.build({
      entrypoints: ["tests/e2e/fixtures/identity-wallet.tsx"],
      target: "browser", format: "iife", minify: true,
      define: {"process.env": JSON.stringify({NODE_ENV: "production"})},
      plugins: [{name: "isolated-auth", setup(build) {
        build.onResolve({filter: /^@symbaiex\\/auth\\/identity-client$/}, () => ({path: process.cwd()+"/tests/e2e/fixtures/identity-client.ts"}));
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
  options: { expired?: boolean; fail?: boolean; deferred?: boolean } = {},
) {
  page.on("pageerror", (error) => {
    throw error;
  });
  const requests: string[] = [];
  let release: (() => void) | undefined;
  const gate = options.deferred
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43192" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div><script src="/fixture.js"></script>',
      });
    if (url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    requests.push(url.pathname);
    if (url.pathname === "/api/identity/identity/challenge") {
      await gate;
      if (options.fail)
        return route.fulfill({ status: 503, body: "unavailable" });
      const now = Date.now();
      return route.fulfill({
        json: {
          nonce: "fixtureNonce12345678",
          expiresAt: now + 300_000,
          clientId: "12345",
          input: {
            domain: url.host,
            uri: url.origin + "/auth/wallet",
            nonce: "fixtureNonce12345678",
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
    if (url.pathname === "/api/identity/sign-in/solana")
      return route.fulfill({ json: { authenticated: true } });
    if (url.origin === "https://oauth.telegram.org")
      return route.fulfill({
        contentType: "text/javascript",
        body: "window.Telegram = { Login: { auth() {} } };",
      });
    return route.abort(); // No external or production traffic, including identity writes.
  });
  return { requests, release: () => release?.() };
}

test("wallet modal prepares first, signs on the click, and submits only once", async ({
  page,
}) => {
  const run = await harness(page, { deferred: true });
  await page.goto("http://127.0.0.1:43192/");
  await page.getByRole("button", { name: "Solana wallet" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(dialog).toBeVisible();
  const phantom = dialog.getByRole("button", { name: /Phantom/ });
  await expect(phantom).toBeDisabled();
  await expect(page.getByLabel("Wallet events")).toHaveText("[]");
  run.release();
  await expect(phantom).toBeEnabled();
  await phantom.click({ clickCount: 2 });
  await expect(page.getByText("Signed in successfully")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(
    run.requests.filter((path) => path.endsWith("/sign-in/solana")),
  ).toHaveLength(1);
  const events = JSON.parse(
    (await page.getByLabel("Wallet events").textContent()) ?? "[]",
  );
  expect(events).toHaveLength(1);
  expect(events[0].userActivated).toBe(true);
  expect(run.requests).not.toContain("/js/telegram-login.js");
});

test("wallet cancellation never submits a proof or automatically retries", async ({
  page,
}) => {
  const run = await harness(page);
  await page.goto("http://127.0.0.1:43192/?cancel");
  await page.getByRole("button", { name: "Solana wallet" }).click();
  await page.getByRole("button", { name: /Phantom/ }).click();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  expect(
    run.requests.filter((path) => path.endsWith("/sign-in/solana")),
  ).toHaveLength(0);
  expect(
    run.requests.filter((path) => path.endsWith("/identity/challenge")),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Prepare new request" }).click();
  await expect(page.getByRole("button", { name: /Phantom/ })).toBeEnabled();
  expect(
    run.requests.filter((path) => path.endsWith("/identity/challenge")),
  ).toHaveLength(2);
});

test("expiry fails closed before the wallet is asked to sign", async ({
  page,
}) => {
  const run = await harness(page, { expired: true });
  await page.goto("http://127.0.0.1:43192/");
  await page.getByRole("button", { name: "Solana wallet" }).click();
  await page.getByRole("button", { name: /Phantom/ }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Wallet events")).toHaveText("[]");
  expect(
    run.requests.filter((path) => path.endsWith("/sign-in/solana")),
  ).toHaveLength(0);
});

test("discovers a late wallet, supports Escape, and restores trigger focus", async ({
  page,
}) => {
  await harness(page);
  await page.goto("http://127.0.0.1:43192/?empty");
  const trigger = page.getByRole("button", { name: "Solana wallet" });
  await trigger.click();
  await expect(page.getByText(/No compatible wallet found/)).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("wallet-fixture:register")),
  );
  await expect(page.getByRole("button", { name: /Phantom/ })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("a failed challenge leaves a usable retry and never opens a wallet", async ({
  page,
}) => {
  await harness(page, { fail: true });
  await page.goto("http://127.0.0.1:43192/");
  await page.getByRole("button", { name: "Solana wallet" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not prepare");
  await expect(
    page.getByRole("button", { name: "Prepare new request" }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: /Phantom/ })).toBeDisabled();
});

test("Telegram SDK loads only after Telegram is chosen", async ({ page }) => {
  const run = await harness(page);
  await page.goto("http://127.0.0.1:43192/");
  await expect(
    page.getByRole("button", { name: "Telegram", exact: true }),
  ).toBeEnabled();
  expect(run.requests).toEqual([]);
  await page.getByRole("button", { name: "Telegram", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Telegram" }),
  ).toBeEnabled();
  expect(
    run.requests.filter((path) => path === "/js/telegram-login.js"),
  ).toHaveLength(1);
});
