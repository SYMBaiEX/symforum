import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const origin = "http://127.0.0.1:43257";
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
      `const baseline=process.env.SEARCH_RECOVERY_BASELINE==="1"?await Bun.$\`git show 8ba7ac40:components/forum/forum-search-page.tsx\`.text():null;const result=await Bun.build({entrypoints:["tests/e2e/fixtures/search-recovery.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"isolated",setup(build){if(baseline)build.onLoad({filter:/components\\/forum\\/forum-search-page\\.tsx$/},()=>({contents:baseline,loader:"tsx"}));build.onResolve({filter:/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/navigation$|forum-primitives$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/search-recovery-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
  );
});
async function open(
  page: Page,
  query = "q=solana&author=nyx&board=crypto&type=threads&target=titles&sort=newest&days=7&size=24&page=3",
  app = "platform",
) {
  const errors: string[] = [],
    network: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/forum/search")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    network.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/forum/search?${query}`);
  await expect(
    page.getByRole("textbox", { name: "Keywords", exact: true }),
  ).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
    expect(await page.evaluate(() => window.searchRecovery.forbidden)).toEqual(
      [],
    );
    expect(
      await page.evaluate(() => window.searchRecovery.subscriptions),
    ).toEqual([{ limit: 200 }]);
  };
}
const count = (page: Page) =>
  page.evaluate(() => window.searchRecovery.queries.length);
async function finish(page: Page, index = 0, limited = false) {
  await expect.poll(() => count(page)).toBe(index + 1);
  await page.evaluate(
    ({ index, limited }) => window.searchRecovery.finish(index, limited),
    { index, limited },
  );
}
test("explicit recovery uses applied filters, not unsaved form edits, and Back restores them", async ({
  page,
}) => {
  const check = await open(page);
  await finish(page);
  await page
    .getByRole("textbox", { name: "Keywords", exact: true })
    .fill("unsaved keyword");
  await page
    .getByRole("textbox", { name: "Author", exact: true })
    .fill("unsaved_author");
  await page
    .getByRole("button", { name: "Clear keywords", exact: true })
    .click();
  await expect.poll(() => count(page)).toBe(2);
  expect(await page.evaluate(() => window.searchRecovery.queries[1])).toEqual({
    query: "",
    categorySlug: "crypto",
    page: 1,
    pageSize: 24,
    resultType: "threads",
    author: "nyx",
    target: "titles",
    sortKey: "newest",
    days: 7,
  });
  await expect(
    page.getByRole("textbox", { name: "Keywords", exact: true }),
  ).toHaveValue("");
  await page.goBack();
  await expect.poll(() => count(page)).toBe(3);
  await expect(
    page.getByRole("textbox", { name: "Keywords", exact: true }),
  ).toHaveValue("solana");
  await expect(
    page.getByRole("textbox", { name: "Author", exact: true }),
  ).toHaveValue("nyx");
  await check();
});
test("loading and failed searches never offer filter recovery", async ({
  page,
}) => {
  const check = await open(page);
  await expect.poll(() => count(page)).toBe(1);
  await expect(
    page.getByRole("group", { name: "Adjust submitted search" }),
  ).toHaveCount(0);
  await page.evaluate(() => window.searchRecovery.fail(0));
  await expect(
    page.getByRole("button", { name: "Retry search" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Adjust submitted search" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Retry search" }).click();
  await finish(page, 1);
  await page.getByRole("button", { name: "Clear author", exact: true }).click();
  await expect.poll(() => count(page)).toBe(3);
  expect(
    await page.evaluate(() => window.searchRecovery.queries[2].author),
  ).toBeUndefined();
  await check();
});
test("late previous-query completion cannot offer recovery for the new submitted search", async ({
  page,
}) => {
  const check = await open(page);
  await expect.poll(() => count(page)).toBe(1);
  await page
    .getByRole("textbox", { name: "Keywords", exact: true })
    .fill("new keywords");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect.poll(() => count(page)).toBe(2);
  await page.evaluate(() => window.searchRecovery.finish(0, true));
  await expect(
    page.getByRole("group", { name: "Adjust submitted search" }),
  ).toHaveCount(0);
  await finish(page, 1);
  await page.getByRole("button", { name: "Clear author", exact: true }).click();
  await expect.poll(() => count(page)).toBe(3);
  expect(
    await page.evaluate(() => window.searchRecovery.queries[2].query),
  ).toBe("new keywords");
  expect(
    await page.evaluate(() => window.searchRecovery.queries[2].author),
  ).toBeUndefined();
  await check();
});
test("limited zero-result scan is not presented as an exhaustive no-match result", async ({
  page,
}) => {
  const check = await open(page);
  await finish(page, 0, true);
  await expect(
    page.getByText("No visible matches in this bounded scan.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("No public matches", { exact: false }),
  ).toHaveCount(0);
  expect(await count(page)).toBe(1);
  await check();
});
for (const query of ["q=solana", "author=nyx"])
  test(`invalid broader search is never invoked: ${query}`, async ({
    page,
  }) => {
    const check = await open(page, query);
    await finish(page);
    await expect(
      page.getByRole("button", {
        name: query.startsWith("q=") ? "Clear keywords" : "Clear author",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Search all boards" }),
    ).toHaveCount(0);
    expect(await count(page)).toBe(1);
    await check();
  });
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px recovery controls fit, retain 44px targets and keyboard operation`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await open(page, undefined, app);
      await finish(page);
      const group = page.getByRole("group", {
        name: "Adjust submitted search",
      });
      await expect(group).toBeVisible();
      for (const button of await group.getByRole("button").all()) {
        const box = await button.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      const box = await group.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      const clear = page.getByRole("button", { name: "Search all boards" });
      await clear.focus();
      await expect(clear).toBeFocused();
      await clear.press("Enter");
      await expect.poll(() => count(page)).toBe(2);
      expect(
        await page.evaluate(
          () => window.searchRecovery.queries[1].categorySlug,
        ),
      ).toBeUndefined();
      expect(
        await page.evaluate(() => window.searchRecovery.queries[1].author),
      ).toBe("nyx");
      await check();
    });
