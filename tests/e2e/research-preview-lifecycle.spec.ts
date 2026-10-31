import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
import { RESEARCH_INTENT_TTL } from "../../lib/forum-research";
const origin = "http://127.0.0.1:43241",
  mintA = "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
  mintB = "So11111111111111111111111111111111111111112";
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/research-preview-lifecycle.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"research-preview-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/research-preview-lifecycle-state.tsx"}));}}]});if(!result.success)throw new Error(JSON.stringify(result.logs));process.stdout.write(await result.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(page: Page, app = "platform", query = "") {
  const errors: string[] = [],
    requests: string[] = [];
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
    requests.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?${query}`);
  await expect(
    page.getByRole("heading", { name: "Token research export" }),
  ).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(() => window.researchPreviewFixture.forbidden),
    ).toEqual([]);
  };
}
const preview = (page: Page) =>
  page.getByText("Preview export format & methodology", { exact: true });
const review = (page: Page) =>
  page.getByRole("button", { name: "Review research export", exact: true });
const approve = (page: Page) =>
  page.getByRole("button", {
    name: "Approve $0.10 USDC purchase",
    exact: true,
  });
const calls = (page: Page) =>
  page.evaluate(() => window.researchPreviewFixture.actions);
test("preview is illustrative, source-shaped, locally keyboard accessible, and never requests payment", async ({
  page,
}) => {
  const check = await harness(page);
  const before = await page.evaluate(() => window.researchPreviewFixture.reads);
  await preview(page).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Illustrative schema only · not a generated report", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/Coverage is sampled, not an exhaustive ranking/),
  ).toBeVisible();
  const schema = page.getByLabel("Illustrative research export JSON schema");
  expect(Object.keys(JSON.parse(await schema.innerText()).properties)).toEqual([
    "product",
    "mint",
    "title",
    "generatedAt",
    "metricsAsOf",
    "facts",
    "analysis",
    "sources",
    "methodology",
  ]);
  await page.keyboard.press("Tab");
  await expect(schema).toBeFocused();
  await expect(page.getByRole("link", { name: /methodology/i })).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
  expect(
    await page.evaluate(() => window.researchPreviewFixture.reads),
  ).toEqual(before);
  await check();
});
for (const mode of ["loading", "setup", "exhausted"] as const)
  test(`${mode} readiness remains closed with preview available`, async ({
    page,
  }) => {
    const check = await harness(page);
    await page.evaluate(
      (value) => window.researchPreviewFixture.update({ mode: value }),
      mode,
    );
    await expect(review(page)).toBeDisabled();
    await preview(page).click();
    await expect(
      page.getByLabel("Illustrative research export JSON schema"),
    ).toBeVisible();
    expect(await calls(page)).toEqual([]);
    await check();
  });
for (const authenticated of [false, true])
  test(`${authenticated ? "unlinked member" : "guest"} can preview without extra queries or linking wallet`, async ({
    page,
  }) => {
    const check = await harness(
      page,
      "platform",
      authenticated ? "unlinked" : "guest",
    );
    const before = await page.evaluate(
      () => window.researchPreviewFixture.reads.length,
    );
    await preview(page).click();
    await expect(
      page.getByLabel("Illustrative research export JSON schema"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Link fixture wallet" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => window.researchPreviewFixture.reads.length),
    ).toBe(before);
    if (!authenticated)
      expect(
        await page.evaluate(() =>
          window.researchPreviewFixture.reads.filter(
            (read) => read.name !== "forumResearch:getConfig",
          ),
        ),
      ).toEqual([]);
    expect(await calls(page)).toEqual([]);
    await check();
  });
test("quoted review uses original exact-mint payload and real requirement shape, without signing", async ({
  page,
}) => {
  const check = await harness(page);
  await review(page).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText(mintA, { exact: true }),
  ).toBeVisible();
  await expect(approve(page)).toBeEnabled();
  expect(await calls(page)).toEqual([
    {
      name: "forumResearchActions:quote",
      args: {
        wallet: "11111111111111111111111111111111",
        mint: mintA,
        idempotencyKey: expect.any(String),
      },
    },
  ]);
  await check();
});
test("quote expires while review is open without a new quote or approval", async ({
  page,
}) => {
  await page.clock.install({ time: 1793400000000 });
  const check = await harness(page);
  await review(page).click();
  await expect(approve(page)).toBeEnabled();
  // Existing UI expiry is minute-rounded; the approval handler checks exact time.
  await page.clock.fastForward(RESEARCH_INTENT_TTL + 61000);
  await expect(
    page.getByRole("button", { name: "Quote expired · close to refresh" }),
  ).toBeDisabled();
  expect((await calls(page)).map((call) => call.name)).toEqual([
    "forumResearchActions:quote",
  ]);
  await check();
});
test("reserved unexpired quote retains explicit approval when public readiness closes", async ({
  page,
}) => {
  const check = await harness(page);
  await review(page).click();
  await expect(approve(page)).toBeEnabled();
  await page.evaluate(() =>
    window.researchPreviewFixture.update({ mode: "exhausted" }),
  );
  await expect(approve(page)).toBeEnabled();
  expect((await calls(page)).map((call) => call.name)).toEqual([
    "forumResearchActions:quote",
  ]);
  await check();
});
for (const receiptState of [
  "verifying",
  "settlement_claimed",
  "unknown",
] as const)
  test(`${receiptState} receipt prevents repeat approval/payment`, async ({
    page,
  }) => {
    const check = await harness(page);
    await review(page).click();
    await page.evaluate(
      (value) =>
        window.researchPreviewFixture.update({
          receiptState: value,
          historyState: value,
        }),
      receiptState,
    );
    await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
      /This request cannot be paid again/,
    );
    await expect(approve(page)).toHaveCount(0);
    expect((await calls(page)).map((call) => call.name)).toEqual([
      "forumResearchActions:quote",
    ]);
    await check();
  });
for (const receiptState of ["rejected", "expired"] as const)
  test(`${receiptState} receipt cannot be approved as a quote`, async ({
    page,
  }) => {
    const check = await harness(page);
    await review(page).click();
    await page.evaluate(
      (value) => window.researchPreviewFixture.update({ receiptState: value }),
      receiptState,
    );
    await expect(approve(page)).toBeDisabled();
    expect((await calls(page)).map((call) => call.name)).toEqual([
      "forumResearchActions:quote",
    ]);
    await check();
  });
test("signature on an unknown receipt is not finality or a fulfilled report", async ({
  page,
}) => {
  const check = await harness(page);
  await review(page).click();
  await page.evaluate(() =>
    window.researchPreviewFixture.update({
      receiptState: "unknown",
      historyState: "unknown",
      signature: "1".repeat(88),
    }),
  );
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "View transaction" }),
  ).toHaveAttribute("href", `https://solscan.io/tx/${"1".repeat(88)}`);
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "cannot be paid again",
  );
  await expect(
    page.getByRole("link", { name: "Open verified report and receipt" }),
  ).toHaveCount(0);
  await expect(approve(page)).toHaveCount(0);
  expect((await calls(page)).map((call) => call.name)).toEqual([
    "forumResearchActions:quote",
  ]);
  await check();
});
test("saved fulfilled export is available without another quote or wallet action", async ({
  page,
}) => {
  const check = await harness(page, "platform", "saved-fulfilled");
  await page
    .getByText("Your recent research receipts", { exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open report + receipt" }),
  ).toHaveAttribute("href", `/api/research/token/${"a".repeat(64)}`);
  expect(await calls(page)).toEqual([]);
  await check();
});
test("fulfilled report and saved export links reuse the original receipt without another payment", async ({
  page,
}) => {
  const check = await harness(page);
  await review(page).click();
  await page.evaluate(() =>
    window.researchPreviewFixture.update({
      receiptState: "fulfilled",
      historyState: "fulfilled",
    }),
  );
  await expect(
    page.getByRole("dialog").getByRole("heading", {
      name: "Invented lifecycle fixture (TEST): source-backed brief",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open verified report and receipt" }),
  ).toHaveAttribute("href", `/api/research/token/${"a".repeat(64)}`);
  await expect(approve(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByText("Your recent research receipts", { exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open report + receipt" }),
  ).toHaveAttribute("href", `/api/research/token/${"a".repeat(64)}`);
  expect((await calls(page)).map((call) => call.name)).toEqual([
    "forumResearchActions:quote",
  ]);
  await check();
});
test("saved unknown receipt only verifies explicitly and never requests a replacement payment", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.researchPreviewFixture.update({
      historyState: "unknown",
      signature: "1".repeat(88),
    }),
  );
  await expect(
    page.getByRole("button", { name: "Payment receipt protected" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Verify saved receipt", exact: true })
    .first()
    .click();
  await expect(
    page.getByText(/nothing was resent/, { exact: false }),
  ).toBeVisible();
  expect((await calls(page)).map((call) => call.name)).toEqual([
    "forumResearchActions:check",
  ]);
  await check();
});
test("mint change remounts only the existing scoped research controller and closes prior review", async ({
  page,
}) => {
  const check = await harness(page);
  await review(page).click();
  await page.evaluate(
    (value) => window.researchPreviewFixture.update({ mint: value }),
    mintB,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await review(page).click();
  await expect(
    page.getByRole("dialog").getByText(mintB, { exact: true }),
  ).toBeVisible();
  expect(
    (await calls(page)).map((call) => (call.args as { mint: string }).mint),
  ).toEqual([mintA, mintB]);
  await check();
});
test("late quote from a previous mint cannot open a new mint's review", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.researchPreviewFixture.update({ deferQuote: true }),
  );
  await review(page).click();
  await page.evaluate(
    (value) =>
      window.researchPreviewFixture.update({ mint: value, deferQuote: false }),
    mintB,
  );
  await page.evaluate(() => window.researchPreviewFixture.releaseQuote());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await review(page).click();
  await expect(
    page.getByRole("dialog").getByText(mintB, { exact: true }),
  ).toBeVisible();
  expect(
    (await calls(page)).map((call) => (call.args as { mint: string }).mint),
  ).toEqual([mintA, mintB]);
  await check();
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px preview fits and remains keyboard readable before payment`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await harness(page, app);
      await preview(page).focus();
      await page.keyboard.press("Enter");
      for (const node of [
        preview(page),
        page.getByLabel("Illustrative research export JSON schema"),
      ]) {
        const box = await node.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(
          await node.evaluate((element) =>
            parseFloat(getComputedStyle(element).fontSize),
          ),
        ).toBeGreaterThanOrEqual(14);
      }
      expect(
        (await preview(page).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(await calls(page)).toEqual([]);
      await check();
    });
