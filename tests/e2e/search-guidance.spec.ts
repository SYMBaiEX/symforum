import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const origin = "http://127.0.0.1:43245";
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/search-guidance.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"search-guidance-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/navigation$|forum-primitives$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/search-guidance-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());`,
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
    expect(await page.evaluate(() => window.searchGuidance.forbidden)).toEqual(
      [],
    );
    expect(
      await page.evaluate(() => window.searchGuidance.subscriptions),
    ).toEqual([{ name: "forum:listCategoryOptions", args: { limit: 200 } }]);
  };
}
const keywords = (page: Page) =>
  page.getByRole("textbox", { name: "Keywords", exact: true });
const search = (page: Page) =>
  page.getByRole("button", { name: "Search", exact: true });
const queries = (page: Page) =>
  page.evaluate(() => window.searchGuidance.queries);
const hint = (page: Page) => page.locator("#forum-search-keywords-help");
test("Keywords has visible associated minimum and author-only guidance before submission", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(keywords(page)).toHaveAttribute(
    "aria-describedby",
    "forum-search-keywords-help",
  );
  await expect(hint(page)).toHaveText(
    "Use at least two characters, or leave Keywords blank and enter a member handle in Author under Advanced filters.",
  );
  await expect(keywords(page)).toHaveAttribute("minlength", "2");
  expect(await queries(page)).toEqual([]);
  await check();
});
for (const value of ["a", " a "])
  test(`one-character trimmed Keywords ${JSON.stringify(value)} gets guidance without automatic or submitted search`, async ({
    page,
  }) => {
    const check = await harness(page);
    await keywords(page).fill(value);
    await expect(hint(page)).toHaveText(
      "Add at least one more character, or clear Keywords and search by Author under Advanced filters.",
    );
    expect(await queries(page)).toEqual([]);
    await search(page).click();
    expect(await queries(page)).toEqual([]);
    expect(
      await page.evaluate(() => window.searchGuidance.navigations),
    ).toEqual(value === "a" ? [] : ["/forum/search?q=a"]);
    await expect(keywords(page)).toHaveValue(value);
    await check();
  });
test("two-character explicit keyboard submission keeps the original query payload", async ({
  page,
}) => {
  const check = await harness(page);
  await keywords(page).fill(" ab ");
  expect(await queries(page)).toEqual([]);
  await keywords(page).press("Enter");
  await expect
    .poll(() => queries(page))
    .toEqual([
      {
        name: "forum:search",
        args: {
          query: "ab",
          threadPage: 1,
          replyPage: 1,
          pageSize: 12,
          resultType: "all",
        },
      },
    ]);
  await expect(page).toHaveURL(`${origin}/forum/search?q=ab`);
  await check();
});
test("blank Keywords plus explicit Author retains the existing allowed payload", async ({
  page,
}) => {
  const check = await harness(page);
  await page.getByText("Advanced filters", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Author", exact: true })
    .fill(" nyx ");
  await search(page).click();
  await expect
    .poll(() => queries(page))
    .toEqual([
      {
        name: "forum:search",
        args: {
          query: "",
          author: "nyx",
          threadPage: 1,
          replyPage: 1,
          pageSize: 12,
          resultType: "all",
        },
      },
    ]);
  await expect(keywords(page)).toHaveValue("");
  await check();
});
test("initial one-character URL and Back preserve original filter context without widening search", async ({
  page,
}) => {
  const initial =
    "q=a&board=ai-models&type=threads&author=nyx&target=titles&sort=newest&days=7&size=24";
  const check = await harness(page, initial);
  await expect(hint(page)).toContainText("Add at least one more character");
  expect(await queries(page)).toEqual([]);
  await keywords(page).fill("ab");
  await search(page).click();
  await expect
    .poll(() => queries(page))
    .toEqual([
      {
        name: "forum:search",
        args: {
          query: "ab",
          categorySlug: "ai-models",
          page: 1,
          pageSize: 24,
          resultType: "threads",
          author: "nyx",
          target: "titles",
          sortKey: "newest",
          days: 7,
        },
      },
    ]);
  await page.evaluate(() => history.back());
  await expect(keywords(page)).toHaveValue("a");
  await expect(page).toHaveURL(`${origin}/forum/search?${initial}`);
  await expect(hint(page)).toContainText("Add at least one more character");
  expect(await queries(page)).toHaveLength(1);
  await check();
});
test("inert search failure retains associated Keywords guidance and input", async ({
  page,
}) => {
  const check = await harness(page, "q=ab&failure=1");
  await expect(
    page.getByText("Search could not be completed. Please try again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(keywords(page)).toHaveValue("ab");
  await expect(hint(page)).toContainText("Use at least two characters");
  expect(await queries(page)).toHaveLength(1);
  await check();
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px guidance fits intrinsically and preserves existing keyboard controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await harness(page, "", app);
      await keywords(page).fill(" a ");
      await expect(hint(page)).toContainText("Add at least one more character");
      for (const node of [hint(page), keywords(page), page.locator("form")]) {
        const box = (await node.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(await node.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(
          await node.evaluate((el) => el.clientWidth),
        );
      }
      await keywords(page).fill("ab");
      await search(page).focus();
      await expect(search(page)).toBeFocused();
      expect((await search(page).boundingBox())!.height).toBeGreaterThanOrEqual(
        44,
      );
      const reset = page.getByRole("button", { name: "Reset", exact: true });
      expect((await reset.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const resetBounds = (await reset.boundingBox())!;
      expect(resetBounds.x).toBeGreaterThanOrEqual(0);
      expect(resetBounds.x + resetBounds.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Enter");
      await expect.poll(() => queries(page)).toHaveLength(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await check();
    });
