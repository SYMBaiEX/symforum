import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
let script: string;
const appCss: Record<string, string> = {};
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
    appCss[app] =
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
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/saved-thread-filter.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[{name:"saved-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^convex-helpers\\/react\\/cache\\/hooks$|^next\\/link$|^next\\/navigation$|forum-primitives$|app-error-surface$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/saved-thread-filter-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));process.stdout.write(await r.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});
async function harness(page: Page, scenario = "", app = "platform") {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43239") {
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${appCss[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (url.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
    }
    requests.push(url.href);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43239/?${scenario}`);
  return async (privateRead = true) => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { savedActions: unknown[] }).savedActions,
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { savedReads: unknown[] }).savedReads,
      ),
    ).toEqual(
      privateRead
        ? [{ name: "forum:listMyThreadBookmarks", args: { limit: 40 } }]
        : [],
    );
  };
}
const search = (page: Page) =>
  page.getByRole("searchbox", { name: "Find in saved threads", exact: true });
const titles = [
  "Agent design notes",
  "Solana research notes",
  "Game design notes",
];
test("surrounding whitespace and board/title case use the same normalized filter and bounded counts", async ({
  page,
}) => {
  const check = await harness(page);
  await expect(
    page.getByRole("link", { name: titles[0], exact: true }),
  ).toBeVisible();
  for (const value of ["   ", "\t  "]) {
    await search(page).fill(value);
    for (const title of titles)
      await expect(
        page.getByRole("link", { name: title, exact: true }),
      ).toBeVisible();
    await expect(page.getByText(/No saved threads match/)).toHaveCount(0);
  }
  await search(page).fill("   DESIGN   ");
  await expect(page.getByRole("status")).toHaveText(
    "2 of 3 loaded saved threads match.",
  );
  await expect(
    page.getByRole("link", { name: titles[1], exact: true }),
  ).toHaveCount(0);
  await search(page).fill("  WeB3 ");
  await expect(page.getByRole("status")).toHaveText(
    "1 of 3 loaded saved threads match.",
  );
  await expect(
    page.getByRole("link", { name: titles[1], exact: true }),
  ).toBeVisible();
  await check();
});
test("no-match clear action restores all loaded rows, returns focus and never reads or removes again", async ({
  page,
}) => {
  const check = await harness(page);
  await search(page).fill("  no such title  ");
  await expect(page.getByRole("status")).toHaveText(
    "0 of 3 loaded saved threads match.",
  );
  await expect(
    page.getByText("No saved threads match “no such title”.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("");
  await expect(page.getByRole("status")).toHaveText("3 loaded saved threads.");
  for (const title of titles)
    await expect(
      page.getByRole("link", { name: title, exact: true }),
    ).toBeVisible();
  await check();
});
for (const scenario of ["guest", "authloading", "loading", "empty"])
  test(`${scenario} preserves the existing saved-thread privacy/loading/empty gates`, async ({
    page,
  }) => {
    const check = await harness(page, scenario);
    if (scenario === "guest") {
      await expect(
        page.getByRole("heading", { name: "Sign in required", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Sign in", exact: true }),
      ).toHaveAttribute("href", "/signin?redirectTo=%2Fsaved");
    } else if (scenario === "authloading")
      await expect(page.getByRole("status")).toHaveText(
        "Checking forum session",
      );
    else if (scenario === "loading")
      await expect(page.getByRole("status")).toHaveText(
        "Syncing saved threads",
      );
    else {
      await expect(
        page.getByText(
          "Save a discussion to keep it in your private reading list.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Clear filter", exact: true }),
      ).toHaveCount(0);
    }
    if (scenario !== "empty") await expect(search(page)).toHaveCount(0);
    for (const title of titles)
      await expect(
        page.getByRole("link", { name: title, exact: true }),
      ).toHaveCount(0);
    await check(scenario === "loading" || scenario === "empty");
  });
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} filter and clear control fit ${width}px with forum styling and keyboard access`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await harness(page, "", app);
      await search(page).fill("design");
      await expect(search(page)).toHaveCSS("font-size", "16px");
      const clear = page.getByRole("button", {
        name: "Clear filter",
        exact: true,
      });
      await search(page).press("Tab");
      await expect(clear).toBeFocused();
      const bounds = await clear.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      const inputBounds = await search(page).boundingBox();
      expect(inputBounds!.height).toBeGreaterThanOrEqual(44);
      expect(inputBounds!.x).toBeGreaterThanOrEqual(0);
      expect(inputBounds!.x + inputBounds!.width).toBeLessThanOrEqual(width);
      for (const component of [
        page.locator(".forum-account-library"),
        page.locator(".forum-library-search"),
        page.locator("section.forum-panel"),
      ]) {
        const section = await component.boundingBox();
        expect(section!.x).toBeGreaterThanOrEqual(0);
        expect(section!.x + section!.width).toBeLessThanOrEqual(width);
        expect(inputBounds!.x).toBeGreaterThanOrEqual(section!.x);
        expect(inputBounds!.x + inputBounds!.width).toBeLessThanOrEqual(
          section!.x + section!.width,
        );
        expect(bounds!.x).toBeGreaterThanOrEqual(section!.x);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
          section!.x + section!.width,
        );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.keyboard.press("Enter");
      await expect(search(page)).toBeFocused();
      await check();
    });
