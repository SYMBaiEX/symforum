import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43242";
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/tip-context.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"tip-context-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/tip-context-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
  );
});
async function harness(page: Page, query = "", app = "platform") {
  const errors: string[] = [],
    network: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/community")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    network.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/community?section=support&${query}`);
  await expect(page.locator("main")).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
    expect(
      await page.evaluate(() => window.tipContextFixture.forbidden),
    ).toEqual([]);
  };
}
const filter = (page: Page) =>
  page.getByRole("textbox", { name: "Filter loaded contributor handles" });
const recipient = (page: Page) =>
  page.getByRole("combobox", { name: "Contributor", exact: true });
const authorAmount = (page: Page) =>
  page.getByRole("textbox", { name: "Optional author tip (SOL)" });
const ops = (page: Page) =>
  page.evaluate(() => window.tipContextFixture.operations);
test("author guest/unlinked/loading explanations preserve amount through identity changes with no preparation", async ({
  page,
}) => {
  const check = await harness(page, "author&guest");
  await authorAmount(page).fill("0.123");
  const review = page.getByRole("button", { name: "Review tip", exact: true });
  await expect(review).toBeDisabled();
  await expect(review).toHaveAccessibleDescription(/Sign in and link a wallet/);
  await expect(
    page.getByRole("link", { name: "Sign in to your community account" }),
  ).toHaveAttribute("href", /^\/signin\?redirectTo=/);
  await page.evaluate(() =>
    window.tipContextFixture.update({ authenticated: true, linked: false }),
  );
  await expect(review).toHaveAccessibleDescription(/Choose a wallet linked/);
  await expect(
    page.getByRole("link", { name: "Manage linked wallets" }),
  ).toHaveAttribute("href", "/account/connections");
  await page.evaluate(() =>
    window.tipContextFixture.update({ isLoading: true }),
  );
  await expect(review).toHaveAccessibleDescription(/Checking your sign-in/);
  await expect(
    page.getByRole("link", { name: "Manage linked wallets" }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.tipContextFixture.update({ isLoading: false, linked: true }),
  );
  await expect(review).toBeEnabled();
  await expect(authorAmount(page)).toHaveValue("0.123");
  expect(await ops(page)).toEqual([]);
  await check();
});
for (const mode of ["native", "optout"])
  test(`author ${mode} exposes no recipient context or financial controls`, async ({
    page,
  }) => {
    const check = await harness(page, `author&${mode}`);
    await expect(authorAmount(page)).toHaveCount(0);
    await expect(
      page.getByText("Public receiving wallet", { exact: true }),
    ).toHaveCount(0);
    expect(await ops(page)).toEqual([]);
    if (mode === "native")
      expect(await page.evaluate(() => window.tipContextFixture.reads)).toEqual(
        [],
      );
    await check();
  });
test("public author wallet/profile come only from opt-in projection", async ({
  page,
}) => {
  const check = await harness(page, "author");
  await expect(
    page.getByRole("link", { name: "@Same", exact: true }),
  ).toHaveAttribute("href", "/members/Same");
  await page.getByText("Public receiving wallet", { exact: true }).click();
  await expect(page.getByText("2".repeat(44), { exact: true })).toBeVisible();
  await expect(page.getByText("1".repeat(32), { exact: true })).toHaveCount(0);
  expect(await ops(page)).toEqual([]);
  await check();
});
test("filter searches loaded handles only and preserves exact selected ID, context and amount outside filter", async ({
  page,
}) => {
  const check = await harness(page, "admission");
  await recipient(page).selectOption("recipient-B");
  await page.getByRole("textbox", { name: "Tip amount (SOL)" }).fill("0.25");
  const before = await page.evaluate(() => window.tipContextFixture.reads);
  await filter(page).fill("  @夜猫  ");
  await expect(recipient(page)).toHaveValue("recipient-B");
  await expect(
    page.getByText(/Shown 1 of 3 loaded opt-in recipients/),
  ).toBeVisible();
  await page.getByText("Public receiving wallet", { exact: true }).click();
  await expect(page.getByText("3".repeat(44), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review one-time tip" }).click();
  expect(await ops(page)).toEqual([
    {
      name: "forumCommunity:preparePayment",
      args: {
        wallet: "1".repeat(32),
        recipientId: "recipient-B",
        amountLamports: "250000000",
      },
    },
  ]);
  await expect(
    page.getByRole("button", { name: "Review one-time tip" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.tipContextFixture.reads)).toEqual(
    before,
  );
  await page.evaluate(() => window.tipContextFixture.rejectPrepare());
  await expect(page.getByRole("alert")).toHaveText(
    "Invented preparation failure before any intent",
  );
  await expect(
    page.getByRole("textbox", { name: "Tip amount (SOL)" }),
  ).toHaveValue("0.25");
  await check();
});
test("duplicate handles retain separate IDs/wallets and filtering never auto-selects a match", async ({
  page,
}) => {
  const check = await harness(page);
  await filter(page).fill(" @sAmE ");
  await expect(recipient(page)).toHaveValue("");
  await expect(recipient(page).getByRole("option")).toHaveCount(3);
  await recipient(page).selectOption("recipient-A");
  await page.getByText("Public receiving wallet", { exact: true }).click();
  await expect(page.getByText("2".repeat(44), { exact: true })).toBeVisible();
  await recipient(page).selectOption("recipient-B");
  await expect(page.getByText("3".repeat(44), { exact: true })).toBeVisible();
  await expect(page.getByText("2".repeat(44), { exact: true })).toHaveCount(0);
  await filter(page).fill("no such handle");
  await expect(page.getByText(/No loaded handles match/)).toBeVisible();
  await expect(recipient(page)).toHaveValue("recipient-B");
  await page.getByRole("button", { name: "Clear handle filter" }).click();
  await expect(filter(page)).toHaveValue("");
  await expect(recipient(page)).toHaveValue("recipient-B");
  expect(await ops(page)).toEqual([]);
  await check();
});
test("query changes remove stale receiving context without claiming opt-out or changing selected ID", async ({
  page,
}) => {
  const check = await harness(page);
  await recipient(page).selectOption("recipient-B");
  await page.getByText("Public receiving wallet", { exact: true }).click();
  await page.evaluate(() =>
    window.tipContextFixture.update({
      recipients: [window.tipContextFixture.initialRecipients[0]],
    }),
  );
  await expect(recipient(page)).toHaveValue("recipient-B");
  await expect(
    page.getByText(
      /Current public profile and receiving-wallet context are unavailable/,
    ),
  ).toBeVisible();
  await expect(page.getByText("3".repeat(44), { exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    window.tipContextFixture.update({ recipients: [] }),
  );
  await expect(
    page.getByRole("heading", { name: "No contributors accept tips yet" }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.tipContextFixture.update({
      recipients: window.tipContextFixture.initialRecipients,
    }),
  );
  await expect(recipient(page)).toHaveValue("recipient-B");
  expect(await ops(page)).toEqual([]);
  await check();
});
test("recipient loading/empty and logout retain original private query skips", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.tipContextFixture.update({ recipients: undefined }),
  );
  await expect(
    page.getByText("Loading contributors who accept tips…", { exact: true }),
  ).toBeVisible();
  const before = await page.evaluate(() =>
    window.tipContextFixture.reads.filter(
      (read) => read.name === "forumCommunity:getMine",
    ),
  );
  await page.evaluate(() =>
    window.tipContextFixture.update({
      authenticated: false,
      linked: false,
      recipients: [],
    }),
  );
  expect(
    await page.evaluate(() =>
      window.tipContextFixture.reads.filter(
        (read) => read.name === "forumCommunity:getMine",
      ),
    ),
  ).toEqual(before);
  expect(await ops(page)).toEqual([]);
  await check();
});
test("author preparation stays busy, exact and failure-safe with typed amount retained", async ({
  page,
}) => {
  const check = await harness(page, "author&admission");
  await authorAmount(page).fill(".5");
  await page.getByRole("button", { name: "Review tip", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review tip", exact: true }),
  ).toBeDisabled();
  expect(await ops(page)).toEqual([
    {
      name: "forumCommunity:preparePayment",
      args: {
        wallet: "1".repeat(32),
        recipientId: "recipient-A",
        threadId: "public-thread",
        amountLamports: "500000000",
      },
    },
  ]);
  await page.evaluate(() => window.tipContextFixture.rejectPrepare());
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(authorAmount(page)).toHaveValue(".5");
  await check();
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px selected Unicode handle and full public wallet fit with 44px keyboard controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await harness(page, "compact", app);
      await recipient(page).selectOption("recipient-C");
      await filter(page).fill("夜猫");
      await filter(page).focus();
      await page.keyboard.press("Tab");
      const clear = page.getByRole("button", { name: "Clear handle filter" });
      await expect(clear).toBeFocused();
      expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const link = page.getByRole("link", { name: /^@夜猫/ });
      await expect(link).toHaveAttribute(
        "href",
        /^\/members\/%E5%A4%9C%E7%8C%AB%2Flong%3F/,
      );
      const summary = page.getByText("Public receiving wallet", {
        exact: true,
      });
      await summary.focus();
      await page.keyboard.press("Enter");
      const wallet = page.getByText("4".repeat(44), { exact: true });
      await expect(wallet).toBeVisible();
      const tipForm = page.locator("form").filter({ has: filter(page) });
      for (const node of [
        tipForm,
        link,
        summary,
        wallet,
        filter(page),
        recipient(page),
      ]) {
        const box = await node.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      for (const node of [link, summary, filter(page), recipient(page)])
        expect((await node.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await wallet.evaluate((node) =>
          parseFloat(getComputedStyle(node).fontSize),
        ),
      ).toBeGreaterThanOrEqual(14);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(await ops(page)).toEqual([]);
      await check();
    });
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px author linking guidance and disabled review fit without losing amount`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await harness(page, "author&unlinked", app);
      await authorAmount(page).fill("0.75");
      const link = page.getByRole("link", { name: "Manage linked wallets" });
      await link.focus();
      await expect(link).toBeFocused();
      const review = page.getByRole("button", {
        name: "Review tip",
        exact: true,
      });
      await expect(review).toBeDisabled();
      await expect(review).toHaveAccessibleDescription(
        /Choose a wallet linked to your account/,
      );
      const authorForm = page
        .locator("form")
        .filter({ has: authorAmount(page) });
      for (const node of [authorForm, authorAmount(page), review, link]) {
        const box = await node.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await expect(authorAmount(page)).toHaveValue("0.75");
      expect(await ops(page)).toEqual([]);
      await check();
    });
