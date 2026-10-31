import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const mint = "So11111111111111111111111111111111111111112";
const first = Date.parse("2020-12-31T23:45:00Z") / 1000;
const origin = "http://127.0.0.1:43223";
let script: string;
let css: string;
type Audit = { errors: string[]; unexpected: string[]; charts: number };
const audits = new WeakMap<Page, Audit>();

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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/candle-readings.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env.NODE_ENV":JSON.stringify("production")}});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});

async function harness(
  page: Page,
  source = "solana-tracker",
  missingVolume = false,
) {
  const audit: Audit = { errors: [], unexpected: [], charts: 0 };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (url.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
      if (url.pathname === `/api/token/${mint}/chart`) {
        audit.charts++;
        return route.fulfill({
          json: {
            mint,
            pool: "11111111111111111111111111111111",
            interval: url.searchParams.get("interval"),
            checkedAt: Date.now(),
            candleSource: source,
            candles: Array.from({ length: 35 }, (_, index) => ({
              time: first + index * 900 + (index >= 20 ? 86400 : 0),
              open: 1,
              high: 2,
              low: 0.5,
              close: 1.5,
              ...(missingVolume && index === 34
                ? {}
                : { volume: index === 34 ? 0 : 1234.125 }),
            })),
          },
        });
      }
    }
    audit.unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(origin);
  return audit;
}
test.afterEach(({ page }) => {
  const audit = audits.get(page);
  if (audit) {
    expect(audit.errors).toEqual([]);
    expect(audit.unexpected).toEqual([]);
  }
});

for (const source of ["solana-tracker", "geckoterminal"]) {
  test(`${source} readings distinguish historical sparse coverage from a recent source check`, async ({
    page,
  }) => {
    const audit = await harness(page, source);
    await page.getByText("Read candle data", { exact: true }).click();
    const region = page.getByRole("region", {
      name: "Recent candle data",
      exact: true,
    });
    await expect(region).toContainText("Loaded 35 bars · showing latest 20.");
    await expect(region).toContainText("2020-12-31 23:45");
    await expect(region).toContainText("2021-01-02 08:15");
    await expect(region).toContainText(
      "Checked time dates the source check, not each bar.",
    );
    await expect(region).toContainText(
      "Returned bars may be sparse. Prices USD; volume unit unknown.",
    );
    await expect(
      region.getByRole("columnheader", { name: "Source volume" }),
    ).toBeVisible();
    await expect(region.locator("tbody tr")).toHaveCount(20);
    const latest = region.locator("tbody tr").first();
    await expect(latest.locator("time")).toHaveAttribute(
      "datetime",
      "2021-01-02T08:15:00.000Z",
    );
    await expect(latest).toContainText("2021-01-02 08:15:00 UTC");
    await expect(latest.getByRole("cell").last()).toHaveText("0");
    await page.getByText("Read candle data", { exact: true }).click();
    await page.getByText("Read candle data", { exact: true }).click();
    expect(audit.charts).toBe(1);
  });
}

test("a missing source volume still fails existing chart validation rather than inventing zero", async ({
  page,
}) => {
  const audit = await harness(page, "solana-tracker", true);
  await expect(page.getByRole("status")).toContainText(
    "Chart source is temporarily unavailable.",
  );
  await expect(page.getByText("Read candle data", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(audit.charts).toBe(1);
});

for (const width of [320, 390]) {
  test(`${width}px keyboard readings scroll locally without expanding the chart viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    const audit = await harness(page);
    const summary = page.getByText("Read candle data", { exact: true });
    await expect(summary).toBeVisible();
    const canvas = page.getByRole("img", { name: /FIXTURE/ });
    const before = await canvas.boundingBox();
    await summary.focus();
    await page.keyboard.press("Enter");
    const outer = page.getByRole("region", {
      name: "Recent candle data",
      exact: true,
    });
    const scroll = page.getByRole("region", {
      name: "Scrollable candle readings",
      exact: true,
    });
    await page.keyboard.press("Tab");
    await expect(outer).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(scroll).toBeFocused();
    expect(
      await outer.evaluate((node) => getComputedStyle(node).overflowY),
    ).toBe("visible");
    expect(
      await scroll.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(0);
    await scroll.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    const heading = await scroll
      .getByRole("columnheader", { name: "Source volume" })
      .boundingBox();
    const bounds = await scroll.boundingBox();
    expect(heading!.x + heading!.width).toBeLessThanOrEqual(
      bounds!.x + bounds!.width + 1,
    );
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "After candle readings" }),
    ).toBeFocused();
    const after = await canvas.boundingBox();
    expect(after!.height).toBe(before!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(audit.charts).toBe(1);
  });
}
