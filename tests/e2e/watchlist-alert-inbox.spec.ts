import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  mintB = "EPjFWdd5aufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
let script: string, css: string;
test.beforeAll(() => {
  css =
    FORUM_SHARED_THEME_CSS +
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
      "bun",
      [
        "-e",
        `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/platform/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/watchlist-alert-inbox.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"inbox-isolation",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/watchlist-alert-inbox-state.ts"}));build.onResolve({filter:/commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/terminal-wallet.tsx"}));build.onResolve({filter:/^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/identity-navigation.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
});
async function harness(page: Page, query = "") {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43236" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43236" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (
      url.origin === "http://127.0.0.1:43236" &&
      /^\/api\/token\/[^/]+\/chart$/.test(url.pathname)
    )
      return route.fulfill({
        status: 503,
        json: {
          state: "unavailable",
          error: "Invented offline chart",
          cache: { nextRetryAt: Date.now() + 86400000 },
        },
      });
    if (
      url.origin === "http://127.0.0.1:43236" &&
      url.pathname === "/images/brand/symforum-icon-64.png"
    )
      return route.fulfill({
        contentType: "image/png",
        body: readFileSync("public/images/brand/symforum-icon-64.png"),
      });
    requests.push(url.href);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43236/?${query}`);
  await expect(page.locator("main")).toBeVisible();
  return () => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  };
}
const ops = (page: Page) =>
  page.evaluate(() => window.alertInboxFixture.operations);
const subscriptions = (page: Page) =>
  page.evaluate(() => window.alertInboxFixture.subscriptions);
const filters = (page: Page) =>
  page.getByRole("group", { name: "Unread alert direction", exact: true });
const unread = (page: Page) =>
  page.getByRole("list", {
    name: "Unread alerts from loaded sample",
    exact: true,
  });
const history = (page: Page) =>
  page.getByText(/^Read alerts in loaded sample \(/);
test("filters only loaded unread directions and bounded read history never fetches or acknowledges", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(unread(page).getByRole("listitem")).toHaveCount(2);
  const before = await subscriptions(page);
  await filters(page)
    .getByRole("button", { name: "Above", exact: true })
    .click();
  await expect(unread(page).getByRole("listitem")).toHaveCount(1);
  await expect(unread(page).locator("code")).toHaveAttribute("title", mintA);
  await filters(page)
    .getByRole("button", { name: "Below", exact: true })
    .click();
  await expect(unread(page).locator("code")).toHaveAttribute("title", mintB);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Loaded 4 recent alert records: 2 unread, 2 read/ }),
  ).toBeVisible();
  await history(page).click();
  const read = page.getByRole("list", {
    name: "Read alerts from loaded sample",
    exact: true,
  });
  await expect(read.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText(/not your complete alert history/)).toBeVisible();
  await expect(
    read.getByRole("button", { name: "Mark read", exact: true }),
  ).toHaveCount(0);
  expect(await subscriptions(page)).toEqual(before);
  expect(await ops(page)).toEqual([]);
  check();
});
test("direction no-match differs from no unread sample and preserves staged form DOM and fields", async ({
  page,
}) => {
  const check = await harness(page);
  const input = page.getByRole("textbox", {
    name: "Alert above, USD",
    exact: true,
  });
  await input.fill("12.123456789");
  const form = await page
    .getByRole("form", { name: "Watch thresholds" })
    .elementHandle();
  await page.evaluate(() => window.alertInboxFixture.load("above"));
  await filters(page)
    .getByRole("button", { name: "Below", exact: true })
    .click();
  await expect(
    page.getByText(/No loaded unread alerts match this direction/),
  ).toBeVisible();
  await expect(page.getByText(/^No unread alerts\./)).toHaveCount(0);
  await history(page).click();
  await history(page).click();
  await expect(input).toHaveValue("12.123456789");
  expect(await form!.evaluate((node) => node.isConnected)).toBe(true);
  await page.evaluate(() => window.alertInboxFixture.load("read-only"));
  await expect(page.getByText(/^No unread alerts\./)).toBeVisible();
  expect(await ops(page)).toEqual([]);
  check();
});
test("exact mint View remains independent from the explicit existing Mark read action", async ({
  page,
}) => {
  const check = await harness(page);
  await unread(page)
    .getByRole("button", {
      name: `View token for alert, mint ${mintB}`,
      exact: true,
    })
    .click();
  expect(await page.evaluate(() => window.alertInboxFixture.selected)).toEqual([
    { mint: mintB, symbol: "DUP", name: "Alerted Solana token" },
  ]);
  expect(await ops(page)).toEqual([]);
  await unread(page)
    .getByRole("button", { name: "Mark read", exact: true })
    .first()
    .click();
  await expect(unread(page).getByRole("listitem")).toHaveCount(1);
  expect(await ops(page)).toEqual([
    { name: "forumTerminal:acknowledgeAlert", args: { id: "unread-above" } },
  ]);
  await history(page).click();
  await expect(
    page
      .getByRole("list", {
        name: "Read alerts from loaded sample",
        exact: true,
      })
      .getByRole("listitem"),
  ).toHaveCount(3);
  await page
    .getByRole("list", { name: "Read alerts from loaded sample", exact: true })
    .getByRole("button", {
      name: `View token for read alert, mint ${mintA}`,
      exact: true,
    })
    .first()
    .click();
  expect(
    (await page.evaluate(() => window.alertInboxFixture.selected)).at(-1)?.mint,
  ).toBe(mintA);
  expect(await ops(page)).toEqual([
    { name: "forumTerminal:acknowledgeAlert", args: { id: "unread-above" } },
  ]);
  check();
});
for (const mode of ["loading-alerts", "empty-alerts"])
  test(`loading and empty samples stay honest: ${mode}`, async ({ page }) => {
    const check = await harness(page, mode);
    if (mode === "loading-alerts") {
      await expect(
        page.getByText("Loading alerts…", { exact: true }),
      ).toBeVisible();
      await expect(
        filters(page).getByRole("button", { name: "All", exact: true }),
      ).toBeDisabled();
      await expect(history(page)).toHaveCount(0);
      await page.evaluate(() => window.alertInboxFixture.load("mixed"));
      await expect(unread(page).getByRole("listitem")).toHaveCount(2);
    } else {
      await expect(page.getByText(/^No unread alerts\./)).toBeVisible();
      await history(page).click();
      await expect(
        page.getByText("No read alerts in the current loaded sample.", {
          exact: true,
        }),
      ).toBeVisible();
    }
    expect(await ops(page)).toEqual([]);
    check();
  });
for (const width of [320, 390])
  test(`direction controls and read disclosure keep 44px keyboard targets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const check = await harness(page);
    for (const control of [
      filters(page).getByRole("button", { name: "Above", exact: true }),
      history(page),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await control.focus();
      await expect(control).toBeFocused();
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Enter");
    }
    await expect(
      page.getByRole("list", {
        name: "Read alerts from loaded sample",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await ops(page)).toEqual([]);
    check();
  });
async function openWallet(page: Page) {
  const dock = page.getByRole("navigation", {
    name: "Terminal dock",
    exact: true,
  });
  const direct = dock.getByRole("button", {
    name: "Wallet & watches",
    exact: true,
  });
  if (await direct.isVisible()) await direct.click();
  else {
    await dock.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("button", { name: "Wallet & watches", exact: true })
      .first()
      .click();
  }
}
for (const state of ["guest", "authloading", "native"])
  test(`actual terminal private gate contains the new history: ${state}`, async ({
    page,
  }) => {
    const check = await harness(page, `integration&${state}`);
    if (state !== "native") await openWallet(page);
    await expect(history(page)).toHaveCount(0);
    await expect(unread(page)).toHaveCount(0);
    expect(
      (await subscriptions(page)).filter((key) =>
        /listAlerts|listWatchlist/.test(key),
      ),
    ).toEqual([]);
    if (state === "native") expect(await subscriptions(page)).toEqual([]);
    expect(await ops(page)).toEqual([]);
    check();
  });
test("actual terminal logout removes loaded private history without a new query", async ({
  page,
}) => {
  const check = await harness(page, "integration");
  await openWallet(page);
  await history(page).click();
  await expect(
    page.getByRole("list", {
      name: "Read alerts from loaded sample",
      exact: true,
    }),
  ).toBeVisible();
  const before = (await subscriptions(page)).filter((key) =>
    /listAlerts|listWatchlist/.test(key),
  );
  await page.evaluate(() => window.alertInboxFixture.logout());
  await expect(history(page)).toHaveCount(0);
  await expect(unread(page)).toHaveCount(0);
  expect(
    (await subscriptions(page)).filter((key) =>
      /listAlerts|listWatchlist/.test(key),
    ),
  ).toEqual(before);
  expect(await ops(page)).toEqual([]);
  check();
});
