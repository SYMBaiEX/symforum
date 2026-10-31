import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
let script: string;
let css: string;
const origin = "http://127.0.0.1:43224";
const audits = new WeakMap<Page, { errors: string[]; network: string[] }>();
test.beforeAll(() => {
  css =
    FORUM_SHARED_THEME_CSS + readFileSync("styles/forum-shared.css", "utf8");
  css += execFileSync(
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/wallet-readability.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"wallet-readability-mock",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/wallet-readability-state.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});
async function harness(page: Page, scenario = "normal") {
  const audit = { errors: [] as string[], network: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    audit.network.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?scenario=${scenario}`);
  await expect(
    page.getByRole("button", { name: "Refresh wallet balances" }),
  ).toBeEnabled();
}
test.afterEach(async ({ page }) => {
  const audit = audits.get(page);
  if (audit) {
    expect(audit.errors).toEqual([]);
    expect(audit.network).toEqual([]);
  }
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          __walletReadability: { calls: { name: string }[] };
        }
      ).__walletReadability.calls,
  );
  expect(calls.length).toBe(1);
  expect(calls[0].name).toBe("forumTerminal:getWalletReadState");
});

for (const scenario of [
  "normal",
  "zero",
  "missing-sol",
  "missing-selected",
  "malformed",
  "unsupported-decimals",
  "unverified-limit",
]) {
  test(`${scenario} balances remain distinct from verified spendable limits`, async ({
    page,
  }) => {
    await harness(page, scenario);
    const balances = page.getByRole("list", { name: "Wallet balances" });
    await expect(balances).toBeVisible();
    await page.getByText("Balance & spendable SOL", { exact: true }).click();
    await expect(
      page.getByText("Verified spendable estimate unavailable.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/The final route can require more rent or fees/),
    ).toBeVisible();
    if (scenario === "zero")
      await expect(balances.getByText("0", { exact: true })).toHaveCount(2);
    if (scenario === "malformed" || scenario === "unsupported-decimals")
      await expect(
        balances.getByText("Unavailable", { exact: true }),
      ).toHaveCount(2);
    if (scenario === "missing-sol")
      await expect(
        page.getByText(/SOL balance unavailable; no zero balance is assumed/),
      ).toBeVisible();
    if (scenario === "missing-selected")
      await expect(
        page.getByText(/selected token’s balance is unavailable/),
      ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^(Max|Prepare|Send|Swap)$/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });
}
test("only coherent returned estimate and reserve are described, without inventing a Max control", async ({
  page,
}) => {
  await harness(page, "verified-limit");
  await page.getByText("Balance & spendable SOL", { exact: true }).click();
  await expect(
    page.getByText(/Returned spendable estimate: 0.8 SOL/),
  ).toContainText("Returned verified reserve: 0.2 SOL.");
  await expect(
    page.getByText(/Displayed balances are not spendable limits/),
  ).toBeVisible();
});
for (const scenario of ["reject", "foreign-wallet"])
  test(`${scenario} never displays another balance or claims zero`, async ({
    page,
  }) => {
    await harness(page, scenario);
    await expect(
      page.getByRole("list", { name: "Wallet balances" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Balance & spendable SOL", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("status")).toBeVisible();
  });
for (const width of [320, 390])
  test(`${width}px wallet explanation is keyboard reachable with full amounts and no extra read`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    await harness(page, "large");
    const summary = page.getByText("Balance & spendable SOL", { exact: true });
    await page.getByRole("button", { name: "Refresh wallet balances" }).focus();
    await page.keyboard.press("Tab");
    const identitySummary = page.getByText("Full linked wallet address", { exact: true });
    await expect(identitySummary).toBeFocused();
    expect((await identitySummary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Tab");
    await expect(summary).toBeFocused();
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(
        /Preparation checks balances and route-specific costs again/,
      ),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "After wallet explanation" }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const amounts = page
      .getByRole("list", { name: "Wallet balances" })
      .getByText("18446744073.709551615", { exact: true });
    await expect(amounts).toHaveCount(1);
    expect(
      await amounts.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  });
