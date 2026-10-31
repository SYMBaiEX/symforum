import { test, expect, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
let script: string, css: string, forumCss: string;
const origin = "http://127.0.0.1:43228";
type MemberFixture = {
  reads: { name: string; args: Record<string, unknown> }[];
  routes: { mode: string; href: string; options: unknown }[];
  forbidden: string[];
};
declare global {
  interface Window {
    __memberControls: MemberFixture;
    __summaryFocusCalls: number;
  }
}
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
const state = (page: Page) => page.evaluate(() => window.__memberControls);
const search = (page: Page) =>
  page.getByRole("searchbox", { name: "Search members", exact: true });
const summary = (page: Page) =>
  page.locator("summary").filter({ hasText: /per page/ });
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
  forumCss =
    FORUM_SHARED_THEME_CSS +
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
      "bun",
      [
        "-e",
        `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
      ],
      { cwd: "apps/forum", encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/member-controls.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"member-controls-only",setup(build){build.onResolve({filter:/^convex-helpers\\/react\\/cache\\/hooks$|^convex\\/react$|^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/member-controls-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  query = "",
  cssVariant: "platform" | "forum" = "platform",
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/forum/members")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${cssVariant === "forum" ? forumCss : css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    audit.outbound.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/forum/members?${query}`);
  await expect(
    page.getByRole("heading", { name: "Members", exact: true }),
  ).toBeVisible();
}
test.afterEach(async ({ page }) => {
  const audit = audits.get(page);
  if (audit) {
    expect(audit.errors).toEqual([]);
    expect(audit.outbound).toEqual([]);
  }
  const fixture = await state(page);
  expect(fixture.forbidden).toEqual([]);
  for (const read of fixture.reads) {
    expect(read.name).toBe("forum:listMembers");
    expect(Object.keys(read.args).sort()).toEqual([
      "page",
      "pageSize",
      "query",
      "sortKey",
    ]);
  }
});
test("no-match recovery clears query and resets page through the existing URL while retaining sort and size", async ({
  page,
}) => {
  await harness(
    page,
    "q=no-matching-person&sort=name-asc&perPage=50&page=3&keep=untouched",
  );
  await expect(page.getByText("No matches", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear search", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search(page)).toHaveValue("");
  await expect(search(page)).toBeFocused();
  const params = new URL(page.url()).searchParams;
  expect(params.has("q")).toBe(false);
  expect(params.has("page")).toBe(false);
  expect(params.get("sort")).toBe("name-asc");
  expect(params.get("perPage")).toBe("50");
  expect(params.get("keep")).toBe("untouched");
  await expect(
    page.getByRole("combobox", { name: "Sort by", exact: true }),
  ).toHaveValue("name-asc");
  await expect(summary(page)).toHaveText("50 per page");
  await expect(page.getByRole("article")).toHaveCount(50);
  const last = (await state(page)).routes.at(-1)!;
  expect(last.mode).toBe("replace");
  expect(last.options).toEqual({ scroll: false });
});
test("Escape closes native page-size details and returns keyboard focus to its visible summary", async ({
  page,
}) => {
  await harness(page);
  await summary(page).focus();
  await page.keyboard.press("Enter");
  const size = page.getByRole("combobox", {
    name: "Members per page",
    exact: true,
  });
  await expect(size).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(size).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(size).toBeHidden();
  await expect(summary(page)).toBeFocused();
  expect((await state(page)).routes).toEqual([]);
  expect((await state(page)).reads).toHaveLength(1);
});
for (const scenario of ["empty", "loading"])
  test(`${scenario} stays distinct from no-match and offers no misleading clear-search recovery`, async ({
    page,
  }) => {
    await harness(page, `scenario=${scenario}`);
    if (scenario === "loading")
      await expect(page.getByRole("status")).toHaveText("Syncing members");
    else
      await expect(
        page.getByText(/No forum profiles have posted yet/),
      ).toBeVisible();
    await expect(page.getByText("No matches", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Clear search", exact: true }),
    ).toHaveCount(0);
    expect((await state(page)).routes).toEqual([]);
  });
test("normal matches keep canonical member links and existing URL sort/page-size resets", async ({
  page,
}) => {
  await harness(page, "sort=joined-asc&page=2");
  await expect(page.getByRole("article")).toHaveCount(25);
  await summary(page).click();
  const size = page.getByRole("combobox", {
    name: "Members per page",
    exact: true,
  });
  await size.selectOption("50");
  await expect(size).toHaveValue("50");
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  expect(new URL(page.url()).searchParams.get("sort")).toBe("joined-asc");
  await page.keyboard.press("Escape");
  await expect(summary(page)).toBeFocused();
  await expect(
    page.getByRole("link", { name: "Alice Builder", exact: true }),
  ).toHaveAttribute("href", "/forum/members/Alice_Builder");
  await expect(
    page.getByRole("button", { name: "Clear search", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Sort by", exact: true })
    .selectOption("reputation-desc");
  await expect(
    page.getByRole("combobox", { name: "Sort by", exact: true }),
  ).toHaveValue("reputation-desc");
  expect((await state(page)).reads.at(-1)!.args).toEqual({
    page: 1,
    pageSize: 50,
    sortKey: "reputation-desc",
  });
});
test("an already handled Escape leaves the native disclosure unchanged", async ({
  page,
}) => {
  await harness(page);
  await summary(page).click();
  const size = page.getByRole("combobox", {
    name: "Members per page",
    exact: true,
  });
  await size.focus();
  await size.evaluate((node) =>
    node.addEventListener(
      "keydown",
      (event) => {
        if ((event as KeyboardEvent).key === "Escape") event.preventDefault();
      },
      { once: true },
    ),
  );
  await page.keyboard.press("Escape");
  await expect(size).toBeVisible();
  await expect(size).toBeFocused();
});
test("a hidden summary is never programmatically focused by Escape", async ({
  page,
}) => {
  await harness(page);
  await summary(page).click();
  await page.evaluate(() => {
    window.__summaryFocusCalls = 0;
    const original = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (options) {
      if (this.tagName === "SUMMARY") window.__summaryFocusCalls++;
      original.call(this, options);
    };
    const details = document.querySelector("details")!;
    details.style.display = "none";
    details.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(await page.evaluate(() => window.__summaryFocusCalls)).toBe(0);
});
async function expectRealBounds(
  page: Page,
  target: Locator,
  label: string,
  vertical = true,
) {
  const box = await target.boundingBox();
  expect(box, `${label} has actual rendered bounds`).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x, `${label} starts inside viewport`).toBeGreaterThanOrEqual(0);
  expect(
    box!.x + box!.width,
    `${label} ends inside viewport`,
  ).toBeLessThanOrEqual(viewport.width);
  if (vertical) {
    expect(
      box!.y,
      `${label} starts inside viewport vertically`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      box!.y + box!.height,
      `${label} ends inside viewport vertically`,
    ).toBeLessThanOrEqual(viewport.height);
  }
}
for (const [cssVariant, width] of [
  ["platform", 320],
  ["platform", 390],
  ["forum", 320],
  ["forum", 390],
] as const)
  test(`${cssVariant} ${width}px recovery and page-size popup remain bounded with 44px controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    await harness(
      page,
      "q=missing-fixture-person&perPage=10&sort=threads-desc",
      cssVariant,
    );
    const clear = page.getByRole("button", {
      name: "Clear search",
      exact: true,
    });
    await expect(clear).toBeVisible();
    const section = page.locator("section.forum-workspace");
    await expectRealBounds(page, section, "Member section", false);
    expect(
      await section.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await expectRealBounds(page, clear, "Clear search");
    await expectRealBounds(page, search(page), "Member search");
    await expectRealBounds(page, summary(page), "Page-size summary");
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await clear.focus();
    await page.keyboard.press("Enter");
    await expect(search(page)).toBeFocused();
    await summary(page).focus();
    await page.keyboard.press("Enter");
    const size = page.getByRole("combobox", {
      name: "Members per page",
      exact: true,
    });
    await expect(size).toBeVisible();
    const popup = await size.locator("..").boundingBox();
    expect(popup!.x).toBeGreaterThanOrEqual(0);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(width);
    await expectRealBounds(page, size.locator(".."), "Page-size popup");
    await expectRealBounds(page, size, "Page-size selector");
    await expectRealBounds(page, section, "Populated member section", false);
    expect(
      await section.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect((await summary(page).boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );
    expect((await size.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await size.focus();
    await page.keyboard.press("Escape");
    await expect(summary(page)).toBeFocused();
    await expect(size).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
