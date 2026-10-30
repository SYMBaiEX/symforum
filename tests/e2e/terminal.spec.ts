import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
          mint,
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

for (const width of [390, 1440])
  test(`terminal fits ${width}px and filters actual market cap`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors, chartMints } = await harness(page, "guest");
    await expect(
      page.getByRole("heading", { name: "Research. Discuss. Trade." }),
    ).toBeVisible();
    await page.getByLabel("Market cap", { exact: true }).selectOption("500k1m");
    await expect(page.getByRole("button", { name: /View NOVA/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /View SYMF/ })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: /View NOVA/ }).click();
    await expect(
      page.getByRole("heading", { name: "$NOVA", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Stale sampled metrics\./)).toBeVisible();
    await expect(
      page.getByRole("img", { name: /NOVA USD candlestick chart/ }),
    ).toBeVisible();
    await expect(
      page
        .locator("dt")
        .filter({ hasText: /^Market cap$/ })
        .locator("..")
        .locator("dd"),
    ).toHaveText("Unavailable");
    await expect(
      page
        .locator("dt")
        .filter({ hasText: /^FDV$/ })
        .locator("..")
        .locator("dd"),
    ).toHaveText("$1M");
    expect(chartMints).toContain(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
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
