import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
let script: string, css: string;
const origin = "http://127.0.0.1:43227";
const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const mintB = "So11111111111111111111111111111111111111112";
type FixtureState = {
  selected: { mint: string }[];
  queries: Record<string, unknown>[];
  actions: string[];
  nextAt: number | null;
  advance(ms: number): void;
  setQueryLoading(value: boolean): void;
  setPanel(value: "visible" | "hidden" | "unmounted"): void;
};
declare global {
  interface Window {
    __sampleUsability: FixtureState;
    __sampleCopied: string[];
    __viewMutations: number;
    __freshFocusCalls: { preventScroll?: boolean }[];
  }
}
const state = (page: Page) => page.evaluate(() => window.__sampleUsability);
const audit = new WeakMap<Page, { errors: string[]; network: string[] }>();
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/market-sample-usability.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"sample-usability-only",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/market-sample-usability-state.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});
async function harness(page: Page, scenario = "") {
  const record = { errors: [] as string[], network: [] as string[] };
  audit.set(page, record);
  page.on("pageerror", (error) => record.errors.push(error.message));
  await page.addInitScript(() => {
    window.__sampleCopied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.__sampleCopied.push(value);
        },
      },
    });
  });
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
    record.network.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?scenario=${scenario}`);
  await expect.poll(async () => (await state(page)).actions.length).toBe(1);
}
test.afterEach(async ({ page }) => {
  const record = audit.get(page);
  if (record) {
    expect(record.errors).toEqual([]);
    expect(record.network).toEqual([]);
  }
  expect((await state(page)).actions).toEqual(["forumTerminalRefresh:refresh"]);
  for (const args of (await state(page)).queries)
    expect(Object.keys(args).sort()).toEqual(
      args.platform
        ? ["band", "limit", "now", "platform"]
        : ["band", "limit", "now"],
    );
});
const fresh = (page: Page) =>
  page.getByRole("button", { name: "Fresh market rows only", exact: true });
const announcement = (page: Page) =>
  page.getByRole("status", { name: "Market view updates", exact: true });
const table = (page: Page) =>
  page.getByRole("table", { name: "Sampled markets", exact: true });
test("fresh filter excludes stale and unknown market observations but not fresh markets with old holders", async ({
  page,
}) => {
  await harness(page);
  await expect(fresh(page)).toBeVisible();
  await fresh(page).click();
  await expect(table(page).locator("tbody tr")).toHaveCount(2);
  await expect(
    page.getByRole("button", {
      name: `Copy exact mint for SAME, ${mintA}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `Copy exact mint for SAME, ${mintB}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Sample context" }),
  ).toContainText("3 excluded");
  await page.getByText("Coverage & sources", { exact: true }).click();
  await expect(
    page.getByText(/2 fresh, 1 stale, 2 unavailable or undated/),
  ).toBeVisible();
  await expect(
    page.getByText(/Holder age does not decide this filter/),
  ).toBeVisible();
  expect((await state(page)).queries).toHaveLength(1);
});
test("only deliberate controls announce counts and sorting; an age transition stays silent", async ({
  page,
}) => {
  await harness(page);
  await fresh(page).click();
  await expect(announcement(page)).toHaveText(
    "2 sampled tokens · 1h volume descending.",
  );
  await page
    .getByRole("combobox", { name: "Sort sampled tokens" })
    .selectOption("price:asc");
  await expect(announcement(page)).toHaveText(
    "2 sampled tokens · Price ascending.",
  );
  const description = await fresh(page).getAttribute("aria-describedby");
  const helpText = await page.locator(`[id="${description}"]`).textContent();
  await page.evaluate(() => {
    window.__viewMutations = 0;
    new MutationObserver(() => window.__viewMutations++).observe(
      document.querySelector('[aria-label="Market view updates"]')!,
      { subtree: true, childList: true, characterData: true },
    );
    window.__sampleUsability.advance(120000);
  });
  await expect(table(page).locator("tbody tr")).toHaveCount(1);
  await expect(announcement(page)).toHaveText(
    "2 sampled tokens · Price ascending.",
  );
  expect(await page.evaluate(() => window.__viewMutations)).toBe(0);
  expect(await page.locator(`[id="${description}"]`).textContent()).toBe(
    helpText,
  );
  await expect(
    page.getByRole("group", { name: "Sample context" }),
  ).toContainText("1 token");
  expect((await state(page)).queries).toHaveLength(2);
});
test("a focused row aging out returns keyboard focus to the visible fresh filter", async ({
  page,
}) => {
  await harness(page);
  await fresh(page).click();
  await page
    .getByRole("button", {
      name: "Copy exact mint for SAME, MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      exact: true,
    })
    .focus();
  await page.evaluate(() => window.__sampleUsability.advance(120000));
  await expect(table(page).locator("tbody tr")).toHaveCount(1);
  await expect(fresh(page)).toBeFocused();
});
for (const lifecycle of ["hidden", "unmounted"] as const)
  test(`${lifecycle} panel never steals focus during row cleanup`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__freshFocusCalls = [];
      const focus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (options) {
        if (this.getAttribute("aria-label") === "Fresh market rows only")
          window.__freshFocusCalls.push(options ?? {});
        focus.call(this, options);
      };
    });
    await harness(page);
    await fresh(page).click();
    await page
      .getByRole("button", {
        name: "Copy exact mint for SAME, MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
        exact: true,
      })
      .focus();
    const baseline = await page.evaluate(() => window.__freshFocusCalls.length);
    await page.evaluate(
      (lifecycle) => window.__sampleUsability.setPanel(lifecycle),
      lifecycle,
    );
    await expect(
      page.locator('[aria-label="Fresh market rows only"]'),
    ).toBeHidden();
    if (lifecycle === "hidden")
      await page.evaluate(() => window.__sampleUsability.advance(120000));
    expect(await page.evaluate(() => window.__freshFocusCalls.length)).toBe(
      baseline,
    );
  });
test("a deliberate query-filter change announces its loaded result once, not a guessed count", async ({
  page,
}) => {
  await harness(page);
  await expect(announcement(page)).toBeEmpty();
  await page.evaluate(() => window.__sampleUsability.setQueryLoading(true));
  await page
    .getByRole("combobox", { name: "Market cap", exact: true })
    .selectOption("under50k");
  await expect(announcement(page)).toHaveText("Updating sampled results…");
  await page.evaluate(() => window.__sampleUsability.setQueryLoading(false));
  await expect(announcement(page)).toHaveText(
    "2 sampled tokens · 1h volume descending.",
  );
  expect((await state(page)).queries).toHaveLength(2);
});
test("an all-excluded view can reset only local filters without fetching a new sample", async ({
  page,
}) => {
  await harness(page);
  await fresh(page).click();
  await page.evaluate(() => window.__sampleUsability.advance(3600000));
  await expect(table(page)).toBeHidden();
  await expect(
    page.getByRole("group", { name: "Sample context" }),
  ).toContainText("5 excluded");
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(fresh(page)).toHaveAttribute("aria-pressed", "false");
  await expect(table(page).locator("tbody tr")).toHaveCount(5);
  expect((await state(page)).queries).toHaveLength(2);
});
test("existing exact-mint, clear-only search, filter/sort and copy remain local", async ({
  page,
}) => {
  await harness(page);
  await fresh(page).click();
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
  await input.fill(mintA);
  await page
    .getByRole("button", {
      name: `Copy exact mint for SAME, ${mintA}`,
      exact: true,
    })
    .click();
  expect(await page.evaluate(() => window.__sampleCopied)).toEqual([mintA]);
  expect((await state(page)).selected).toEqual([]);
  const different = `${mintA.slice(0, -1)}V`;
  await input.fill(different);
  await expect(
    page.getByRole("button", { name: /^View SAME, mint/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "View exact mint", exact: true })
    .click();
  expect((await state(page)).selected[0].mint).toBe(different);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  await expect(fresh(page)).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("combobox", { name: "Market cap", exact: true }),
  ).toHaveValue("under50k");
  await expect(
    page.getByRole("combobox", { name: "Platform", exact: true }),
  ).toHaveValue("pumpfun");
  await expect(
    page.getByRole("combobox", { name: "Sort sampled tokens" }),
  ).toHaveValue("price:asc");
  expect((await state(page)).queries).toHaveLength(3);
});
for (const scenario of ["budget", "deferred", "loading", "invalid"])
  test(`${scenario} server eligibility is disclosed without promising or accelerating a check`, async ({
    page,
  }) => {
    await harness(page, scenario);
    await page.getByText("Coverage & sources", { exact: true }).click();
    if (scenario === "invalid")
      await expect(
        page.getByText("Server eligibility time unavailable.", {
          exact: false,
        }),
      ).toBeVisible();
    else {
      const iso = new Date((await state(page)).nextAt!).toISOString();
      await expect(page.locator(`time[datetime="${iso}"]`)).toBeVisible();
    }
    await expect(
      page.getByText(/Eligibility is not a scheduled or guaranteed refresh/),
    ).toBeVisible();
    const expected =
      scenario === "budget"
        ? /Free-data allowance reached/
        : scenario === "deferred"
          ? /Waiting for shared data window/
          : scenario === "loading"
            ? /Shared refresh in progress/
            : /Shared cache/;
    await expect(
      page.getByRole("status").filter({ hasText: expected }),
    ).toBeVisible();
  });
test("duplicate symbols expose full original mints in source names and preserve their URLs", async ({
  page,
}) => {
  await harness(page);
  for (const [mint, host] of [
    [mintA, "pool"],
    [mintB, "source"],
  ]) {
    const source = page.getByRole("link", {
      name: `View SAME source, mint ${mint}`,
      exact: true,
    });
    await expect(source).toHaveCount(1);
    await expect(source).toHaveAttribute(
      "href",
      `https://${host}.example.test/${mint}`,
    );
  }
});
for (const width of [320, 390])
  test(`${width}px fresh filter has a 44px keyboard target and bounded local scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    await harness(page);
    await fresh(page).focus();
    await expect(fresh(page)).toBeFocused();
    const box = await fresh(page).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Space");
    await expect(fresh(page)).toHaveAttribute("aria-pressed", "true");
    await expect(table(page).locator("tbody tr")).toHaveCount(2);
    await page.getByText("Coverage & sources", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(/Holder age does not decide this filter/),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await state(page)).queries).toHaveLength(1);
  });
