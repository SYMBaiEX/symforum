import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43240";
const walletA = "EULE1PmLm452j4sfNTn4HrzEWa957Zdf3tZCtmjoaTtF";
const walletB = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
let script: string;
const css: Record<string, string> = {};
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
    css[app] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/wallet-identity-receipts.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"wallet-identity-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/wallet-identity-receipts-state.tsx"}));build.onResolve({filter:/^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/identity-navigation.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
});
async function harness(page: Page, query = "", app = "platform") {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (
      url.origin === origin &&
      /^\/api\/token\/[^/]+\/chart$/.test(url.pathname)
    )
      return route.fulfill({
        status: 503,
        json: {
          state: "unavailable",
          cache: { nextRetryAt: Date.now() + 86400000 },
        },
      });
    if (
      url.origin === origin &&
      url.pathname === "/images/brand/symforum-icon-64.png"
    )
      return route.fulfill({
        contentType: "image/png",
        body: readFileSync("public/images/brand/symforum-icon-64.png"),
      });
    external.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?${query}`);
  await expect(page.locator("main")).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    expect(
      await page.evaluate(() => window.walletIdentityFixture.operations),
    ).toEqual([]);
  };
}
const summary = (page: Page) =>
  page.getByText("Full linked wallet address", { exact: true });
const copy = (page: Page) =>
  page.getByRole("button", { name: "Copy linked wallet address", exact: true });
const reads = (page: Page) =>
  page.evaluate(() => window.walletIdentityFixture.reads);
const copied = (page: Page) =>
  page.getByText("Linked wallet address copied.", { exact: true });
async function openWallet(page: Page) {
  const dock = page.getByRole("navigation", { name: "Terminal dock" });
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
test("explicit reveal/copy uses exact linked address, no additional reads or wallet calls", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(copy(page)).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Refresh wallet balances" }),
  ).toBeEnabled();
  const before = await reads(page);
  await summary(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(walletA, { exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(copy(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(copied(page)).toBeVisible();
  expect(
    await page.evaluate(() => window.walletIdentityFixture.copies),
  ).toEqual([walletA]);
  expect(await reads(page)).toEqual(before);
  await check();
});
test("clipboard denial is announced with selectable full address and no read retry", async ({
  page,
}) => {
  const check = await harness(page);
  await summary(page).click();
  const before = await reads(page);
  await page.evaluate(() => window.walletIdentityFixture.copyMode("failure"));
  await copy(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Select the full address above",
  );
  await expect(page.getByText(walletA, { exact: true })).toBeVisible();
  await expect(copy(page)).toHaveAccessibleDescription(walletA);
  expect(await reads(page)).toEqual(before);
  await check();
});
for (const backToA of [false, true])
  for (const fail of [false, true])
    test(`deferred clipboard ${fail ? "failure" : "success"} cannot survive wallet A→B${backToA ? "→A" : ""}`, async ({
      page,
    }) => {
      const check = await harness(page);
      await summary(page).click();
      await page.evaluate(() =>
        window.walletIdentityFixture.copyMode("deferred"),
      );
      await copy(page).click();
      await expect(copy(page)).toBeDisabled();
      await page.evaluate(
        (next) => window.walletIdentityFixture.switchWallet(next),
        walletB,
      );
      await expect(copy(page)).toBeHidden();
      if (backToA)
        await page.evaluate(
          (next) => window.walletIdentityFixture.switchWallet(next),
          walletA,
        );
      await summary(page).click();
      await page.evaluate(
        (failed) => window.walletIdentityFixture.settleCopy(0, failed),
        fail,
      );
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(copied(page)).toHaveCount(0);
      await expect(copy(page)).toBeEnabled();
      expect(
        await page.evaluate(() => window.walletIdentityFixture.copies),
      ).toEqual([walletA]);
      await check();
    });
test("same-tick duplicate copy is suppressed and explicit balance refresh remains separate", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(
    page.getByRole("button", { name: "Refresh wallet balances" }),
  ).toBeEnabled();
  await summary(page).click();
  await page.evaluate(() => window.walletIdentityFixture.copyMode("deferred"));
  await copy(page).evaluate((button) => {
    if (!(button instanceof HTMLButtonElement))
      throw new Error("Expected copy button");
    button.click();
    button.click();
  });
  await expect(copy(page)).toBeDisabled();
  expect(
    await page.evaluate(() => window.walletIdentityFixture.copies),
  ).toEqual([walletA]);
  expect(
    (await reads(page)).filter(
      (read) => read.name === "forumTerminal:getWalletReadState",
    ),
  ).toHaveLength(1);
  await page.evaluate(() => window.walletIdentityFixture.settleCopy(0));
  await expect(copy(page)).toBeEnabled();
  await page.getByRole("button", { name: "Refresh wallet balances" }).click();
  expect(
    (await reads(page)).filter(
      (read) => read.name === "forumTerminal:getWalletReadState",
    ),
  ).toHaveLength(2);
  await check();
});
test("unmount drops pending copy feedback without claiming clipboard cancellation", async ({
  page,
}) => {
  const check = await harness(page);
  await summary(page).click();
  await page.evaluate(() => window.walletIdentityFixture.copyMode("deferred"));
  await copy(page).click();
  await page.evaluate(() => {
    window.walletIdentityFixture.unmount();
    window.walletIdentityFixture.settleCopy(0);
  });
  await expect(page.locator("main")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.walletIdentityFixture.copies),
  ).toEqual([walletA]);
  await check();
});
test("receipt links have distinct exact-signature labels while protected/no-signature statuses remain honest", async ({
  page,
}) => {
  const check = await harness(page);
  const links = page.getByRole("link", {
    name: /swap from .* on Solscan, signature/,
  });
  await expect(links).toHaveCount(2);
  const signatures = await page.evaluate(() => [
    window.walletIdentityFixture.signatureA,
    window.walletIdentityFixture.signatureB,
  ]);
  for (const signature of signatures) {
    const link = page.getByRole("link", {
      name: new RegExp(`signature ${signature}$`),
    });
    await expect(link).toHaveAttribute(
      "href",
      `https://solscan.io/tx/${signature}`,
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(
    page.getByText("No signature recorded", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByText("Outcome protected", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(page.getByText("Not completed", { exact: true })).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(0);
  await check();
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px full address and receipt controls fit with readable type and 44px targets`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await harness(page, "", app);
      await summary(page).click();
      const address = page.getByText(walletA, { exact: true });
      await expect(address).toBeVisible();
      for (const node of [summary(page), copy(page), address]) {
        const box = await node.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      expect(
        await address.evaluate((node) =>
          parseFloat(getComputedStyle(node).fontSize),
        ),
      ).toBeGreaterThanOrEqual(14);
      for (const control of [
        summary(page),
        copy(page),
        ...(await page
          .getByRole("link", { name: /on Solscan, signature/ })
          .all()),
      ])
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
          44,
        );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await check();
    });
for (const mode of ["guest", "authloading", "native"])
  test(`actual terminal gates wallet reveal and receipts: ${mode}`, async ({
    page,
  }) => {
    const check = await harness(page, `integration&${mode}`);
    if (mode !== "native") await openWallet(page);
    await expect(summary(page)).toHaveCount(0);
    expect(
      (await reads(page)).filter((read) =>
        /getWalletReadState|listMine|listWatchlist|listAlerts/.test(read.name),
      ),
    ).toEqual([]);
    await expect(
      page.getByRole("link", { name: /on Solscan, signature/ }),
    ).toHaveCount(0);
    await check();
  });
test("actual terminal logout removes private wallet identity and receipts without action replay", async ({
  page,
}) => {
  const check = await harness(page, "integration");
  await openWallet(page);
  await summary(page).click();
  await expect(page.getByText(walletA, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /on Solscan, signature/,
      includeHidden: true,
    }),
  ).toHaveCount(2);
  await page.evaluate(() => window.walletIdentityFixture.logout());
  await expect(summary(page)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /on Solscan, signature/ }),
  ).toHaveCount(0);
  await check();
});
