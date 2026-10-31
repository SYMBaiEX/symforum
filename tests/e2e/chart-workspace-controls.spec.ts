import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const origin = "http://127.0.0.1:43249";
let script: string;
const appCss = new Map<string, string>();
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
    appCss.set(
      app,
      FORUM_SHARED_THEME_CSS +
        readFileSync("styles/forum-shared.css", "utf8") +
        execFileSync(
          "bun",
          [
            "-e",
            `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
          ],
          { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
        ),
    );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/chart-workspace-controls.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"isolated-workspace",setup(build){build.onLoad({filter:/price-chart[.]tsx$/},async(args)=>({contents:(await Bun.file(args.path).text()).replace('import("lightweight-charts")','window.__loadFixtureChartLibrary()'),loader:"tsx"}));for(const [filter,file] of [[/^lightweight-charts$/,"chart-workspace-controls-state.tsx"],[/^convex\\/react$/,"terminal-convex.ts"],[/^next\\/navigation$/,"identity-navigation.ts"],[/^@\\/lib\\/commerce-wallet-client$/,"terminal-wallet-client.ts"],[/commerce-wallet$/,"terminal-wallet.tsx"]])build.onResolve({filter},()=>({path:process.cwd()+"/tests/e2e/fixtures/"+file}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 7 * 1024 * 1024 },
  );
});

type EvidenceWindow = Window & {
  chartEvidence: {
    created: number;
    removed: number;
    fit: number;
    autoScale: number;
  };
  panFixtureChart: () => void;
  fixtureChartRange: () => { from: number; to: number };
  __deferChartImports: () => void;
  __pendingChartImports: () => number;
  __releaseChartImport: () => void;
};
const evidence = (page: Page) =>
  page.evaluate(() => (window as unknown as EvidenceWindow).chartEvidence);
const tools = (page: Page) =>
  page.getByRole("button", { name: "Chart tools", exact: true });
async function item(page: Page, name: string) {
  await tools(page).click();
  return page.getByRole("menuitem", { name, exact: true });
}
async function harness(page: Page, app = "platform", scenario = "") {
  const errors: string[] = [],
    unexpected: string[] = [],
    requests: string[] = [];
  const pending: Array<() => Promise<void>> = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${appCss.get(app)}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (url.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
      if (url.pathname === "/images/brand/symforum-icon-64.png")
        return route.fulfill({
          contentType: "image/png",
          body: readFileSync("public/images/brand/symforum-icon-64.png"),
        });
      if (url.pathname.endsWith("/chart")) {
        requests.push(url.href);
        const respond = () =>
          route.fulfill({
            json: {
              mint: url.pathname.split("/")[3],
              pool: "11111111111111111111111111111111",
              interval: url.searchParams.get("interval"),
              checkedAt: Date.now(),
              candleSource: "geckoterminal",
              candles: Array.from({ length: 35 }, (_, i) => ({
                time: Math.floor(Date.now() / 1000) - 3600 + i * 60,
                open: i + 1,
                high: i + 2,
                low: i + 0.5,
                close: i + 1.5,
                volume: i,
              })),
            },
          });
        if (scenario.includes("pending") && requests.length > 1) {
          pending.push(respond);
          return;
        }
        if (scenario.includes("unavailable"))
          return route.fulfill({ status: 503, json: { state: "unavailable" } });
        return respond();
      }
    }
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?${scenario}`);
  await expect(tools(page)).toBeVisible();
  return {
    requests,
    pending,
    check: () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}
async function ready(page: Page) {
  await expect.poll(async () => (await evidence(page))?.created).toBe(1);
  await expect(page.getByText("Drawing chart…", { exact: true })).toHaveCount(
    0,
  );
}

test("real renderer expands/restores and resets both axes without remounting or refreshing", async ({
  page,
}) => {
  const run = await harness(page);
  await ready(page);
  const canvas = await page
    .getByRole("img", { name: /USD candlestick chart/ })
    .elementHandle();
  const before = await canvas!.boundingBox();
  await page.evaluate(() =>
    (window as unknown as EvidenceWindow).panFixtureChart(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as EvidenceWindow).fixtureChartRange().to,
      ),
    )
    .toBe(12);
  const range = await page.evaluate(() =>
    (window as unknown as EvidenceWindow).fixtureChartRange(),
  );
  await (await item(page, "Expand chart")).click();
  await expect(page.locator('[data-chart-expanded="true"]')).toHaveCount(1);
  expect((await canvas!.boundingBox())!.height).toBeGreaterThan(before!.height);
  expect(
    await page.evaluate(() =>
      (window as unknown as EvidenceWindow).fixtureChartRange(),
    ),
  ).toEqual(range);
  await (await item(page, "Reset chart view")).click();
  await expect(
    page.getByText("Chart view reset to loaded candles.", { exact: true }),
  ).toHaveCount(1);
  const reset = await evidence(page);
  expect(reset.fit).toBe(2);
  expect(reset.autoScale).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as EvidenceWindow).fixtureChartRange().to,
      ),
    )
    .toBeGreaterThanOrEqual(34);
  const resetRange = await page.evaluate(() =>
    (window as unknown as EvidenceWindow).fixtureChartRange(),
  );
  expect(resetRange.from).toBeLessThanOrEqual(0);
  expect(resetRange.to).toBeGreaterThanOrEqual(34);
  await tools(page).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-chart-expanded="true"]')).toHaveCount(0);
  await expect(tools(page)).toBeFocused();
  for (let i = 0; i < 2; i++) {
    await (await item(page, "Expand chart")).click();
    await (await item(page, "Restore chart size")).click();
  }
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
  expect(await evidence(page)).toMatchObject({ created: 1, removed: 0 });
  expect(run.requests).toHaveLength(1);
  run.check();
});

for (const held of [false, true])
  test(`composed terminal keeps ${held ? "protected receipt" : "quoted order"} mounted while chart expands`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const run = await harness(
      page,
      "forum",
      `terminal&orderquote${held ? "&held" : ""}`,
    );
    await ready(page);
    const order = page.getByRole("complementary", {
      name: "Trade selected token",
    });
    const orderNode = await order.elementHandle();
    const amount = order.getByRole("textbox", { name: "You pay", exact: true });
    await amount.fill("1");
    if (held)
      await expect(
        order.getByRole("button", { name: "View swap status", exact: true }),
      ).toBeVisible();
    else
      await expect(
        order.getByRole("status", { name: "You receive", exact: true }),
      ).toHaveText("123.456789");
    const actionsBefore = await page.evaluate(() => [
      ...(window as unknown as { __terminalFixtureCalls: string[] })
        .__terminalFixtureCalls,
    ]);
    const canvas = await page
      .getByRole("img", { name: /USD candlestick chart/ })
      .elementHandle();
    const count = run.requests.length;
    await (await item(page, "Expand chart")).click();
    await expect(order).toBeVisible();
    await expect(amount).toHaveValue("1");
    expect(await orderNode!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
    if (held) {
      const status = order.getByRole("button", {
        name: "View swap status",
        exact: true,
      });
      await status.scrollIntoViewIfNeeded();
      await status.click();
      await expect(
        order.getByText(/A previous wallet request needs verification/),
      ).toBeVisible();
    }
    await tools(page).scrollIntoViewIfNeeded();
    await (await item(page, "Restore chart size")).click();
    await expect(tools(page)).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __terminalFixtureCalls: string[] })
            .__terminalFixtureCalls,
      ),
    ).toEqual(actionsBefore);
    expect(await evidence(page)).toMatchObject({ created: 1, removed: 0 });
    expect(run.requests).toHaveLength(count);
    await page.screenshot({
      path: `tmp/chart-workspace-controls/terminal-${held ? "protected" : "quote"}.png`,
    });
    run.check();
  });

test("context loading disables old API reset and failed renderer never claims readiness", async ({
  page,
}) => {
  const run = await harness(page, "platform", "pending");
  await ready(page);
  await (await item(page, "Expand chart")).click();
  await page.getByRole("button", { name: "1h", exact: true }).click();
  await expect.poll(() => run.pending.length).toBe(1);
  await expect(await item(page, "Reset chart view")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(await item(page, "Restore chart size")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await run.pending.shift()!();
  await expect.poll(async () => (await evidence(page)).created).toBe(2);
  await expect(await item(page, "Reset chart view")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.dispatchEvent(new Event("chart:switch")));
  await expect.poll(() => run.pending.length).toBe(1);
  await expect(await item(page, "Reset chart view")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await run.pending.shift()!();
  await expect.poll(async () => (await evidence(page)).created).toBe(3);
  expect(run.requests).toHaveLength(3);
  run.check();
});

test("delayed theme import and ABA theme changes cannot advertise a removed renderer", async ({
  page,
}) => {
  const run = await harness(page);
  await ready(page);
  await page.evaluate(() => {
    (window as unknown as EvidenceWindow).__deferChartImports();
    window.dispatchEvent(new CustomEvent("chart:light", { detail: true }));
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as EvidenceWindow).__pendingChartImports(),
      ),
    )
    .toBe(1);
  await expect(await item(page, "Reset chart view")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("chart:light", { detail: false })),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as EvidenceWindow).__pendingChartImports(),
      ),
    )
    .toBe(2);
  await expect(await item(page, "Reset chart view")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    (window as unknown as EvidenceWindow).__releaseChartImport(),
  );
  await expect(await item(page, "Reset chart view")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Escape");
  expect(await evidence(page)).toMatchObject({ created: 1, removed: 1 });
  await page.evaluate(() =>
    (window as unknown as EvidenceWindow).__releaseChartImport(),
  );
  await expect.poll(async () => (await evidence(page)).created).toBe(2);
  await expect(await item(page, "Reset chart view")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(run.requests).toHaveLength(1);
  run.check();
});

for (const scenario of ["canvasfail", "unavailable"])
  test(`${scenario}: tools remain honest without a ready API`, async ({
    page,
  }) => {
    const run = await harness(page, "platform", scenario);
    await expect(await item(page, "Reset chart view")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(
      page.getByRole("menuitem", { name: "Expand chart", exact: true }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(run.requests).toHaveLength(1);
    run.check();
  });

test("Escape in a protected dialog does not restore the chart", async ({
  page,
}) => {
  const run = await harness(page);
  await ready(page);
  await (await item(page, "Expand chart")).click();
  await page.evaluate(() => window.dispatchEvent(new Event("chart:dialog")));
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-chart-expanded="true"]')).toHaveCount(1);
  run.check();
});

for (const app of ["platform", "forum"])
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 720 },
  ])
    test(`${app} ${viewport.width}x${viewport.height}: bounded immediate controls and reachable restore`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const run = await harness(page, app);
      await ready(page);
      const trigger = tools(page),
        box = await trigger.boundingBox();
      const group = await page
        .getByRole("group", { name: "Candle interval", exact: true })
        .boundingBox();
      expect(group!.x).toBeGreaterThanOrEqual(0);
      expect(group!.x + group!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(
        await trigger.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          return hit === node || node.contains(hit);
        }),
      ).toBe(true);
      await trigger.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await expect(page.locator('[data-chart-expanded="true"]')).toHaveCount(1);
      const duration = await page
        .getByRole("img", { name: /USD candlestick chart/ })
        .evaluate((node) => getComputedStyle(node).transitionDuration);
      // Both actual app styles reduce transitions to 0.01ms, not literal zero.
      expect(parseFloat(duration)).toBeLessThanOrEqual(0.00001);
      await trigger.focus();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(page.locator('[data-chart-expanded="true"]')).toHaveCount(0);
      expect(await evidence(page)).toMatchObject({ created: 1, removed: 0 });
      expect(run.requests).toHaveLength(1);
      if (viewport.width <= 390)
        await page.screenshot({
          path: `tmp/chart-workspace-controls/${app}-${viewport.width}.png`,
        });
      run.check();
    });
