import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
let script: string, css: string;
test.beforeAll(() => {
  css =
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
      "bun",
      [
        "-e",
        `import postcss from 'postcss';import tailwind from 'tailwindcss';import config from './tailwind.config.ts';const css=(await Bun.file('apps/platform/app/globals.css').text()).replace(/^@import.*$/m,'');process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:['tests/e2e/fixtures/research-readiness.tsx'],target:'browser',format:'iife',minify:true,define:{'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file('tests/fixtures/installation.symbaiex.json').text()})},plugins:[{name:'research-readiness-only',setup(build){build.onResolve({filter:/^convex\\/react$|commerce-wallet$/},()=>({path:process.cwd()+'/tests/e2e/fixtures/research-readiness-state.ts'}));}}]});if(!result.success)throw new Error(JSON.stringify(result.logs));process.stdout.write(await result.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(page: Page) {
  const unexpected: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43237" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43237" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto("http://127.0.0.1:43237/");
  return async () => {
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(() => window.researchReadinessFixture.actions),
    ).toEqual([]);
  };
}
test("public readiness is visible before linking and unknown config stays closed", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(page.getByRole("status")).toHaveText(
    /Checking research payment readiness/,
  );
  await expect(
    page.getByRole("button", { name: "Link community wallet" }),
  ).toBeDisabled();
  expect(
    await page.getByRole("status").evaluate((element) => {
      const button = document.querySelector("button");
      return (
        !!button &&
        !!(
          element.compareDocumentPosition(button) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      );
    }),
  ).toBe(true);
  await page.evaluate(() =>
    window.researchReadinessFixture.update({ mode: "setup" }),
  );
  await expect(page.getByRole("status")).toHaveText(
    /Research payments need setup/,
  );
  await expect(
    page.getByRole("button", { name: "Link community wallet" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      window.researchReadinessFixture.reads.includes("forumResearch:listMine"),
    ),
  ).toBe(false);
  await check();
});
test("wallet services loading does not imply confirmed payment readiness", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.researchReadinessFixture.update({ walletLoading: true }),
  );
  await expect(page.getByRole("status")).toHaveText(
    /readiness has not been checked/,
  );
  await expect(page.getByRole("button")).toHaveCount(0);
  await check();
});
test("ready public availability can be read without signing in or querying receipts", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.researchReadinessFixture.update({ mode: "ready" }),
  );
  await expect(page.getByRole("status")).toHaveText(/available for review/);
  await expect(
    page.getByRole("button", { name: "Link community wallet" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      window.researchReadinessFixture.reads.includes("forumResearch:listMine"),
    ),
  ).toBe(false);
  await check();
});
test("setup and allowance exhaustion stay distinct for unlinked and linked visitors", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.researchReadinessFixture.update({
      authenticated: true,
      mode: "exhausted",
    }),
  );
  await expect(page.getByRole("status")).toHaveText(
    /free facilitator allowance is exhausted/,
  );
  await expect(
    page.getByRole("button", { name: "Link community wallet" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.researchReadinessFixture.update({ linked: true }),
  );
  await expect(
    page.getByRole("button", { name: "Review research export" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.researchReadinessFixture.update({ mode: "setup" }),
  );
  await expect(page.getByRole("status")).toHaveText(
    /Research payments need setup/,
  );
  await expect(
    page.getByRole("button", { name: "Review research export" }),
  ).toBeDisabled();
  await check();
});
test("ready review has an associated hint and closes again when config becomes unknown", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.researchReadinessFixture.update({
      authenticated: true,
      linked: true,
      mode: "ready",
    }),
  );
  const review = page.getByRole("button", { name: "Review research export" });
  await expect(review).toBeEnabled();
  await expect(review).toHaveAccessibleDescription(/available for review/);
  await review.focus();
  await expect(review).toBeFocused();
  await page.evaluate(() =>
    window.researchReadinessFixture.update({ mode: "loading" }),
  );
  await expect(review).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText(
    /Checking research payment readiness/,
  );
  await page.evaluate(() =>
    window.researchReadinessFixture.update({ mode: "inconsistent" }),
  );
  await expect(page.getByRole("status")).toHaveText(
    /Research payment readiness is unavailable/,
  );
  await expect(review).toBeDisabled();
  await check();
});
test("existing expired quotes and protected receipts are not replayed by readiness changes", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.researchReadinessFixture.update({
      authenticated: true,
      linked: true,
      mode: "setup",
      expired: true,
    }),
  );
  await page
    .getByText("Your recent research receipts", { exact: true })
    .click();
  await expect(page.getByText(/expired quote/)).toBeVisible();
  await page.evaluate(() =>
    window.researchReadinessFixture.update({
      expired: false,
      held: true,
      mode: "ready",
    }),
  );
  await expect(
    page.getByRole("button", { name: "Payment receipt protected" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/No validated transaction signature is available yet/),
  ).toBeVisible();
  await check();
});
test("query failure uses the existing safe boundary without exposing provider details", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    window.researchReadinessFixture.update({ mode: "failure" }),
  );
  await expect(page.getByRole("status")).toHaveText(
    /Research is temporarily unavailable/,
  );
  await expect(page.getByText("PRIVATE_FIXTURE_CONFIG_ERROR")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Review research export" }),
  ).toHaveCount(0);
  await check();
});
for (const width of [320, 390])
  test(`readiness is readable without wallet interaction at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 700 });
    const check = await harness(page);
    await page.evaluate(() =>
      window.researchReadinessFixture.update({ mode: "exhausted" }),
    );
    const status = page.getByRole("status");
    await expect(status).toBeVisible();
    expect(
      await status.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("readiness.png"),
      fullPage: true,
    });
    await check();
  });
