import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
import type { ChartMarketData } from "../../components/trading/price-chart-data";
const origin = "http://127.0.0.1:43231";
const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  mintB = "So11111111111111111111111111111111111111112";
const now = Date.parse("2026-10-31T12:00:00Z");
declare global {
  interface Window {
    __retainedStats: {
      update(value: {
        mint?: string;
        index?: "absent" | "loading" | "present" | "wrong";
        snapshot?: ChartMarketData;
      }): void;
      late(data: ChartMarketData): void;
      current(): ChartMarketData;
      reads: string[];
      forbidden: string[];
    };
  }
}
let script: string;
const css = {} as Record<"platform" | "forum", string>;
test.beforeAll(() => {
  const baseline =
    process.env.RETAINED_STATS_BASELINE === "1"
      ? execFileSync(
          "git",
          ["show", "ef77a017:components/trading/token-detail.tsx"],
          { encoding: "utf8" },
        )
      : null;
  for (const app of ["platform", "forum"] as const)
    css[app] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { cwd: `apps/${app}`, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const baseline=${JSON.stringify(baseline)};const result=await Bun.build({entrypoints:["tests/e2e/fixtures/retained-token-stats.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"inert-chart",setup(build){if(baseline!==null)build.onLoad({filter:/token-detail\\.tsx$/},()=>({contents:baseline,loader:"tsx"}));build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^\\.\\/price-chart$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/retained-token-stats-state.tsx"}));}}]});if(!result.success)throw Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});
async function harness(page: Page, app: "platform" | "forum" = "platform") {
  const errors: string[] = [],
    outbound: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    outbound.push(url.href);
    return route.abort();
  });
  await page.goto(origin);
  await expect(
    page.getByText("Stale chart market data", { exact: false }),
  ).toBeVisible();
  return { errors, outbound };
}
async function open(page: Page) {
  await page.getByText("Market details & sources", { exact: true }).click();
  await page
    .getByText("Inspect values & observation times", { exact: true })
    .click();
}
const reading = (page: Page, name: string) =>
  page.getByRole("listitem", { name: `${name} reading`, exact: true });
test("retained exact-mint values are explicitly stale with original time, never hourly/candle/provider invention", async ({
  page,
}) => {
  const audit = await harness(page);
  const readsBefore = await page.evaluate(
    () => window.__retainedStats.reads.length,
  );
  await open(page);
  expect(await page.evaluate(() => window.__retainedStats.reads.length)).toBe(
    readsBefore,
  );
  for (const [name, value] of [
    ["Price", "2 USD"],
    ["Market cap", "123 USD"],
    ["Liquidity", "456 USD"],
    ["24h volume", "789 USD"],
  ]) {
    await expect(reading(page, name)).toContainText(value);
    await expect(reading(page, name)).toContainText("Stale sample");
    await expect(reading(page, name).locator("time")).toHaveAttribute(
      "datetime",
      "2026-10-31T11:54:00.000Z",
    );
  }
  await expect(reading(page, "1h change")).toContainText("Unavailable");
  await expect(reading(page, "FDV")).toContainText("Unavailable");
  await expect(reading(page, "Price")).toContainText("provider not supplied");
  expect(audit).toEqual({ errors: [], outbound: [] });
});
test("callback freshness uses the exact five-minute boundary without renewing observation time", async ({
  page,
}) => {
  await harness(page);
  await open(page);
  for (const age of [179999, 180001, 299999, 300000, 360000, 86400000, -1]) {
    await page.evaluate(
      ({ age, now }) =>
        window.__retainedStats.update({
          snapshot: {
            ...window.__retainedStats.current(),
            checkedAt: now - age,
            stale: false,
            priceUsd: 2,
          },
        }),
      { age, now },
    );
    if (age < 0 || age >= 86400000) {
      await expect(reading(page, "Price")).toContainText("Unavailable");
    } else {
      await expect(reading(page, "Price")).toContainText("2 USD");
      await expect(reading(page, "Price").locator("time")).toHaveAttribute(
        "datetime",
        new Date(now - age).toISOString(),
      );
      if (age >= 300000)
        await expect(reading(page, "Price")).toContainText("Stale sample");
      else
        await expect(reading(page, "Price")).not.toContainText("Stale sample");
    }
  }
});
test("loading/wrong index cannot authorize retained values; present index wins; latest nulls and clear win", async ({
  page,
}) => {
  await harness(page);
  await open(page);
  for (const index of ["loading", "wrong", "present"] as const) {
    await page.evaluate(
      (index) => window.__retainedStats.update({ index }),
      index,
    );
    await expect(reading(page, "Price")).toContainText(
      index === "present" ? "8 USD" : "Unavailable",
    );
  }
  await page.evaluate(() =>
    window.__retainedStats.update({
      index: "absent",
      snapshot: {
        ...window.__retainedStats.current(),
        priceUsd: 0,
        stats: { marketCap: 0, liquidity: 0, volume24h: 0, fdv: 0 },
      },
    }),
  );
  await expect(reading(page, "Price")).toContainText("0 USD");
  await page.evaluate(() =>
    window.__retainedStats.update({
      snapshot: {
        ...window.__retainedStats.current(),
        priceUsd: null,
        stats: null,
      },
    }),
  );
  await expect(reading(page, "Price")).toContainText("Unavailable");
  await expect(reading(page, "Market cap")).toContainText("Unavailable");
  await page.evaluate(() =>
    window.__retainedStats.update({
      snapshot: {
        ...window.__retainedStats.current(),
        checkedAt: 1,
        priceUsd: null,
        stats: null,
      },
    }),
  );
  await expect(
    page.getByText("Stale chart market data", { exact: false }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.__retainedStats.forbidden)).toEqual(
    [],
  );
});
test("wrong mint and ABA late old callbacks cannot resurrect stale values", async ({
  page,
}) => {
  await harness(page);
  await open(page);
  await page.evaluate((mint) => window.__retainedStats.update({ mint }), mintB);
  await expect(reading(page, "Price")).toContainText("Unavailable");
  await page.evaluate(
    (mint) =>
      window.__retainedStats.update({
        mint,
        snapshot: {
          ...window.__retainedStats.current(),
          priceUsd: null,
          stats: null,
        },
      }),
    mintA,
  );
  await page.evaluate(() =>
    window.__retainedStats.late({
      ...window.__retainedStats.current(),
      priceUsd: 999,
    }),
  );
  await expect(reading(page, "Price")).toContainText("Unavailable");
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width} retains bounded readable status and keyboard disclosures`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const audit = await harness(page, app);
      await open(page);
      await expect(reading(page, "Price")).toContainText("Stale sample");
      const bounds = await page.locator("main>section").boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page
        .getByText("Inspect values & observation times", { exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(reading(page, "Price")).not.toBeVisible();
      expect(audit).toEqual({ errors: [], outbound: [] });
    });
