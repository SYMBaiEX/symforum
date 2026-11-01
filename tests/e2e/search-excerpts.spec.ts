import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const origin = "http://127.0.0.1:43261";
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
  const baseline =
    process.env.SEARCH_EXCERPTS_BASELINE === "1"
      ? execFileSync(
          "git",
          ["show", "0beb8049:components/forum/forum-search-page.tsx"],
          { encoding: "utf8" },
        )
      : null;
  script = execFileSync(
    "bun",
    [
      "-e",
      `const baseline=${JSON.stringify(baseline)};const r=await Bun.build({entrypoints:["tests/e2e/fixtures/search-excerpts.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"isolated-public-search",setup(build){if(baseline)build.onLoad({filter:/components\\/forum\\/forum-search-page\\.tsx$/},()=>({contents:baseline,loader:"tsx"}));build.onResolve({filter:/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/navigation$|^next\\/link$|forum-primitives$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/search-excerpts-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));process.stdout.write(await r.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
  );
});
async function open(page: Page, query = "q=solana", app = "platform") {
  const errors: string[] = [],
    network: string[] = [];
  const path = app === "platform" ? "/forum/search" : "/search";
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === path)
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    network.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}${path}?${query}`);
  await expect(
    page.getByRole("textbox", { name: "Keywords", exact: true }),
  ).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
    expect(await page.evaluate(() => window.searchExcerpts.forbidden)).toEqual(
      [],
    );
    expect(
      await page.evaluate(() => window.searchExcerpts.subscriptions),
    ).toEqual([{ limit: 200 }]);
  };
}
async function finish(page: Page, index = 0, mode = "normal") {
  await expect
    .poll(() => page.evaluate(() => window.searchExcerpts.queries.length))
    .toBe(index + 1);
  await page.evaluate(
    ({ index, mode }) => window.searchExcerpts.finish(index, mode),
    { index, mode },
  );
  await expect(page.getByRole("article").first()).toBeVisible();
}
const keywords = (page: Page) =>
  page.getByRole("textbox", { name: "Keywords", exact: true });
test("returned excerpts and titles retain original text, highlight submitted literal keywords and preserve result links", async ({
  page,
}) => {
  const check = await open(page);
  await finish(page);
  const articles = page.getByRole("article");
  await expect(articles).toHaveCount(2);
  await expect(articles.first().getByRole("link")).toHaveText(
    "Solana and SOLANA tools",
  );
  await expect(articles.first().getByRole("link")).toHaveAttribute(
    "href",
    "/forum/crypto/source-thread",
  );
  await expect(articles.nth(1).getByRole("link")).toHaveAttribute(
    "href",
    "/forum/crypto/source-thread#post-3",
  );
  await expect(articles.first().locator("mark")).toHaveText([
    "Solana",
    "SOLANA",
    "SOLANA",
  ]);
  await expect(page.getByText("Original excerpt", { exact: true })).toHaveCount(
    2,
  );
  await expect(
    page.getByText("DO_NOT_DISPLAY_BODY_WHEN_EXCERPT_EXISTS", { exact: false }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.searchExcerpts.queries)).toEqual([
    {
      query: "solana",
      threadPage: 1,
      replyPage: 1,
      pageSize: 12,
      resultType: "all",
    },
  ]);
  await check();
});
test("unsaved form keywords never alter displayed highlights or cause another query", async ({
  page,
}) => {
  const check = await open(page);
  await finish(page);
  await keywords(page).fill("Tokyo");
  await expect(page.locator("article mark")).toHaveText([
    "Solana",
    "SOLANA",
    "SOLANA",
    "Solana",
    "Solana",
  ]);
  expect(await page.evaluate(() => window.searchExcerpts.queries.length)).toBe(
    1,
  );
  await check();
});
test("new submissions and Back keep marks bound to the accepted query; late previous results stay fenced", async ({
  page,
}) => {
  const check = await open(page);
  await expect
    .poll(() => page.evaluate(() => window.searchExcerpts.queries.length))
    .toBe(1);
  await keywords(page).fill("東京");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.searchExcerpts.queries.length))
    .toBe(2);
  await page.evaluate(() => window.searchExcerpts.finish(0));
  await expect(page.getByRole("article")).toHaveCount(0);
  await finish(page, 1);
  await expect(page.locator("article mark")).toHaveText(["東京"]);
  await page.goBack();
  await finish(page, 2);
  await expect(page.locator("article mark")).toHaveText([
    "Solana",
    "SOLANA",
    "SOLANA",
    "Solana",
    "Solana",
  ]);
  await check();
});
test("author-only results have no inferred keyword or author relevance highlights", async ({
  page,
}) => {
  const check = await open(page, "author=fixture_author");
  await finish(page);
  await expect(page.locator("article mark")).toHaveCount(0);
  await expect(page.getByRole("article").first()).toContainText(
    "By fixture_author",
  );
  await expect(page.getByText("Original excerpt", { exact: true })).toHaveCount(
    2,
  );
  await check();
});
test("missing snippets are not fabricated; existing reply-body fallback is labelled separately", async ({
  page,
}) => {
  const check = await open(page);
  await finish(page, 0, "body");
  await expect(page.getByText("Original excerpt", { exact: true })).toHaveCount(
    1,
  );
  await expect(
    page.getByText("Original reply text", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole("article").nth(1)).toContainText(
    "Original reply body Solana.",
  );
  await check();
});
test("thread without an excerpt renders no invented body or excerpt label", async ({
  page,
}) => {
  const check = await open(page);
  await finish(page, 0, "missing");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Original excerpt", { exact: true })).toHaveCount(
    0,
  );
  await check();
});
test("generic reply label is not highlighted as though it were a returned original title", async ({
  page,
}) => {
  const check = await open(page, "q=forum");
  await finish(page, 0, "untitled");
  const reply = page.getByRole("article").nth(1);
  await expect(reply.getByRole("link")).toHaveText("Forum reply");
  await expect(reply.getByRole("link").locator("mark")).toHaveCount(0);
  await expect(reply.locator("mark")).toHaveText(["Forum"]);
  await check();
});
test("unsafe source text and regex-looking query stay inert text without new anchors, markup or requests", async ({
  page,
}) => {
  const check = await open(
    page,
    new URLSearchParams({ q: "script [.*]" }).toString(),
  );
  await finish(page, 0, "unsafe");
  await expect(page.getByRole("article").first()).toContainText(
    "<script>window.HACKED=1</script>",
  );
  await expect(page.locator("article script,article img")).toHaveCount(0);
  await expect(page.getByRole("article").first().getByRole("link")).toHaveCount(
    1,
  );
  expect(await page.evaluate(() => window.HACKED)).toBeUndefined();
  await expect(page.getByRole("article").first().locator("mark")).toHaveText([
    "script",
    "script",
  ]);
  await check();
});
test("loading and failures show no excerpt text or fake match", async ({
  page,
}) => {
  const check = await open(page);
  await expect
    .poll(() => page.evaluate(() => window.searchExcerpts.queries.length))
    .toBe(1);
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.evaluate(() => window.searchExcerpts.fail(0));
  await expect(
    page.getByRole("button", { name: "Retry search" }),
  ).toBeVisible();
  await expect(page.locator("mark")).toHaveCount(0);
  await check();
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}: long returned excerpts stay bounded and original result link has a 44px keyboard target`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await open(page, "q=solana", app);
      await finish(page, 0, "long");
      const article = page.getByRole("article").first(),
        link = article.getByRole("link");
      const box = (await article.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(
        await article.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      await link.scrollIntoViewIfNeeded();
      const bounds = (await link.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      await link.focus();
      await expect(link).toBeFocused();
      const expected = `${app === "platform" ? "/forum" : ""}/crypto/source-thread`;
      await expect(link).toHaveAttribute("href", expected);
      await link.press("Enter");
      expect(
        await page.evaluate(() => window.searchExcerpts.navigations),
      ).toEqual([expected]);
      expect(
        await page.evaluate(() => window.searchExcerpts.queries.length),
      ).toBe(1);
      await check();
    });
