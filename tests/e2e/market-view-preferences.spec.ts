import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
import { MARKET_VIEW_STORAGE_KEY } from "../../components/trading/market-view-preferences";

const origin = "http://127.0.0.1:43260";
const saved = {
  version: 1,
  band: "50k100k",
  platform: "pumpfun",
  freshOnly: true,
  sortKey: "price",
  sortDirection: "asc",
};
declare global {
  interface Window {
    viewStorage: {
      calls: string[];
      bytes(): string | null;
      seed(raw: string): void;
    };
  }
}
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
    process.env.MARKET_PREFERENCES_BASELINE === "1"
      ? execFileSync(
          "git",
          ["show", "37b8a13a:components/trading/market-explorer.tsx"],
          { encoding: "utf8" },
        )
      : null;
  script = execFileSync(
    "bun",
    [
      "-e",
      `const baseline=${JSON.stringify(baseline)};const r=await Bun.build({entrypoints:["tests/e2e/fixtures/market-view-preferences.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"inert-public-reads",setup(build){if(baseline)build.onLoad({filter:/market-explorer\\.tsx$/},()=>({contents:baseline,loader:"tsx"}));build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/market-view-preferences-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));for(const f of r.outputs){if(f.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await f.text())+"}));");else if(f.path.endsWith(".js"))process.stdout.write(await f.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function open(
  page: Page,
  options: { raw?: string; mode?: string; app?: string; native?: boolean } = {},
) {
  const errors: string[] = [],
    network: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, raw, mode }) => {
      const storage = window.localStorage;
      const get = storage.getItem.bind(storage),
        set = storage.setItem.bind(storage),
        remove = storage.removeItem.bind(storage);
      if (raw !== undefined) set(key, raw);
      const calls: string[] = [];
      window.viewStorage = {
        calls,
        bytes: () => get(key),
        seed: (value) => set(key, value),
      };
      Storage.prototype.getItem = function (name) {
        if (name === key) {
          calls.push("get");
          if (mode === "read-fail") throw Error("private details");
        }
        return get(name);
      };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) {
          calls.push("set");
          if (mode === "write-fail") throw Error("private details");
        }
        set(name, value);
      };
      Storage.prototype.removeItem = function (name) {
        if (name === key) {
          calls.push("remove");
          if (mode === "remove-fail") throw Error("private details");
        }
        remove(name);
      };
      window.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as unknown as typeof IntersectionObserver;
      if (mode === "getter-fail")
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new DOMException("Unavailable", "SecurityError");
          },
        });
    },
    { key: MARKET_VIEW_STORAGE_KEY, raw: options.raw, mode: options.mode },
  );
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[options.app ?? "platform"]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (
      url.origin === origin &&
      url.pathname === "/images/brand/symforum-icon-64.png"
    )
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      });
    network.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/${options.native ? "?native" : ""}`);
  await expect
    .poll(() => page.evaluate(() => window.marketPreferences.queries.length))
    .toBe(1);
  return async () => {
    expect(errors).toEqual([]);
    expect(network).toEqual([]);
    expect(
      await page.evaluate(() => window.marketPreferences.forbidden),
    ).toEqual([]);
    expect(
      await page.evaluate(() => window.marketPreferences.selected),
    ).toEqual([]);
    expect(await page.evaluate(() => window.marketPreferences.mounts)).toBe(1);
  };
}
const search = (page: Page) =>
  page.getByRole("textbox", { name: "Search sampled tokens" });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function settings(page: Page) {
  await page.getByText("Coverage & sources", { exact: true }).click();
  const summary = page.getByText("Saved market view", { exact: true });
  await expect(summary.locator("..")).not.toHaveAttribute("open", "");
  await summary.focus();
  await summary.press("Enter");
}
test("stored public view never reads or applies on mount; explicit restore preserves search and selection", async ({
  page,
}) => {
  const check = await open(page, { raw: JSON.stringify(saved) });
  expect(await page.evaluate(() => window.viewStorage.calls)).toEqual([]);
  await expect(
    page.getByRole("combobox", { name: "Market cap", exact: true }),
  ).toHaveValue("all");
  await expect(
    page.getByRole("combobox", { name: "Sort sampled tokens" }),
  ).toHaveValue("volume1h:desc");
  await search(page).fill("TEST");
  await settings(page);
  expect(await page.evaluate(() => window.viewStorage.calls)).toEqual([]);
  await button(page, "Restore saved view").click();
  await expect(
    page.getByRole("combobox", { name: "Market cap", exact: true }),
  ).toHaveValue("50k100k");
  await expect(
    page.getByRole("combobox", { name: "Platform", exact: true }),
  ).toHaveValue("pumpfun");
  await expect(
    page.getByRole("combobox", { name: "Sort sampled tokens" }),
  ).toHaveValue("price:asc");
  await expect(button(page, "Fresh market rows only")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(search(page)).toHaveValue("TEST");
  await expect
    .poll(() => page.evaluate(() => window.marketPreferences.queries.length))
    .toBe(2);
  expect(
    await page.evaluate(() => window.marketPreferences.queries[1]),
  ).toEqual({
    band: "50k100k",
    platform: "pumpfun",
    now: 1_800_000_000_000,
    limit: 60,
  });
  expect(await page.evaluate(() => window.viewStorage.calls)).toEqual(["get"]);
  await check();
});
test("explicit save stores only bounded public controls; forget neither resets nor fetches", async ({
  page,
}) => {
  const check = await open(page);
  await search(page).fill("private-looking-search-not-saved");
  await page
    .getByRole("combobox", { name: "Sort sampled tokens" })
    .selectOption("holders:asc");
  await settings(page);
  await button(page, "Save view on this device").click();
  expect(
    JSON.parse((await page.evaluate(() => window.viewStorage.bytes()))!),
  ).toEqual({
    version: 1,
    band: "all",
    platform: "all",
    freshOnly: false,
    sortKey: "holders",
    sortDirection: "asc",
  });
  expect(
    await page.evaluate(() => window.marketPreferences.queries.length),
  ).toBe(1);
  await button(page, "Forget saved view").click();
  expect(await page.evaluate(() => window.viewStorage.bytes())).toBeNull();
  await expect(search(page)).toHaveValue("private-looking-search-not-saved");
  await expect(
    page.getByRole("combobox", { name: "Sort sampled tokens" }),
  ).toHaveValue("holders:asc");
  expect(
    await page.evaluate(() => window.marketPreferences.queries.length),
  ).toBe(1);
  await check();
});
for (const raw of [
  JSON.stringify({ ...saved, version: 2 }),
  "{broken",
  JSON.stringify({ ...saved, wallet: "must-not-apply" }),
])
  test(`unrecognized record remains untouched: ${raw}`, async ({ page }) => {
    const check = await open(page, { raw });
    await settings(page);
    for (const name of [
      "Restore saved view",
      "Save view on this device",
      "Forget saved view",
    ])
      await button(page, name).click();
    expect(await page.evaluate(() => window.viewStorage.bytes())).toBe(raw);
    expect(await page.evaluate(() => window.viewStorage.calls)).toEqual([
      "get",
      "get",
      "get",
    ]);
    await expect(
      page.getByText("This saved view is unrecognized or unreadable.", {
        exact: false,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => window.marketPreferences.queries.length),
    ).toBe(1);
    await check();
  });
for (const mode of ["read-fail", "write-fail", "remove-fail", "getter-fail"])
  test(`${mode}: storage denial gives safe failure without applying a view`, async ({
    page,
  }) => {
    const check = await open(page, { mode, raw: JSON.stringify(saved) });
    await settings(page);
    await button(
      page,
      mode === "remove-fail" ? "Forget saved view" : "Save view on this device",
    ).click();
    await expect(
      page.getByText(
        "Device storage is unavailable. No saved view was applied.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Market cap", exact: true }),
    ).toHaveValue("all");
    expect(
      await page.evaluate(() => window.marketPreferences.queries.length),
    ).toBe(1);
    await check();
  });
test("native host exposes no local storage authority and performs no storage calls", async ({
  page,
}) => {
  const check = await open(page, { native: true, raw: JSON.stringify(saved) });
  await settings(page);
  for (const name of [
    "Save view on this device",
    "Restore saved view",
    "Forget saved view",
  ])
    await expect(button(page, name)).toBeDisabled();
  expect(await page.evaluate(() => window.viewStorage.calls)).toEqual([]);
  await check();
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}: closed defaults stay compact; explicit controls fit and are keyboard reachable`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await open(page, { app });
      await expect(
        page.getByText("Saved market view", { exact: true }),
      ).toBeHidden();
      await settings(page);
      for (const name of [
        "Save view on this device",
        "Restore saved view",
        "Forget saved view",
      ]) {
        const control = button(page, name);
        await control.scrollIntoViewIfNeeded();
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.height).toBeGreaterThanOrEqual(44);
        await control.focus();
        await expect(control).toBeFocused();
      }
      await button(page, "Restore saved view").press("Enter");
      await expect(
        page.getByText("No saved market view on this device.", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => window.marketPreferences.queries.length),
      ).toBe(1);
      await check();
    });
