import { test, expect, type Locator, type Page } from "@playwright/test";
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

async function harness(page: Page, scenario = "", clockNow = () => Date.now()) {
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
      const now = clockNow();
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

async function openPane(
  page: Page,
  name: "Chart" | "Markets" | "Trade" | "Receipts",
) {
  if (
    name === "Trade" &&
    (await page
      .getByRole("complementary", { name: "Trade selected token" })
      .isVisible())
  )
    return;
  const dock = page.getByRole("navigation", {
    name: "Terminal dock",
    exact: true,
  });
  const button = dock.getByRole("button", { name, exact: true });
  if (await button.isVisible()) {
    await button.click();
    // Dock navigation deliberately moves focus on its next animation frame.
    // Observe that handoff before a caller focuses a nested scroll region.
    const destination =
      name === "Receipts"
        ? "terminal-tool-title"
        : name === "Trade"
          ? "terminal-order"
          : `terminal-${name.toLowerCase()}`;
    await expect(page.locator(`#${destination}`)).toBeFocused();
  } else await page.getByRole("tab", { name, exact: true }).click();
}

async function openTool(
  page: Page,
  name: "Wallet & watches" | "Research" | "Community" | "Treasury & burns",
) {
  const dock = page.getByRole("navigation", {
    name: "Terminal dock",
    exact: true,
  });
  const direct = dock.getByRole("button", {
    name: name === "Treasury & burns" ? "Treasury" : name,
    exact: true,
  });
  if (await direct.isVisible()) await direct.click();
  else {
    await dock.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name, exact: true }).first().click();
  }
  await expect(page.locator("#terminal-tool-title")).toBeFocused();
}

async function expectViewportBounded(page: Page) {
  const viewport = page.viewportSize()!;
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  expect(dimensions.width).toBeLessThanOrEqual(viewport.width);
  expect(dimensions.height).toBeLessThanOrEqual(viewport.height);
}

async function expectInsideWidth(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function recordedOperations(page: Page) {
  return page.evaluate(() => [
    ...(window as typeof window & { __terminalFixtureCalls: string[] })
      .__terminalFixtureCalls,
  ]);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 768 },
  { width: 640, height: 450 }, // reflow space of a 1280px view at 200% zoom
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
])
  test(`terminal owns one bounded viewport at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const { errors, chartMints } = await harness(page, "held&frame");
    await expect(
      page.getByRole("img", { name: /SYMF USD candlestick chart/ }),
    ).toBeVisible();
    if (viewport.width === 320) {
      const chart = await page
        .getByRole("img", { name: /SYMF USD candlestick chart/ })
        .boundingBox();
      expect(chart!.height).toBeGreaterThanOrEqual(180);
    }
    await expect(page.locator("[data-terminal-viewport]")).toHaveCount(1);
    const rail = page.locator(".forum-left-rail");
    if (viewport.width >= 768) await expect(rail).toBeVisible();
    else await expect(rail).toBeHidden();
    const contentLeft =
      viewport.width >= 1024 ? 192 : viewport.width >= 768 ? 64 : 0;
    const main = await page.locator("main.forum-main").boundingBox();
    const workspace = await page
      .locator("[data-terminal-viewport]")
      .boundingBox();
    expect(main!.x).toBeCloseTo(contentLeft, 0);
    expect(main!.width).toBeCloseTo(viewport.width - contentLeft, 0);
    expect(workspace!.x).toBeCloseTo(contentLeft, 0);
    expect(workspace!.width).toBeCloseTo(viewport.width - contentLeft, 0);
    await expect(
      page.getByRole("navigation", { name: "Forum navigation", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByText("Normal forum footer", { exact: true }),
    ).toBeHidden();
    await expectViewportBounded(page);
    await openPane(page, "Markets");
    const marketData = page.getByRole("region", {
      name: "Market data",
      exact: true,
    });
    await marketData.focus();
    await expect(marketData).toBeFocused();
    await expectViewportBounded(page);
    expect(chartMints).toHaveLength(1);
    await openPane(page, "Receipts");
    await expect(
      page.getByText("Outcome protected", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No signature recorded", { exact: true }),
    ).toBeVisible();
    const receipt = await page
      .getByText("Outcome protected", { exact: true })
      .elementHandle();
    await expect(
      page.getByRole("button", { name: /repeat|replay|resend/i }),
    ).toHaveCount(0);
    await openTool(page, "Wallet & watches");
    await expect(page.getByLabel("Alert above, USD")).toBeVisible();
    // Desktop keeps an intentionally open drawer alongside the primary chart.
    // Closing it, rather than changing chart tabs, must remove its focus targets.
    await page
      .getByRole("button", { name: "Close tools panel", exact: true })
      .click();
    await openPane(page, "Chart");
    await expect(page.getByLabel("Alert above, USD")).toBeHidden();
    await expect(page.getByLabel("Search sampled tokens")).toBeHidden();
    expect(await receipt?.evaluate((node) => node.isConnected)).toBe(true);
    await expectViewportBounded(page);
    expect(errors).toEqual([]);
  });

test("terminal frame overrides do not hide ordinary forum chrome", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors, chartMints } = await harness(page, "shellcontrol");
  await expect(
    page.getByRole("heading", { name: "Ordinary forum page" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Forum navigation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Normal forum footer", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-terminal-viewport]")).toHaveCount(0);
  expect(chartMints).toEqual([]);
  expect(errors).toEqual([]);
});

test("one real order input persists through internal tools and viewport changes without enabling payment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { errors } = await harness(page, "orderinput");
  const amount = page.getByRole("textbox", { name: "You pay", exact: true });
  await expect(amount).toBeVisible();
  await amount.fill(".5");
  await expect(amount).toHaveValue("0.5");
  await page.getByText("Before you approve", { exact: true }).click();
  await expect(
    page.getByText(/Review fees, slippage and minimum received before signing/),
  ).toBeVisible();
  await expect(
    page.getByText("Swaps are not yet enabled. No payments can be made here.", {
      exact: true,
    }),
  ).toBeVisible();
  const original = await amount.elementHandle();
  await openPane(page, "Markets");
  await expect(amount).toHaveValue("0.5");
  await page.setViewportSize({ width: 390, height: 844 });
  await openPane(page, "Trade");
  await expect(amount).toHaveValue("0.5");
  await openPane(page, "Receipts");
  await expect(amount).toBeHidden();
  await openTool(page, "Research");
  await expect(
    page.getByRole("button", {
      name: "Payment receipt protected",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByText(/A previous payment is awaiting verified settlement/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Verify saved receipt", exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review research export", exact: true }),
  ).toHaveCount(0);
  await openTool(page, "Community");
  await expect(
    page.getByRole("heading", { name: /Fixture research collective/ }),
  ).toBeVisible();
  await openTool(page, "Treasury & burns");
  await expect(
    page.getByText("Confirmed promotion receipts only", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 768 });
  await openPane(page, "Chart");
  await expect(amount).toHaveValue("0.5");
  expect(await original?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(
    page.getByRole("textbox", { name: "You pay", exact: true }),
  ).toHaveCount(1);
  await expectViewportBounded(page);
  expect(errors).toEqual([]);
});

test("an open order token picker keeps its owner visible across focused-layout resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { errors } = await harness(page, "orderinput");
  const amount = page.getByRole("textbox", { name: "You pay", exact: true });
  await expect(amount).toBeVisible();
  await amount.fill(".5");
  await expect(amount).toHaveValue("0.5");
  const originalAmount = await amount.elementHandle();
  const trigger = page.getByRole("button", { name: "Pay token", exact: true });
  const originalTrigger = await trigger.elementHandle();
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Select a token",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await expect(page.locator("[data-terminal-viewport]")).toHaveAttribute(
    "data-pane",
    "trade",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(amount).toBeVisible();
  await expect(amount).toHaveValue("0.5");
  expect(await originalAmount?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await originalTrigger?.evaluate((node) => node.isConnected)).toBe(
    true,
  );
  await expect(
    page.getByRole("textbox", { name: "You pay", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Pay token", exact: true }),
  ).toHaveCount(1);
  await expectViewportBounded(page);
  expect(errors).toEqual([]);
});

test("modeled mobile visual viewport keeps the active order and dock usable without changing input state", async ({
  page,
}) => {
  // This models visualViewport events, not a physical device keyboard or pinch.
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await harness(page, "orderinput");
  await openPane(page, "Trade");
  const amount = page.getByRole("textbox", { name: "You pay", exact: true });
  await expect(amount).toBeVisible();
  await amount.fill(".5");
  await amount.focus();
  const original = await amount.elementHandle();
  const workspace = page.locator("[data-terminal-viewport]");
  const dock = page.getByRole("navigation", {
    name: "Terminal dock",
    exact: true,
  });
  const resizeVisualViewport = async (height: number, scale = 1) =>
    page.evaluate(
      ({ height, scale }) => {
        if (!window.visualViewport)
          throw new Error("Visual viewport fixture unavailable");
        Object.defineProperty(window.visualViewport, "height", {
          configurable: true,
          get: () => height,
        });
        Object.defineProperty(window.visualViewport, "scale", {
          configurable: true,
          get: () => scale,
        });
        window.visualViewport.dispatchEvent(new Event("resize"));
      },
      { height, scale },
    );
  await resizeVisualViewport(480);
  await expect
    .poll(async () => (await workspace.boundingBox())!.height)
    .toBeLessThanOrEqual(424);
  const dockBox = await dock.boundingBox();
  expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(480);
  await amount.scrollIntoViewIfNeeded();
  const inputBox = await amount.boundingBox();
  const orderBox = await page
    .getByRole("complementary", { name: "Trade selected token" })
    .boundingBox();
  expect(inputBox!.y).toBeGreaterThanOrEqual(orderBox!.y);
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(
    orderBox!.y + orderBox!.height,
  );
  await expect(amount).toHaveValue("0.5");
  expect(await original?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(
    page.getByRole("textbox", { name: "You pay", exact: true }),
  ).toHaveCount(1);
  await resizeVisualViewport(844);
  await expect
    .poll(async () => (await workspace.boundingBox())!.height)
    .toBeGreaterThan(424);
  expect(
    (await dock.boundingBox())!.y + (await dock.boundingBox())!.height,
  ).toBeLessThanOrEqual(844);
  await resizeVisualViewport(480, 2);
  await expect
    .poll(() =>
      workspace.evaluate((node) =>
        (node as HTMLElement).style.getPropertyValue(
          "--terminal-visible-height",
        ),
      ),
    )
    .toBe("");
  await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute(
    "content",
    /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/i,
  );
  await expect(amount).toHaveValue("0.5");
  await resizeVisualViewport(844);
  expect(errors).toEqual([]);
});

test("a protected community receipt stays bounded in the terminal and Escape restores its trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { errors } = await harness(page, "held");
  await openTool(page, "Community");
  await page
    .getByRole("button", { name: "Your receipts", exact: true })
    .click();
  const trigger = page.getByRole("button", {
    name: "Check protected receipt",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Review reward payment" });
  await expect(
    dialog.getByText("Protected uncertain outcome", { exact: true }),
  ).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(box!.y + box!.height).toBeLessThanOrEqual(568);
  await expect(
    dialog.getByRole("button", { name: "Verify saved payment" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", {
      name: /Open exact payment|repeat|replay|resend/i,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectViewportBounded(page);
  expect(errors).toEqual([]);
});

test("tools expose named groups, visible back navigation and safe nonmodal Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await harness(page, "held");
  const tools = page
    .getByRole("navigation", { name: "Terminal dock", exact: true })
    .getByRole("button", { name: "Tools", exact: true });
  await tools.click();
  await expect(page.locator("#terminal-tool-title")).toBeFocused();
  const content = page.getByRole("region", {
    name: "Active terminal tool",
    exact: true,
  });
  await expect(content.getByRole("listitem")).toHaveCount(5);
  for (const label of [
    "Wallet & watches",
    "Swap receipts",
    "Research",
    "Community",
    "Treasury & burns",
  ])
    await expect(
      content.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  await content.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.locator("#terminal-tool-title")).toBeFocused();
  const back = page.getByRole("button", { name: "All tools", exact: true });
  await expect(back).toHaveText("All tools");
  await back.click();
  await expect(content.getByRole("listitem")).toHaveCount(5);
  await content.getByRole("button", { name: "Community", exact: true }).click();
  await expect(page.locator("#terminal-tool-title")).toBeFocused();
  await page
    .getByRole("button", { name: "Your receipts", exact: true })
    .click();
  const protectedReceipt = page.getByRole("button", {
    name: "Check protected receipt",
    exact: true,
  });
  const original = await protectedReceipt.elementHandle();
  await protectedReceipt.click();
  const dialog = page.getByRole("dialog", {
    name: "Review reward payment",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(protectedReceipt).toBeFocused();
  await expect(
    page.getByRole("region", { name: "Terminal tools", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "Terminal tools", exact: true }),
  ).toBeHidden();
  await expect(tools).toBeFocused();
  expect(await original?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(
    page.getByRole("status", {
      name: "Known protected operations",
      exact: true,
    }),
  ).toContainText("Community");
  expect(await recordedOperations(page)).toEqual([]);
  await expectViewportBounded(page);
  expect(errors).toEqual([]);
});

test("guest swap receipts provide their own sign-in route without confusing wallet controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { errors } = await harness(page, "guest");
  await openPane(page, "Receipts");
  await expect(page.locator("#terminal-tool-title")).toHaveText(
    "Swap receipts",
  );
  const signIn = page.getByRole("link", {
    name: "Sign in to view swap receipts",
    exact: true,
  });
  await expect(signIn).toBeVisible();
  await expectInsideWidth(page, signIn);
  const href = new URL((await signIn.getAttribute("href"))!, page.url());
  expect(href.pathname).toBe("/signin");
  expect(href.searchParams.get("redirectTo")).toMatch(/\/trade$/);
  expect(await recordedOperations(page)).toEqual([]);
  await expectViewportBounded(page);
  expect(errors).toEqual([]);
});

test("known private outcomes survive hidden community views and clear on fixture sign-out", async ({
  page,
}) => {
  const { errors } = await harness(page, "held");
  await expect(
    page.getByRole("img", { name: /SYMF USD candlestick chart/ }),
  ).toBeVisible();
  const paymentQueryCount = () =>
    page.evaluate(
      () =>
        (
          window as unknown as { __terminalFixtureQueries: string[] }
        ).__terminalFixtureQueries.filter(
          (name) => name === "forumCommunity:listPayments",
        ).length,
    );
  expect(await paymentQueryCount()).toBe(0);
  await openTool(page, "Community");
  expect(await paymentQueryCount()).toBe(0);
  await page
    .getByRole("button", { name: "Your receipts", exact: true })
    .click();
  await expect(
    page.getByText("Protected outcome", { exact: true }),
  ).toBeVisible();
  expect(await paymentQueryCount()).toBeGreaterThan(0);
  const attention = page.getByRole("status", {
    name: "Known protected operations",
    exact: true,
  });
  const community = attention.getByRole("button", {
    name: /^Community.*1 protected/,
  });
  await expect(community).toBeVisible();
  await page
    .getByRole("navigation", { name: "Community utilities", exact: true })
    .getByRole("button", { name: "Project hubs", exact: true })
    .click();
  await expect(
    page.getByText("Protected outcome", { exact: true }),
  ).toBeHidden();
  await expect(community).toBeVisible();
  await page
    .getByRole("button", { name: "Close tools panel", exact: true })
    .click();
  await openPane(page, "Chart");
  await expect(community).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("terminal-fixture:signout")),
  );
  await expect(attention).toBeHidden();
  expect(errors).toEqual([]);
});

test("long protected receipt histories scroll inside the active tool rather than the document", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 568 });
  const { errors } = await harness(page, "held&longhistory");
  await openPane(page, "Receipts");
  const history = page.getByRole("region", {
    name: "Your swap operation history",
    exact: true,
  });
  await expect(history.getByRole("row")).toHaveCount(31);
  const content = page.getByRole("region", {
    name: "Active terminal tool",
    exact: true,
  });
  await content.focus();
  await expect(content).toBeFocused();
  const previous = await content.evaluate((node) => node.scrollTop);
  await page.keyboard.press("End");
  await expect
    .poll(() => content.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(previous);
  await expect(
    page.getByRole("button", { name: /repeat|replay|resend/i }),
  ).toHaveCount(0);
  await expectViewportBounded(page);
  expect(errors).toEqual([]);
});

async function expectCompactChart(page: Page, narrow: boolean) {
  const canvas = page.getByRole("img", { name: /SYMF USD candlestick chart/ });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  // The chart flexes inside the viewport desk, not a fixed-height page stack.
  expect(box!.height).toBeGreaterThanOrEqual(
    viewport.height < 500 ? 72 : narrow ? 180 : 240,
  );
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 44);
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
    .locator('[role="tablist"][aria-label="Terminal views"]')
    .boundingBox();
  const heading = await page
    .getByRole("heading", { name: "Trading terminal", exact: true })
    .boundingBox();
  if (tabs) {
    expect(heading!.y + heading!.height / 2).toBeGreaterThanOrEqual(tabs.y);
    expect(heading!.y + heading!.height / 2).toBeLessThanOrEqual(
      tabs.y + tabs.height,
    );
  }
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
    await openPane(page, "Markets");
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
    const selectedToken = page.locator(
      "section[aria-labelledby=terminal-token-title]",
    );
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
  await openTool(page, "Wallet & watches");
  await page.getByLabel("Alert above, USD").fill(".5");
  await page.getByRole("button", { name: "Watch token", exact: true }).click();
  await expect(page.getByText(/Saved thresholds: above \$0.50/)).toBeVisible();
  await page.getByLabel("Alert above, USD").fill("");
  await page.getByRole("button", { name: "Update watch", exact: true }).click();
  await expect(page.getByText(/Saved thresholds: above \$0.50/)).toBeVisible();
  await openPane(page, "Receipts");
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

for (const width of [320, 390, 1440]) {
  test(`sample alerts open their exact mint without marking it read or changing watch settings at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const { errors, chartMints } = await harness(page, "samplealerts");
    await openTool(page, "Wallet & watches");
    const view = page.getByRole("button", {
      name: `View token for alert, mint ${NOVA_MINT}`,
      exact: true,
    });
    await expect(view).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "Mark read", exact: true }),
    ).toHaveCount(2);
    await view.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => chartMints.includes(NOVA_MINT)).toBe(true);
    await openTool(page, "Wallet & watches");
    await expect(
      page.getByRole("button", {
        name: `Selected token for alert, mint ${NOVA_MINT}`,
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Mark read", exact: true }),
    ).toHaveCount(2);
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { __terminalFixtureCalls: string[] }
        ).__terminalFixtureCalls.filter((call) => call.startsWith("mutation:")),
      ),
    ).toEqual([]);
    await page
      .getByRole("button", { name: "Mark read", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Mark read", exact: true }),
    ).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("failed alert acknowledgement retains the unread alert and exact-mint action", async ({
  page,
}) => {
  const { errors } = await harness(page, "samplealerts&alertackfail");
  await openTool(page, "Wallet & watches");
  await page
    .getByRole("button", { name: "Mark read", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("status").filter({
      hasText: "This alert could not be marked read. Try later.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark read", exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", {
      name: `View token for alert, mint ${NOVA_MINT}`,
      exact: true,
    }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

for (const pause of ["visible", "hidden", "offline"] as const) {
  test(`pre-I/O Markets deferral retries once after the shared window: ${pause}`, async ({
    page,
  }) => {
    await page.clock.install();
    const { errors } = await harness(page, "guest&marketrefreshdeferred");
    const counts = () =>
      page.evaluate(() => {
        const fixture = window as typeof window & {
          __terminalFixtureMarketRefreshArgs: Record<string, unknown>[];
          __terminalFixtureMarketRefreshAdmissions: number[];
        };
        return {
          actions: fixture.__terminalFixtureMarketRefreshArgs.length,
          admissions: fixture.__terminalFixtureMarketRefreshAdmissions.length,
        };
      });
    await openPane(page, "Markets");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Waiting for shared data window" }),
    ).toBeVisible();
    expect(await counts()).toEqual({ actions: 1, admissions: 0 });
    if (pause === "hidden") await openPane(page, "Chart");
    if (pause === "offline") await page.context().setOffline(true);
    await page.clock.runFor(2000);
    if (pause !== "visible") {
      expect(await counts()).toEqual({ actions: 1, admissions: 0 });
      if (pause === "hidden") await openPane(page, "Markets");
      else await page.context().setOffline(false);
    }
    await expect.poll(counts).toEqual({ actions: 2, admissions: 1 });
    await page.clock.fastForward(30_000);
    expect(await counts()).toEqual({ actions: 2, admissions: 1 });
    expect(errors).toEqual([]);
  });
}

for (const scenario of ["marketrefreshloading", "marketrefresherror"]) {
  test(`Markets does not shorten the admitted or ambiguous cooldown: ${scenario}`, async ({
    page,
  }) => {
    await page.clock.install();
    const { errors } = await harness(page, `guest&${scenario}`);
    await openPane(page, "Markets");
    await expect(
      page
        .getByRole("status")
        .filter({
          hasText:
            scenario === "marketrefreshloading"
              ? "Shared refresh in progress"
              : "Refresh unavailable · retained rows",
        }),
    ).toBeVisible();
    await page.clock.fastForward(30_000);
    expect(
      (await recordedOperations(page)).filter(
        (name) => name === "action:forumTerminalRefresh:refresh",
      ),
    ).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

test("Markets refresh is visible demand only and pauses offline, backgrounded and unmounted", async ({
  page,
}) => {
  await page.clock.install();
  const { errors } = await harness(page, "guest&marketrefresh");
  const refreshCalls = async () =>
    (await recordedOperations(page)).filter(
      (name) => name === "action:forumTerminalRefresh:refresh",
    ).length;
  await expect(
    page.getByRole("img", { name: /SYMF USD candlestick chart/ }),
  ).toBeVisible();
  expect(await refreshCalls()).toBe(0);
  await page.context().setOffline(true);
  await openPane(page, "Markets");
  await expect(
    page.getByRole("status").filter({ hasText: "Offline · refresh paused" }),
  ).toBeVisible();
  await page.clock.fastForward(660_000);
  expect(await refreshCalls()).toBe(0);
  await page.context().setOffline(false);
  await expect.poll(refreshCalls).toBe(1);
  await page
    .getByRole("combobox", { name: "Platform", exact: true })
    .selectOption("bags");
  await page
    .getByRole("combobox", { name: "Platform", exact: true })
    .selectOption("all");
  expect(await refreshCalls()).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __terminalFixtureMarketRefreshArgs: Record<string, unknown>[];
          }
        ).__terminalFixtureMarketRefreshArgs,
    ),
  ).toEqual([{}]);
  await openPane(page, "Chart");
  await page.clock.fastForward(660_000);
  expect(await refreshCalls()).toBe(1);
  await openPane(page, "Markets");
  await expect.poll(refreshCalls).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(660_000);
  expect(await refreshCalls()).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(refreshCalls).toBe(3);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("terminal-fixture:unmount")),
  );
  await page.clock.fastForward(660_000);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  expect(await refreshCalls()).toBe(3);
  expect(errors).toEqual([]);
});

for (const width of [320, 1440]) {
  test(`refreshed Markets fields keep holders and their original source age at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.setFixedTime(Date.parse("2026-10-30T18:00:00.000Z"));
    const { errors } = await harness(page, "guest&marketrefresh&oldsample");
    await openPane(page, "Markets");
    const row = page.getByRole("row").filter({
      has: page.getByRole("button", { name: /^View NOVA,/ }),
    });
    await expect(row.locator("td").nth(0)).not.toContainText("Stale");
    await expect(row.locator("td").nth(1)).toHaveText("$0.0042");
    await expect(row.locator("td").nth(3)).toHaveText("Unavailable");
    await expect(row.locator("td").nth(7)).toHaveText("4561h ago · stale");
    await expect(row.locator("td").nth(7)).toHaveAttribute(
      "aria-label",
      /Original scout sample:/,
    );
    await expect(
      row.getByText("Market checked", { exact: true }),
    ).toBeVisible();
    await expect(row.getByText("Holder sample", { exact: true })).toBeVisible();
    await expect(row.locator("time")).toHaveCount(2);
    await expect(row.locator("time").last()).toHaveText("1h ago");
    await expect(
      row.getByRole("link", { name: "View NOVA source" }),
    ).toHaveAttribute("href", "https://example.com/checked-market-pool");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const [scenario, message] of [
  ["marketrefreshbudget", "Free-data allowance reached · retained rows"],
  ["marketrefresherror", "Refresh unavailable · retained rows"],
] as const) {
  test(`Markets ${scenario} keeps retained rows and honest source timestamps`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(Date.parse("2026-10-30T18:00:00.000Z"));
    const { errors } = await harness(page, `guest&${scenario}`);
    await openPane(page, "Markets");
    await expect(
      page.getByRole("status").filter({ hasText: message }),
    ).toBeVisible();
    const row = page.getByRole("row").filter({
      has: page.getByRole("button", { name: /^View NOVA,/ }),
    });
    await expect(row.locator("td").nth(1)).toHaveText("$0.0007");
    await expect(row.locator("time")).toHaveText("1h ago");
    await expect(row.getByText("Market checked", { exact: true })).toHaveCount(
      0,
    );
    expect(errors).toEqual([]);
  });
}

test("a missing refreshed pool never inherits fresh prices or a fake holder timestamp", async ({
  page,
}) => {
  await page.clock.setFixedTime(Date.parse("2026-10-30T18:00:00.000Z"));
  const { errors } = await harness(page, "guest&marketrefreshmissing");
  await openPane(page, "Markets");
  const row = page.getByRole("row").filter({
    has: page.getByRole("button", { name: /^View NOVA,/ }),
  });
  await expect(row.locator("td").nth(1)).toHaveText("Unavailable");
  await expect(row.locator("td").nth(7)).toHaveText("4561h ago · stale");
  await expect(row.locator("time").last()).toHaveText("1h ago");
  await expect(row.getByRole("link", { name: "View NOVA source" })).toHaveCount(
    0,
  );
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
  await openPane(page, "Trade");
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
  const dock = page.getByRole("navigation", {
    name: "Terminal dock",
    exact: true,
  });
  const markets = dock.getByRole("button", { name: "Markets", exact: true });
  const chart = dock.getByRole("button", { name: "Chart", exact: true });
  await expect(markets).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Search sampled tokens")).toBeHidden();
  const trade = dock.getByRole("button", { name: "Trade", exact: true });
  const box = await trade.boundingBox();
  expect(box?.y).toBeLessThan(844);
  await trade.click();
  const order = page.getByRole("complementary", {
    name: "Trade selected token",
  });
  await expect(order).toBeVisible();
  await expect(order).toBeFocused();
  expect((await order.boundingBox())?.y).toBeLessThan(844);
  await markets.focus();
  await page.keyboard.press("Enter");
  await expect(markets).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Search sampled tokens")).toBeVisible();
  await chart.click();
  await expect(markets).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Search sampled tokens")).toBeHidden();
  expect(errors).toEqual([]);
});

test("market search text clears its search icon and empty filters remain honest", async ({
  page,
}) => {
  const { errors } = await harness(page, "guest");
  await openPane(page, "Markets");
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
  await openPane(page, "Chart");
  await expect(
    page.getByRole("heading", { name: "$SYMF", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [320, 390])
  test(`sample order and row freshness stay visible at ${width}px without horizontal panning`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const { errors, chartMints } = await harness(page, "guest");
    await openPane(page, "Markets");
    const context = page.getByRole("group", {
      name: "Sample context",
      exact: true,
    });
    await expect(context).toContainText("4 tokens");
    await expect(context).toContainText("Sampled data");
    const sort = context.getByRole("combobox", {
      name: "Sort sampled tokens",
      exact: true,
    });
    await expect(sort).toHaveValue("volume1h:desc");
    await expectInsideWidth(page, sort);
    await sort.selectOption("marketCap:asc");
    expect(await sampleSymbols(page)).toEqual([
      "SYMF",
      "QUIET",
      "NOVA",
      "UNKNOWN",
    ]);
    await expect(sort).toHaveValue("marketCap:asc");
    await expect(sort.locator("option:checked")).toContainText(
      /Market cap.*ascending/i,
    );
    const region = page.getByRole("region", {
      name: "Market data",
      exact: true,
    });
    await expect(region).toHaveAccessibleDescription(/Scroll for more metrics/);
    expect(await region.evaluate((node) => node.scrollLeft)).toBe(0);
    const nova = page
      .getByRole("table", { name: "Sampled markets", exact: true })
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: /^View NOVA,/ }) });
    const identityStale = nova
      .getByRole("cell")
      .first()
      .getByText("Stale", { exact: true });
    await expect(identityStale).toBeVisible();
    await expectInsideWidth(page, identityStale);
    await expect(nova.locator("time")).toHaveAttribute("datetime", /T.*Z$/);
    const symf = page
      .getByRole("table", { name: "Sampled markets", exact: true })
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: /^View SYMF,/ }) });
    await expect(
      symf.getByRole("cell").first().getByText("Stale", { exact: true }),
    ).toHaveCount(0);
    // Entering Markets requests one shared cache refresh. Local sorting must
    // not create another refresh, a per-token fetch or a payment operation.
    await expect.poll(() => recordedOperations(page)).toEqual([
      "action:forumTerminalRefresh:refresh",
    ]);
    expect(chartMints).toHaveLength(1);
    await expectViewportBounded(page);
    expect(errors).toEqual([]);
  });

test("filtered market empty states reset only local view controls and remain in the visible pane", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { errors, chartMints } = await harness(page, "guest");
  await openPane(page, "Markets");
  const search = page.getByLabel("Search sampled tokens");
  await search.fill("no invented token matches");
  const clear = page.getByRole("button", { name: "Clear search", exact: true });
  await expect(clear).toBeVisible();
  await expectInsideWidth(page, clear);
  await expect(
    page.getByRole("group", { name: "Sample context", exact: true }),
  ).toContainText("0 tokens");
  await clear.click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  expect(await sampleSymbols(page)).toHaveLength(4);
  const band = page.getByRole("combobox", { name: "Market cap", exact: true });
  const platform = page.getByRole("combobox", {
    name: "Platform",
    exact: true,
  });
  await band.selectOption("50k100k");
  await platform.selectOption("bags");
  const reset = page.getByRole("button", {
    name: "Reset filters",
    exact: true,
  });
  await expect(reset).toBeVisible();
  await expectInsideWidth(page, reset);
  await reset.click();
  await expect(band).toHaveValue("all");
  await expect(platform).toHaveValue("all");
  expect(await sampleSymbols(page)).toHaveLength(4);
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(4);
  expect(await recordedOperations(page)).toEqual([
    "action:forumTerminalRefresh:refresh",
  ]);
  expect(chartMints).toHaveLength(1);
  await expectViewportBounded(page);
  expect(errors).toEqual([]);
});

test("loading and truly empty market coverage do not suggest filters can fetch new data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scenario of ["guest&marketloading", "guest&empty"]) {
    const { errors } = await harness(page, scenario);
    await openPane(page, "Markets");
    await expect(
      page.getByText(
        scenario.includes("marketloading")
          ? "Loading the latest sampled tokens…"
          : "No recent tokens match this sample.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Clear search|Reset filters/ }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^View / })).toHaveCount(0);
    expect(await recordedOperations(page)).toEqual([
      "action:forumTerminalRefresh:refresh",
    ]);
    await expectViewportBounded(page);
    expect(errors).toEqual([]);
  }
});

test("sample table sorts real market metrics and keeps unknown values last in both directions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { errors } = await harness(page, "guest");
  await openPane(page, "Markets");
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
  await openPane(page, "Markets");
  await page
    .getByRole("combobox", { name: "Market cap", exact: true })
    .selectOption("50k100k");
  expect(await sampleSymbols(page)).toEqual(["SYMF", "QUIET"]);
  await page
    .getByRole("combobox", { name: "Market cap", exact: true })
    .selectOption("unknown");
  expect(await sampleSymbols(page)).toEqual(["UNKNOWN"]);
  await page.getByText("Coverage & sources", { exact: true }).click();
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
  await openPane(page, "Markets");
  const table = page.getByRole("table", {
    name: "Sampled markets",
    exact: true,
  });
  const nova = table
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: /^View NOVA,/ }) });
  await expect(nova.getByText("Stale", { exact: true }).first()).toBeVisible();
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
  let currentClock = frozenNow;
  // Freeze Date only: React, chart animation frames and transport timers must run.
  await page.clock.setFixedTime(frozenNow);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { errors, chartMints } = await harness(
    page,
    "guest&currentcohort",
    () => currentClock,
  );
  await expect(
    page.getByRole("img", { name: /SYMF USD candlestick chart/ }),
  ).toBeVisible();
  const order = await page
    .getByRole("complementary", { name: "Trade selected token" })
    .elementHandle();
  await openPane(page, "Markets");
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
  await expect(source).toHaveText("6m ago");
  currentClock = frozenNow + 120_000;
  await page.clock.setFixedTime(currentClock);
  // Exercise the terminal's real foreground refresh without pausing React work.
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  expect(await page.evaluate(() => Date.now())).toBe(frozenNow + 120_000);
  await expect(source).toHaveText("8m ago");
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
        .getByRole("navigation", { name: "Terminal dock", exact: true })
        .getByRole("button")
        .all()),
      ...(await page
        .getByRole("group", { name: "Candle interval" })
        .getByRole("button")
        .all()),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await openPane(page, "Receipts");
    const receipt = page.getByText("Outcome protected", { exact: true });
    await expect(receipt).toBeVisible();
    const original = await receipt.elementHandle();
    await openPane(page, "Markets");
    for (const control of [
      page.getByRole("textbox", { name: "Search sampled tokens" }),
      page.getByRole("combobox", { name: "Market cap", exact: true }),
      page.getByRole("combobox", { name: "Platform", exact: true }),
    ])
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(receipt).toBeHidden();
    await openPane(page, "Chart");
    expect(await original?.evaluate((node) => node.isConnected)).toBe(true);
    await openPane(page, "Receipts");
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
  await openPane(page, "Receipts");
  const originalReceipt = await page
    .getByText("Outcome protected", { exact: true })
    .elementHandle();
  await expect(
    page.getByText("No signature recorded", { exact: true }),
  ).toBeVisible();
  await openPane(page, "Chart");
  await expect(
    page
      .getByRole("navigation", { name: "Terminal dock", exact: true })
      .getByRole("button", { name: "Receipts", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await chart.focus();
  await page.keyboard.press("ArrowRight");
  await expect(markets).toBeFocused();
  await expect(markets).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel", { name: "Markets", exact: true }),
  ).toBeVisible();
  await expect(order).toBeVisible();
  expect(await originalReceipt?.evaluate((node) => node.isConnected)).toBe(
    true,
  );
  expect(await originalOrder?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await originalChart?.evaluate((node) => node.isConnected)).toBe(true);
  await openPane(page, "Receipts");
  await expect(
    page.getByText("Outcome protected", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No signature recorded", { exact: true }),
  ).toBeVisible();
  await openPane(page, "Markets");
  await markets.focus();
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
  const selected = page.locator(
    "section[aria-labelledby=terminal-token-title]",
  );
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
    await openPane(page, "Markets");
    const tableRegion = page.getByRole("region", {
      name: "Market data",
      exact: true,
    });
    await tableRegion.focus();
    await expect(tableRegion).toBeFocused();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await openPane(page, "Chart");
    await expect(image).toBeVisible();
    expect((await image.boundingBox())?.width).toBeGreaterThan(280);
    expect(errors).toEqual([]);
  });

test("an empty market sample keeps the forum token shortcut without invented trader rows", async ({
  page,
}) => {
  const { errors } = await harness(page, "guest&empty");
  await openPane(page, "Markets");
  await expect(
    page.getByText("No recent tokens match this sample.", { exact: true }),
  ).toBeVisible();
  const emptyMessage = page.getByText("No recent tokens match this sample.", {
    exact: true,
  });
  expect((await emptyMessage.boundingBox())!.height).toBeLessThan(200);
  await expectInsideWidth(page, emptyMessage);
  await expect(page.getByRole("button", { name: /^View / })).toHaveCount(0);
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
    const dock = await page
      .getByRole("navigation", { name: "Terminal dock", exact: true })
      .boundingBox();
    expect(dock!.y + dock!.height).toBeLessThanOrEqual(1000);
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
    const originalOrder = await page.locator("#terminal-order").elementHandle();
    await openPane(page, "Markets");
    await expect(
      page.getByRole("table", { name: "Sampled markets", exact: true }),
    ).toBeVisible();
    if (width === 1440) await expect(order).toBeVisible();
    else await expect(order).toBeHidden();
    expect(await originalOrder?.evaluate((node) => node.isConnected)).toBe(
      true,
    );
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await openPane(page, "Chart");
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
    "Tips & profile",
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

for (const width of [320, 390])
  test(`all community sections remain visible after selecting receipts and resizing to ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { errors } = await harness(page, "community&guest");
    const nav = page.getByRole("navigation", {
      name: "Community utilities",
      exact: true,
    });
    await nav
      .getByRole("button", { name: "Your receipts", exact: true })
      .click();
    await page.setViewportSize({ width, height: 844 });
    for (const name of [
      "Project hubs",
      "Bounties & research",
      "Tips & profile",
      "Your receipts",
    ]) {
      const button = nav.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      await expectInsideWidth(page, button);
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(
      nav.getByRole("button", { name: "Your receipts", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await nav
      .getByRole("button", { name: "Project hubs", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open your receipts", exact: true })
      .click();
    await expect(
      nav.getByRole("button", { name: "Your receipts", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expectInsideWidth(
      page,
      nav.getByRole("button", { name: "Your receipts", exact: true }),
    );
    const heading = page.getByRole("heading", {
      name: "Sign in to view your receipts",
      exact: true,
    });
    const signIn = page
      .getByRole("region", { name: "Your receipts", exact: true })
      .getByRole("link", { name: "Sign in", exact: true });
    await expect(heading).toBeVisible();
    await expect(signIn).toBeVisible();
    expect(
      (await signIn.boundingBox())!.y - (await heading.boundingBox())!.y,
    ).toBeLessThan(120);
    await expectInsideWidth(page, signIn);
    const href = new URL((await signIn.getAttribute("href"))!, page.url());
    expect(href.pathname).toBe("/signin");
    expect(href.searchParams.get("redirectTo")).toMatch(/\/community$/);
    await expect(
      page.getByText("Protected outcome", { exact: true }),
    ).toHaveCount(0);
    expect(await recordedOperations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

test("community receipt loading and authenticated-empty states remain distinct without payment actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scenario of [
    "community&receiptsloading",
    "community&receiptsempty",
  ]) {
    const { errors } = await harness(page, scenario);
    await page
      .getByRole("button", { name: "Your receipts", exact: true })
      .click();
    const region = page.getByRole("region", {
      name: "Your receipts",
      exact: true,
    });
    if (scenario.includes("receiptsloading")) {
      await expect(region.getByRole("status")).toContainText(
        "Loading private receipts…",
      );
      await expect(
        region.getByRole("heading", {
          name: "No tips or reward payments yet",
          exact: true,
        }),
      ).toHaveCount(0);
    } else {
      await expect(
        region.getByRole("heading", {
          name: "No tips or reward payments yet",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        region.getByText("Loading private receipts…", { exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      region.getByRole("link", { name: "Sign in", exact: true }),
    ).toHaveCount(0);
    await expect(
      region.getByText("Protected outcome", { exact: true }),
    ).toHaveCount(0);
    await expect(region.getByText(/do not pay again/i)).toBeVisible();
    expect(await recordedOperations(page)).toEqual([]);
    expect(errors).toEqual([]);
  }
});

test("pending identity checks do not flash sign-in or expose editable payment fields", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let result = await harness(page, "community&authloading");
  await page
    .getByRole("button", { name: "Your receipts", exact: true })
    .click();
  const receipts = page.getByRole("region", {
    name: "Your receipts",
    exact: true,
  });
  await expect(receipts.getByRole("status")).toContainText(
    "Loading private receipts…",
  );
  await expect(
    receipts.getByRole("link", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  await expect(
    receipts.getByText("Protected outcome", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & { __terminalFixtureQueries: string[] }
      ).__terminalFixtureQueries.includes("forumCommunity:listPayments"),
    ),
  ).toBe(false);
  expect(await recordedOperations(page)).toEqual([]);
  expect(result.errors).toEqual([]);
  result = await harness(page, "community&tipsavailable&authloading");
  await page
    .getByRole("button", { name: "Tips & profile", exact: true })
    .click();
  const support = page.getByRole("region", {
    name: "Tips & profile",
    exact: true,
  });
  await expect(
    support
      .getByText("Checking your community wallet…", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    support.getByRole("heading", {
      name: "Sign in to support a contributor",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(support.getByLabel("Tip amount (SOL)")).toBeHidden();
  expect(await recordedOperations(page)).toEqual([]);
  expect(result.errors).toEqual([]);
});

test("tip loading, no-recipient and signed-out states do not offer an unusable payment form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const scenario of [
    "community&tipsloading",
    "community&guest",
    "community&tipsavailable&guest",
  ]) {
    const { errors } = await harness(page, scenario);
    await page
      .getByRole("button", { name: "Tips & profile", exact: true })
      .click();
    const region = page.getByRole("region", {
      name: "Tips & profile",
      exact: true,
    });
    if (scenario.includes("tipsloading"))
      await expect(region.getByRole("status")).toContainText(
        "Loading contributors who accept tips…",
      );
    else if (scenario.includes("tipsavailable"))
      await expect(
        region.getByRole("heading", {
          name: "Sign in to support a contributor",
          exact: true,
        }),
      ).toBeVisible();
    else {
      await expect(
        region.getByRole("heading", {
          name: "No contributors accept tips yet",
          exact: true,
        }),
      ).toBeVisible();
      const profile = region.getByRole("button", {
        name: "View contributor profile",
        exact: true,
      });
      await profile.click();
      await expect(
        region.getByRole("region", {
          name: "Your contributor profile",
          exact: true,
        }),
      ).toBeFocused();
    }
    await expect(region.getByLabel("Tip amount (SOL)")).toBeHidden();
    await expect(
      region.getByRole("button", { name: "Review one-time tip", exact: true }),
    ).toBeHidden();
    await expect(
      region.getByRole("heading", {
        name: "Your contributor profile",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in with wallet", exact: true }),
    ).toHaveCount(1);
    expect(await recordedOperations(page)).toEqual([]);
    expect(errors).toEqual([]);
  }
});

test("an available contributor keeps the linked-wallet tip form but does not submit on navigation", async ({
  page,
}) => {
  const { errors } = await harness(page, "community&tipsavailable&orderinput");
  await page
    .getByRole("button", { name: "Tips & profile", exact: true })
    .click();
  const amount = page.getByLabel("Tip amount (SOL)");
  await expect(amount).toBeVisible();
  await amount.fill("0.01");
  await page
    .getByRole("combobox", { name: "Contributor", exact: true })
    .selectOption("fixture-member");
  await expect(
    page.getByRole("button", { name: "Review one-time tip", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await recordedOperations(page)).toEqual([]);
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

test("pending contributor settings do not imply tips are disabled or holder proof is absent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await harness(
    page,
    "community&tipsavailable&orderinput&settingsloading",
  );
  await page
    .getByRole("button", { name: "Tips & profile", exact: true })
    .click();
  const profile = page.getByRole("region", {
    name: "Your contributor profile",
    exact: true,
  });
  await expect(profile).toBeVisible();
  await expect(profile.getByRole("status")).toContainText(
    "Loading your contributor settings…",
  );
  await expect(
    profile.getByRole("button", {
      name: /Enable public tips|Disable public tips|Check holder proof|Show holder badge|Hide holder badge/,
    }),
  ).toBeHidden();
  await expect(
    profile.getByText("No current verified holder proof.", { exact: true }),
  ).toBeHidden();
  await expect(
    profile.getByText("Holder proof verified", { exact: true }),
  ).toBeHidden();
  await expect(page.getByLabel("Tip amount (SOL)")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & { __terminalFixtureQueries: string[] }
        ).__terminalFixtureQueries.includes("forumCommunity:getMine"),
      ),
    )
    .toBe(true);
  expect(await recordedOperations(page)).toEqual([]);
  expect(errors).toEqual([]);
});
