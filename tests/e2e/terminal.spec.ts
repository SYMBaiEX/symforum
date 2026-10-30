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
    await page.screenshot({
      path: `tmp/forum-render-tests/terminal-workspace-${width}.png`,
    });
    if (width === 390)
      await page.getByRole("button", { name: /^Markets/ }).click();
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
    expect(chartMints).toContain(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
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

test("mobile markets is an explicit disclosure and trade remains one tap away", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await harness(page, "guest");
  const markets = page.getByRole("button", { name: /^Markets/ });
  await expect(markets).toHaveAttribute("aria-expanded", "false");
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
  await expect(markets).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Search sampled tokens")).toBeVisible();
  await markets.focus();
  await page.keyboard.press("Enter");
  await expect(markets).toHaveAttribute("aria-expanded", "false");
  await expect(markets).toBeFocused();
  expect(errors).toEqual([]);
});

test("market search text clears its search icon and empty filters remain honest", async ({
  page,
}) => {
  const { errors } = await harness(page, "guest");
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
  await expect(
    page.getByRole("heading", { name: "$SYMF", exact: true }),
  ).toBeVisible();
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
