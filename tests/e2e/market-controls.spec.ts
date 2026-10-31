import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
let script: string;
let css: string;
const origin = "http://127.0.0.1:43225";
const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const otherMint = "So11111111111111111111111111111111111111112";
const audits = new WeakMap<Page, { errors: string[]; unexpected: string[] }>();
type FixtureState = {
  selected: { mint: string; symbol: string; name: string }[];
  queries: Record<string, unknown>[];
  actions: string[];
};
const state = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __marketControls: FixtureState })
        .__marketControls,
  );
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/market-controls.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"market-controls-mock",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/market-controls-state.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});
async function harness(page: Page, scenario = "") {
  const audit = { errors: [] as string[], unexpected: [] as string[] };
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
    if (
      url.origin === origin &&
      url.pathname === "/images/brand/symforum-icon-64.png"
    )
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>',
      });
    audit.unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?${scenario}`);
  await expect.poll(async () => (await state(page)).actions.length).toBe(1);
}
test.afterEach(async ({ page }) => {
  const audit = audits.get(page);
  if (audit) {
    expect(audit.errors).toEqual([]);
    expect(audit.unexpected).toEqual([]);
  }
  expect((await state(page)).actions).toEqual(["forumTerminalRefresh:refresh"]);
});
test("empty search offers an explicit exact-mint selection, never automatic or symbol-derived", async ({
  page,
}) => {
  await harness(page);
  await page
    .getByRole("textbox", { name: "Search sampled tokens" })
    .fill(` ${otherMint} `);
  const open = page.getByRole("button", {
    name: "View exact mint",
    exact: true,
  });
  await expect(open).toBeVisible();
  expect((await state(page)).selected).toEqual([]);
  await open.click();
  expect((await state(page)).selected).toEqual([
    { mint: otherMint, symbol: "TOKEN", name: "Selected Solana token" },
  ]);
  expect((await state(page)).queries).toHaveLength(1);
});
test("invalid base58 and valid-looking wrong-byte-length inputs never offer exact-mint selection", async ({
  page,
}) => {
  await harness(page);
  const input = page.getByRole("textbox", { name: "Search sampled tokens" });
  for (const invalid of [
    "SAME",
    "0".repeat(32),
    "1".repeat(31),
    "1".repeat(33),
    "z".repeat(44),
    `${otherMint}/`,
    `https://example.test/${otherMint}`,
  ]) {
    await input.fill(invalid);
    await expect(
      page.getByRole("button", { name: "View exact mint", exact: true }),
    ).toHaveCount(0);
  }
  expect((await state(page)).selected).toEqual([]);
});
test("clear search is available with matching rows and retains filter and sort choices", async ({
  page,
}) => {
  await harness(page);
  await page
    .getByRole("combobox", { name: "Market cap", exact: true })
    .selectOption("under50k");
  await page
    .getByRole("combobox", { name: "Platform", exact: true })
    .selectOption("pumpfun");
  await page
    .getByRole("combobox", { name: "Sort sampled tokens" })
    .selectOption("price:asc");
  const input = page.getByRole("textbox", { name: "Search sampled tokens" });
  await input.fill("SAME");
  const queries = (await state(page)).queries;
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(
    page.getByRole("combobox", { name: "Market cap", exact: true }),
  ).toHaveValue("under50k");
  await expect(
    page.getByRole("combobox", { name: "Platform", exact: true }),
  ).toHaveValue("pumpfun");
  await expect(
    page.getByRole("combobox", { name: "Sort sampled tokens" }),
  ).toHaveValue("price:asc");
  expect((await state(page)).queries).toEqual(queries);
  expect((await state(page)).selected).toEqual([]);
});
for (const mode of ["success", "reject", "missing"])
  test(`copy exact mint ${mode} remains separate from selection and refresh`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      Object.assign(window, { __copiedMints: [] });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value:
          mode === "missing"
            ? undefined
            : {
                writeText: async (value: string) => {
                  if (mode === "reject") throw new Error("Clipboard denied");
                  (
                    window as unknown as { __copiedMints: string[] }
                  ).__copiedMints.push(value);
                },
              },
      });
    }, mode);
    await harness(page);
    await page
      .getByRole("button", {
        name: `Copy exact mint for SAME, ${mint}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("status").filter({
        hasText:
          mode === "success" ? "Exact mint copied." : "Could not copy mint.",
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { __copiedMints: string[] }).__copiedMints,
      ),
    ).toEqual(mode === "success" ? [mint] : []);
    expect((await state(page)).selected).toEqual([]);
    expect((await state(page)).queries).toHaveLength(1);
  });
for (const width of [320, 390])
  test(`${width}px exact-mint and copy controls keep 44px keyboard targets in their own viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    await harness(page);
    const copy = page.getByRole("button", {
      name: `Copy exact mint for SAME, ${mint}`,
      exact: true,
    });
    expect((await copy.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const input = page.getByRole("textbox", { name: "Search sampled tokens" });
    await input.fill(otherMint);
    await page.keyboard.press("Tab");
    const clear = page.getByRole("button", {
      name: "Clear search",
      exact: true,
    });
    await expect(clear).toBeFocused();
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const open = page.getByRole("button", {
      name: "View exact mint",
      exact: true,
    });
    await open.focus();
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");
    expect((await state(page)).selected[0].mint).toBe(otherMint);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
