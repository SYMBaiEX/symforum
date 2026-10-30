import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const NOVA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

let script: string;
let css: string;
test.beforeAll(() => {
  css =
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/terminal.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"isolated-terminal",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/terminal-convex.ts"}));build.onResolve({filter:/^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/identity-navigation.ts"}));build.onResolve({filter:/commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/terminal-wallet.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});

async function harness(page: Page, scenario = "") {
  const errors: string[] = [];
  const chartMints: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:43211") return route.abort();
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    const mint = url.pathname.match(/^\/api\/token\/([^/]+)\/chart$/)?.[1];
    if (mint) {
      chartMints.push(mint);
      const now = Date.now();
      return route.fulfill({
        json: {
          mint: scenario.includes("wrongchart") ? NOVA_MINT : mint,
          pool: "11111111111111111111111111111111",
          interval: url.searchParams.get("interval"),
          checkedAt: now,
          priceUsd: 0.0015,
          stats: {
            marketCap: null,
            fdv: 1_000_000,
            liquidity: 20_000,
            volume24h: 50_000,
          },
          candles: [
            {
              time: Math.floor(now / 1000) - 60,
              open: 0.001,
              high: 0.002,
              low: 0.0005,
              close: 0.0015,
              volume: 100,
            },
          ],
        },
      });
    }
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43211/?${scenario}`);
  return { errors, chartMints };
}

async function sampleSymbols(page: Page) {
  return page
    .getByRole("table", { name: "Sampled markets", exact: true })
    .getByRole("button", { name: /^View / })
    .evaluateAll((buttons) =>
      buttons.map(
        (button) =>
          (button.getAttribute("aria-label") ?? "")
            .replace(/^View /, "")
            .split(",")[0],
      ),
    );
}

async function expectCompactChart(page: Page, narrow: boolean) {
  const canvas = page.getByRole("img", { name: /SYMF USD candlestick chart/ });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(narrow ? 256 : 380);
  expect(box!.height).toBeLessThanOrEqual(narrow ? 280 : 420);
  const close = page
    .locator("#terminal-chart p")
    .filter({ hasText: /^Close / });
  await expect(close).toHaveCount(1);
  const quoteStyle = await close.evaluate((element) => ({
    size: parseFloat(getComputedStyle(element).fontSize),
    weight: Number(getComputedStyle(element).fontWeight),
  }));
  // Only the asset price is emphasized; candle close is compact context.
  expect(quoteStyle.size).toBeLessThanOrEqual(12);
  expect(quoteStyle.weight).toBeLessThanOrEqual(500);
  const tabs = await page
    .getByRole("tablist", { name: "Terminal views" })
    .boundingBox();
  const heading = await page
    .getByRole("heading", { name: "Trading terminal", exact: true })
    .boundingBox();
  expect(tabs).not.toBeNull();
  expect(heading!.y + heading!.height / 2).toBeGreaterThanOrEqual(tabs!.y);
  expect(heading!.y + heading!.height / 2).toBeLessThanOrEqual(
    tabs!.y + tabs!.height,
  );
  if (!narrow) {
    const intervals = await page
      .getByRole("group", { name: "Candle interval" })
      .boundingBox();
    const checked = await page
      .locator("#terminal-chart p[title^='Checked ']")
      .boundingBox();
    expect(checked).not.toBeNull();
    expect(checked!.y + checked!.height / 2).toBeGreaterThanOrEqual(
      intervals!.y,
    );
    expect(checked!.y + checked!.height / 2).toBeLessThanOrEqual(
      intervals!.y + intervals!.height,
    );
  }
}

test("saved research receipt can finalize after reload without repeating settlement", async ({
  page,
}) => {
  const { errors } = await harness(page, "research");
  await expect(
    page.getByRole("button", { name: "Payment receipt protected" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Verify saved receipt" })
    .first()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Finalized receipt verified" }),
  ).toBeVisible();
  await page
    .getByText("Your recent research receipts", { exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open report + receipt" }),
  ).toHaveAttribute("href", `/api/research/token/${"a".repeat(64)}`);
  await expect(
    page.getByRole("button", { name: "Review research export" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

for (const width of [390, 1440])
  test(`terminal fits ${width}px and filters actual market cap`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors, chartMints } = await harness(page, "guest");
    await expect(
      page.getByRole("heading", { name: "Trading terminal", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /SYMF USD candlestick chart/ }),
    ).toBeVisible();
    await expectCompactChart(page, width === 390);
    const chartBox = await page
      .getByRole("img", { name: /SYMF USD candlestick chart/ })
      .boundingBox();
    expect(chartBox?.y).toBeLessThanOrEqual(width === 390 ? 380 : 300);
    if (width === 1440) expect(chartBox?.width).toBeGreaterThan(800);
    await page.screenshot({
      path: `tmp/forum-render-tests/terminal-workspace-${width}.png`,
    });
    await page.getByRole("tab", { name: "Markets", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Market cap", exact: true })
      .selectOption("500k1m");
    await expect(page.getByRole("button", { name: /View NOVA/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /View SYMF/ })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: /View NOVA/ }).click();
    await expect(
      page.getByRole("heading", { name: "$NOVA", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "$SYMF", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("#terminal-token-title")).toHaveCount(1);
    await expect(page.getByText(/1h change is a stale sample/)).toBeVisible();
    await expect(
      page.getByRole("img", { name: /NOVA USD candlestick chart/ }),
    ).toBeVisible();
    await page.getByText("Market details & sources", { exact: true }).click();
    await expect(page.getByText(/Stale sampled metrics\./)).toBeVisible();
    const selectedToken = page.getByRole("region").filter({
      has: page.getByRole("heading", { name: "$NOVA", exact: true }),
    });
    await expect(
      selectedToken
        .locator("dt")
        .filter({ hasText: /^Market cap$/ })
        .locator("..")
        .locator("dd"),
    ).toHaveText("Unavailable");
    await expect(
      selectedToken
        .locator("dt")
        .filter({ hasText: /^FDV$/ })
        .locator("..")
        .locator("dd"),
    ).toHaveText("$1M");
    for (const label of [
      "Price",
      "Market cap",
      "Liquidity",
      "1h volume",
      "FDV",
      "Holders",
      "24h volume",
      "1h change",
    ])
      await expect(
        selectedToken
          .locator("dt")
          .filter({ hasText: new RegExp(`^${label}(?:\\s|$)`) }),
      ).toHaveCount(1);
    expect(chartMints).toContain(NOVA_MINT);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `tmp/forum-render-tests/terminal-${width}.png`,
      fullPage: true,
    });
  });

test("private watch updates preserve saved thresholds and protected swaps stay protected", async ({
  page,
}) => {
  const { errors } = await harness(page, "held");
  await page.getByLabel("Alert above, USD").fill(".5");
  await page.getByRole("button", { name: "Watch token", exact: true }).click();
  await expect(page.getByText(/Saved thresholds: above \$0.50/)).toBeVisible();
  await page.getByLabel("Alert above, USD").fill("");
  await page.getByRole("button", { name: "Update watch", exact: true }).click();
  await expect(page.getByText(/Saved thresholds: above \$0.50/)).toBeVisible();
  await expect(
    page.getByText("Outcome protected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No signature recorded", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /repeat|replay|resend/i }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("native host does not initialize wallet or market transport", async ({
  page,
}) => {
  const { errors, chartMints } = await harness(page, "plugin");
  await expect(
    page.getByRole("link", { name: "Open the trading terminal" }),
  ).toHaveAttribute("href", /\/trade$/);
  await expect(
    page.getByRole("button", { name: "Sign in with wallet" }),
  ).toHaveCount(0);
  expect(chartMints).toEqual([]);
  expect(errors).toEqual([]);
});

test("old mint facts remain explicitly dated rather than current safety claims", async ({
  page,
}) => {
  const { errors } = await harness(page, "guest&stalerisk");
  await page.locator("summary").filter({ hasText: "Mint facts" }).click();
  await expect(
    page.getByText("These mint facts are stale.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Not set at check", { exact: true })).toHaveCount(
    2,
  );
  await expect(page.getByText("Revoked", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("mobile markets is an accessible view and trade remains one tap away", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await harness(page, "guest");
  const markets = page.getByRole("tab", { name: "Markets", exact: true });
  const chart = page.getByRole("tab", { name: "Chart", exact: true });
  await expect(markets).toHaveAttribute("aria-selected", "false");
  await expect(page.getByLabel("Search sampled tokens")).toBeHidden();
  const trade = page.getByRole("link", { name: /^Trade/ });
  await expect(trade).toHaveAttribute("href", "#terminal-order");
  const box = await trade.boundingBox();
  expect(box?.y).toBeLessThan(844);
  await trade.click();
  const order = page.getByRole("complementary", {
    name: "Trade selected token",
  });
  await expect(order).toBeFocused();
  expect((await order.boundingBox())?.y).toBeLessThan(844);
  await markets.focus();
  await page.keyboard.press("Enter");
  await expect(markets).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Search sampled tokens")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(markets).toHaveAttribute("aria-selected", "false");
  await expect(chart).toBeFocused();
  await expect(page.getByLabel("Search sampled tokens")).toBeHidden();
  expect(errors).toEqual([]);
});

test("market search text clears its search icon and empty filters remain honest", async ({
  page,
}) => {
  const { errors } = await harness(page, "guest");
  await page.getByRole("tab", { name: "Markets", exact: true }).click();
  const search = page.getByLabel("Search sampled tokens");
  const geometry = await search.evaluate((input) => {
    const bounds = input.getBoundingClientRect();
    const icon = input.parentElement
      ?.querySelector("svg")
      ?.getBoundingClientRect();
    return {
      textLeft: bounds.left + parseFloat(getComputedStyle(input).paddingLeft),
      iconRight: icon?.right,
    };
  });
  expect(geometry.iconRight).toBeDefined();
  expect(geometry.textLeft).toBeGreaterThanOrEqual(
    (geometry.iconRight ?? 0) + 4,
  );
  await search.fill("no invented token matches this query");
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(0);
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "$SYMF", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("sample table sorts real market metrics and keeps unknown values last in both directions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { errors } = await harness(page, "guest");
  await page.getByRole("tab", { name: "Markets", exact: true }).click();
  const table = page.getByRole("table", {
    name: "Sampled markets",
    exact: true,
  });
  await expect(
    table.getByRole("columnheader", { name: "Sort by 1h volume", exact: true }),
  ).toHaveAttribute("aria-sort", "descending");
  expect(await sampleSymbols(page)).toEqual([
    "NOVA",
    "SYMF",
    "QUIET",
    "UNKNOWN",
  ]);
  await page.screenshot({
    path: "tmp/forum-render-tests/terminal-markets-1440.png",
  });
  await table
    .getByRole("button", { name: "Sort by Market cap", exact: true })
    .click();
  await expect(
    table.getByRole("columnheader", {
      name: "Sort by Market cap",
      exact: true,
    }),
  ).toHaveAttribute("aria-sort", "descending");
  expect(await sampleSymbols(page)).toEqual([
    "NOVA",
    "QUIET",
    "SYMF",
    "UNKNOWN",
  ]);
  const novaCap = table
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: /^View NOVA,/ }) })
    .getByRole("cell")
    .nth(3);
  await expect(novaCap).toHaveText("$700K");
  await expect(novaCap).toHaveAttribute("title", "700000");
  await table
    .getByRole("button", { name: "Sort by Market cap", exact: true })
    .click();
  await expect(
    table.getByRole("columnheader", {
      name: "Sort by Market cap",
      exact: true,
    }),
  ).toHaveAttribute("aria-sort", "ascending");
  expect(await sampleSymbols(page)).toEqual([
    "SYMF",
    "QUIET",
    "NOVA",
    "UNKNOWN",
  ]);
  expect(errors).toEqual([]);
});

test("market-cap filters never substitute diluted value or invent a platform ranking", async ({
  page,
}) => {
  const { errors } = await harness(page, "guest");
  await page.getByRole("tab", { name: "Markets", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Market cap", exact: true })
    .selectOption("50k100k");
  expect(await sampleSymbols(page)).toEqual(["SYMF", "QUIET"]);
  await page
    .getByRole("combobox", { name: "Market cap", exact: true })
    .selectOption("unknown");
  expect(await sampleSymbols(page)).toEqual(["UNKNOWN"]);
  await expect(
    page.getByText("Market cap is not FDV.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Top traders|Live trades/i }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("sample source links reject unsafe metadata and keep stale observations explicit", async ({
  page,
}) => {
  const { errors } = await harness(page, "guest");
  await page.getByRole("tab", { name: "Markets", exact: true }).click();
  const table = page.getByRole("table", {
    name: "Sampled markets",
    exact: true,
  });
  const nova = table
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: /^View NOVA,/ }) });
  await expect(nova.getByText("Stale", { exact: true })).toBeVisible();
  await expect(nova.locator("time")).toHaveAttribute("datetime", /T.*Z$/);
  const sourceTime = await nova.locator("time").getAttribute("datetime");
  expect(Date.now() - Date.parse(sourceTime!)).toBeGreaterThanOrEqual(
    3_500_000,
  );
  await expect(
    nova.getByRole("link", { name: "View NOVA source" }),
  ).toHaveAttribute("href", "https://example.com/source");
  for (const symbol of ["QUIET", "UNKNOWN"]) {
    const row = table.getByRole("row").filter({
      has: page.getByRole("button", { name: new RegExp(`^View ${symbol},`) }),
    });
    await expect(row.getByRole("link")).toHaveCount(0);
    await expect(
      row.getByText("Source unavailable", { exact: true }),
    ).toBeVisible();
  }
  const sourceLinks = await table
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).href),
    );
  expect(
    sourceLinks.every((href) => {
      const url = new URL(href);
      return url.protocol === "https:" && !url.username && !url.password;
    }),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("a current bounded cohort keeps source timestamps and selects only the exact requested market", async ({
  page,
}) => {
  const frozenNow = Date.parse("2026-10-30T18:00:00.000Z");
  await page.clock.install({ time: frozenNow - 1_000 });
  await page.clock.pauseAt(frozenNow);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { errors, chartMints } = await harness(page, "guest&currentcohort");
  await expect(
    page.getByRole("img", { name: /SYMF USD candlestick chart/ }),
  ).toBeVisible();
  const order = await page
    .getByRole("complementary", { name: "Trade selected token" })
    .elementHandle();
  await page.getByRole("tab", { name: "Markets", exact: true }).click();
  const table = page.getByRole("table", {
    name: "Sampled markets",
    exact: true,
  });
  await expect(table.getByRole("button", { name: /^View / })).toHaveCount(10);
  const firstSource = table
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: /^View FRESH1,/ }) })
    .locator("time");
  await expect(firstSource).toHaveAttribute(
    "datetime",
    new Date(frozenNow - 60_000).toISOString(),
  );
  await expect(table.getByText("Stale", { exact: true })).toHaveCount(0);
  for (const platform of ["pumpfun", "bags"]) {
    await page
      .getByRole("combobox", { name: "Platform", exact: true })
      .selectOption(platform);
    await expect(table.getByRole("button", { name: /^View / })).toHaveCount(5);
  }
  const unknown = table
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: /^View FRESH10,/ }) });
  await expect(unknown.getByRole("cell").nth(3)).toHaveText("Unavailable");
  // Neither opening the table nor filtering ten rows can create chart fanout.
  expect(chartMints).toHaveLength(1);
  const source = table
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: /^View FRESH6,/ }) })
    .locator("time");
  const originalSourceTime = await source.getAttribute("datetime");
  await page.clock.fastForward(120_000);
  await expect(source).toHaveAttribute("datetime", originalSourceTime!);
  await page.getByRole("button", { name: /^View FRESH6,/ }).click();
  await expect(
    page.getByRole("tab", { name: "Chart", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "$FRESH6", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /FRESH6 USD candlestick chart/ }),
  ).toBeVisible();
  expect(chartMints.at(-1)).toBe(`${"1".repeat(31)}7`);
  expect(
    chartMints.every(
      (mint) => mint === chartMints[0] || mint === `${"1".repeat(31)}7`,
    ),
  ).toBe(true);
  expect(await order?.evaluate((node) => node.isConnected)).toBe(true);
  expect(errors).toEqual([]);
});

test("compact touch controls retain 44px targets and original protected receipts", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    const { errors } = await harness(page, "held");
    await expect(
      page.getByRole("img", { name: /SYMF USD candlestick chart/ }),
    ).toBeVisible();
    await expectCompactChart(page, true);
    const targets = [
      ...(await page
        .getByRole("tablist", { name: "Terminal views" })
        .getByRole("tab")
        .all()),
      ...(await page
        .getByRole("group", { name: "Candle interval" })
        .getByRole("button")
        .all()),
      page.getByRole("link", { name: "Receipts", exact: true }),
      page.getByRole("link", { name: "Trade", exact: true }),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    const receipt = page.getByText("Outcome protected", { exact: true });
    await expect(receipt).toBeVisible();
    const original = await receipt.elementHandle();
    await page.getByRole("tab", { name: "Markets", exact: true }).click();
    for (const control of [
      page.getByRole("textbox", { name: "Search sampled tokens" }),
      page.getByRole("combobox", { name: "Market cap", exact: true }),
      page.getByRole("combobox", { name: "Platform", exact: true }),
    ])
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(receipt).toBeVisible();
    await page.getByRole("tab", { name: "Chart", exact: true }).click();
    expect(await original?.evaluate((node) => node.isConnected)).toBe(true);
    await expect(
      page.getByText("No signature recorded", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /repeat|replay|resend/i }),
    ).toHaveCount(0);
    expect(
      await page.locator("html").evaluate((node) => node.scrollWidth),
    ).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("keyboard view changes keep the chart, order node and protected receipts mounted", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { errors } = await harness(page, "held");
  const chart = page.getByRole("tab", { name: "Chart", exact: true });
  const markets = page.getByRole("tab", { name: "Markets", exact: true });
  const order = page.getByRole("complementary", {
    name: "Trade selected token",
  });
  const chartImage = page.getByRole("img", {
    name: /SYMF USD candlestick chart/,
  });
  await expect(chartImage).toBeVisible();
  const originalOrder = await order.elementHandle();
  const originalChart = await chartImage.elementHandle();
  await chart.focus();
  await page.keyboard.press("ArrowRight");
  await expect(markets).toBeFocused();
  await expect(markets).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel", { name: "Markets", exact: true }),
  ).toBeVisible();
  await expect(order).toBeVisible();
  await expect(
    page.getByText("Outcome protected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No signature recorded", { exact: true }),
  ).toBeVisible();
  expect(await originalOrder?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await originalChart?.evaluate((node) => node.isConnected)).toBe(true);
  await page.keyboard.press("Home");
  await expect(chart).toBeFocused();
  await expect(chartImage).toBeVisible();
  await page.keyboard.press("End");
  await expect(markets).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(chart).toBeFocused();
  await expect(chartImage).toBeVisible();
  expect(await originalOrder?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await originalChart?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(
    page.getByRole("button", { name: /repeat|replay|resend/i }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a mismatched chart response cannot replace the selected mint's recorded market data", async ({
  page,
}) => {
  const { errors, chartMints } = await harness(page, "guest&wrongchart");
  await expect(
    page.getByText("Market data is temporarily unavailable.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /USD candlestick chart/ }),
  ).toHaveCount(0);
  const selected = page
    .getByRole("region")
    .filter({ has: page.getByRole("heading", { name: "$SYMF", exact: true }) });
  await expect(
    selected
      .locator("dt")
      .filter({ hasText: /^Market cap$/ })
      .locator("..")
      .locator("dd"),
  ).toHaveText("$60K");
  expect(chartMints).toHaveLength(1);
  expect(chartMints[0]).not.toBe(NOVA_MINT);
  expect(errors).toEqual([]);
});

test("an exact-mint deep link binds the chart and public identity without inventing a trade symbol", async ({
  page,
}) => {
  const { errors, chartMints } = await harness(page, `guest&mint=${NOVA_MINT}`);
  await expect(
    page.getByRole("heading", { name: "$NOVA", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /NOVA USD candlestick chart/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "$SYMF", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /\$TOKEN/ })).toHaveCount(0);
  expect(chartMints).toEqual([NOVA_MINT]);
  expect(errors).toEqual([]);
});

for (const width of [640, 1024])
  test(`connected desk keeps its interval controls and local table within ${width} CSS pixels`, async ({
    page,
  }) => {
    // 640 CSS pixels also exercises the reflow space of a 1280px view at 200% zoom.
    await page.setViewportSize({ width, height: 1000 });
    const { errors } = await harness(page, "guest");
    const image = page.getByRole("img", { name: /SYMF USD candlestick chart/ });
    await expect(image).toBeVisible();
    await expectCompactChart(page, width === 640);
    const toolbar = page.getByRole("group", { name: "Candle interval" });
    const bounds = await toolbar.boundingBox();
    const chartBounds = await image.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(chartBounds!.x - 2);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      chartBounds!.x + chartBounds!.width + 2,
    );
    for (const button of await toolbar.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        bounds!.x + bounds!.width + 1,
      );
      expect(box!.y + box!.height).toBeLessThanOrEqual(
        bounds!.y + bounds!.height + 1,
      );
    }
    await page.getByRole("tab", { name: "Markets", exact: true }).click();
    const tableRegion = page.getByRole("region", {
      name: "Market data",
      exact: true,
    });
    await tableRegion.focus();
    await expect(tableRegion).toBeFocused();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.getByRole("tab", { name: "Chart", exact: true }).click();
    await expect(image).toBeVisible();
    expect((await image.boundingBox())?.width).toBeGreaterThan(280);
    expect(errors).toEqual([]);
  });

test("an empty market sample keeps the forum token shortcut without invented trader rows", async ({
  page,
}) => {
  const { errors } = await harness(page, "guest&empty");
  await page.getByRole("tab", { name: "Markets", exact: true }).click();
  await expect(
    page.getByText("No recent tokens match this sample.", { exact: true }),
  ).toBeVisible();
  const emptyPanel = await page
    .getByRole("tabpanel", { name: "Markets", exact: true })
    .boundingBox();
  expect(emptyPanel!.height).toBeLessThan(420);
  await expect(
    page
      .getByRole("table", { name: "Sampled markets", exact: true })
      .getByRole("button", { name: /^View / }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show SYMF market", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Top traders|Live trades/i }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show SYMF market", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Chart", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "$SYMF", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [1024, 1440])
  test(`terminal uses the full real forum frame at ${width}px without clipping its controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors } = await harness(page, "guest&frame");
    const route = page.locator("section[data-forum-layout=terminal]");
    const frame = await route.boundingBox();
    expect(frame).not.toBeNull();
    expect(frame!.x).toBeCloseTo(192, 0);
    expect(frame!.width).toBeCloseTo(width - 192, 0);
    await expect(route).toHaveCSS("padding-left", "0px");
    await expect(route).toHaveCSS("padding-right", "0px");
    const chart = page.getByRole("img", { name: /SYMF USD candlestick chart/ });
    await expect(chart).toBeVisible();
    await expectCompactChart(page, width === 1024);
    if (width === 1440) {
      const workspace = await page
        .getByRole("heading", { name: "Your workspace", exact: true })
        .boundingBox();
      expect(workspace!.y).toBeLessThanOrEqual(730);
    }
    expect((await chart.boundingBox())?.y).toBeLessThanOrEqual(300);
    if (width === 1440)
      expect((await chart.boundingBox())?.width).toBeGreaterThan(800);
    const toolbar = page.getByRole("group", { name: "Candle interval" });
    const toolbarBox = await toolbar.boundingBox();
    const chartBounds = await chart.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(toolbarBox!.x).toBeGreaterThanOrEqual(chartBounds!.x - 2);
    expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(
      chartBounds!.x + chartBounds!.width + 2,
    );
    await expect(toolbar.getByRole("button")).toHaveCount(5);
    for (const button of await toolbar.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        toolbarBox!.x + toolbarBox!.width + 1,
      );
      expect(box!.y + box!.height).toBeLessThanOrEqual(
        toolbarBox!.y + toolbarBox!.height + 1,
      );
    }
    const order = page.getByRole("complementary", {
      name: "Trade selected token",
    });
    const originalOrder = await order.elementHandle();
    await page.getByRole("tab", { name: "Markets", exact: true }).click();
    await expect(
      page.getByRole("table", { name: "Sampled markets", exact: true }),
    ).toBeVisible();
    await expect(order).toBeVisible();
    expect(await originalOrder?.evaluate((node) => node.isConnected)).toBe(
      true,
    );
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.getByRole("tab", { name: "Chart", exact: true }).click();
    await expect(chart).toBeVisible();
    expect(await originalOrder?.evaluate((node) => node.isConnected)).toBe(
      true,
    );
    await page.screenshot({
      path: `tmp/forum-render-tests/terminal-frame-${width}.png`,
    });
    expect(errors).toEqual([]);
  });

for (const width of [390, 1440])
  test(`community fits ${width}px and leads with useful content, not forms`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors, chartMints } = await harness(page, "community");
    await expect(
      page.getByRole("heading", { name: "Community utilities", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Fixture research collective/ }),
    ).toBeVisible();
    await expect(page.getByLabel("Exact Solana mint")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add project", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Market & discussion" }),
    ).toHaveAttribute("href", /\/trade\?mint=/);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `tmp/forum-render-tests/community-projects-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Bounties & research", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Review a simulated token report" }),
    ).toBeVisible();
    await expect(
      page.getByText("Unfunded sponsor pledge", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create brief", exact: true }),
    ).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(chartMints).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `tmp/forum-render-tests/community-research-${width}.png`,
      fullPage: true,
    });
  });

test("guest project dialog explains its wallet prerequisite and restores keyboard focus", async ({
  page,
}) => {
  const { errors } = await harness(page, "community&guest");
  const add = page.getByRole("button", { name: "Add project", exact: true });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Introduce your project" });
  await expect(dialog).toBeVisible();
  const save = dialog.getByRole("button", { name: "Save public affiliation" });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAccessibleDescription(
    "Sign in and link the selected wallet to your account before saving a public affiliation.",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  expect(errors).toEqual([]);
});

for (const width of [390, 1440])
  test(`empty community at ${width}px explains how to start without invented activity`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors } = await harness(page, "community&guest&empty");
    await expect(
      page.getByRole("heading", { name: "The next project starts here." }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByLabel("Exact Solana mint")).toHaveCount(0);
    await page.screenshot({
      path: `tmp/forum-render-tests/community-empty-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Bounties & research", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Create brief", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });

test("community section buttons expose their controlled region with keyboard navigation", async ({
  page,
}) => {
  const { errors } = await harness(page, "community");
  for (const label of [
    "Bounties & research",
    "Tips & holder profile",
    "Your receipts",
    "Project hubs",
  ]) {
    const button = page
      .getByRole("navigation", { name: "Community utilities" })
      .getByRole("button", { name: label, exact: true });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const region = page.getByRole("region", { name: label, exact: true });
    await expect(region).toBeVisible();
    expect(await button.getAttribute("aria-controls")).toBe(
      await region.getAttribute("id"),
    );
  }
  expect(errors).toEqual([]);
});

test("protected community receipt cannot reopen or resend an uncertain payment", async ({
  page,
}) => {
  const { errors } = await harness(page, "community");
  await page
    .getByRole("button", { name: "Your receipts", exact: true })
    .click();
  await expect(
    page.getByText("Protected outcome", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check protected receipt", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Review reward payment" });
  await expect(
    dialog.getByText("Protected uncertain outcome", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/Do not pay again\./)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Verify saved payment" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", {
      name: /Open exact payment|repeat|replay|resend/i,
    }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("native community host stays read-only without initializing wallet or transport", async ({
  page,
}) => {
  const { errors, chartMints } = await harness(page, "community&plugin");
  await expect(
    page.getByRole("link", { name: "Open community" }),
  ).toHaveAttribute("href", /\/community$/);
  await expect(
    page.getByRole("button", { name: "Sign in with wallet" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Fixture research collective/ }),
  ).toHaveCount(0);
  expect(chartMints).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [390, 1440])
  test(`terminal and community retain their dark theme at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const scenario of ["guest&dark", "community&guest&dark"]) {
      const { errors } = await harness(page, scenario);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.locator("html").evaluate((element) => element.scrollWidth),
      ).toBeLessThanOrEqual(width);
      if (!scenario.includes("community")) {
        await expect(
          page.getByRole("img", { name: /SYMF USD candlestick chart/ }),
        ).toBeVisible();
        await expect
          .poll(async () =>
            page
              .getByRole("img", { name: /SYMF USD candlestick chart/ })
              .locator("canvas")
              .first()
              .evaluate((canvas) => {
                const context = (canvas as HTMLCanvasElement).getContext("2d");
                return context
                  ? [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
                  : [];
              }),
          )
          .toEqual([19, 19, 21]);
      }
      await page.screenshot({
        path: `tmp/forum-render-tests/${scenario.includes("community") ? "community" : "terminal"}-dark-${width}.png`,
      });
      expect(errors).toEqual([]);
    }
  });
