import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const origin = "http://127.0.0.1:43251",
  checkedAt = Date.parse("2026-10-31T14:00:00Z"),
  deadline = checkedAt + 600_000;
let script: string;
const css = new Map<string, string>();
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
    css.set(
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
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/chart-retry-guidance.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[{name:"isolated-retry-renderer",setup(build){build.onResolve({filter:/^lightweight-charts$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/chart-retry-guidance-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));for(const file of r.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
  );
});
const note = (page: Page) =>
  page.getByRole("note", { name: "Chart retry eligibility", exact: true });
const summary = (page: Page) =>
  page.getByText("Read candle data", { exact: true });
const renderer = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          chartEvidence: { created: number; removed: number };
        }
      ).chartEvidence,
  );
async function harness(page: Page, state = "budget", app = "platform") {
  const errors: string[] = [],
    unexpected: string[] = [],
    requests: number[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: checkedAt + 1000 });
  await page.clock.pauseAt(checkedAt + 1000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.get(app)}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (url.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
      if (
        url.pathname ===
        "/api/token/So11111111111111111111111111111111111111112/chart"
      ) {
        requests.push(Date.now());
        if (requests.length === 1)
          return route.fulfill({
            json: {
              state: "ready",
              cache: { nextRetryAt: checkedAt + 60_000 },
              mint: "So11111111111111111111111111111111111111112",
              pool: "11111111111111111111111111111111",
              interval: "15m",
              checkedAt,
              candleSource: "solana-tracker",
              candles: Array.from({ length: 35 }, (_, i) => ({
                time: checkedAt / 1000 - 3600 + i * 60,
                open: i + 1,
                high: i + 2,
                low: i + 0.5,
                close: i + 1.5,
                volume: i,
              })),
            },
          });
        return route.fulfill({
          status:
            state === "budget" ? 429 : state === "unsupported" ? 400 : 503,
          json: {
            state: state === "invalid" ? "unavailable" : state,
            cache: {
              nextRetryAt: state === "invalid" ? "not-a-date" : deadline,
            },
          },
        });
      }
    }
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(origin);
  await expect.poll(async () => (await renderer(page))?.created).toBe(1);
  return {
    requests,
    check: () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}
async function fail(page: Page) {
  await page.clock.runFor(59_000);
  await expect(
    page.getByText(/Showing last checked data\./).first(),
  ).toBeVisible();
}

for (const state of ["budget", "unavailable"])
  test(`retained ${state}: original source/canvas and UTC retry eligibility without independent refresh`, async ({
    page,
  }) => {
    const run = await harness(page, state);
    const canvas = await page
      .getByRole("img", { name: /USD candlestick chart/ })
      .elementHandle();
    await expect(note(page)).toHaveCount(0);
    await expect(summary(page).locator("..")).not.toHaveAttribute("open", "");
    await fail(page);
    expect(run.requests).toHaveLength(2);
    await expect(note(page)).toBeHidden();
    await summary(page).focus();
    await page.keyboard.press("Enter");
    await expect(note(page)).toBeVisible();
    await expect(note(page)).toContainText(
      state === "budget"
        ? "Free-data allowance reached."
        : "Chart source is temporarily unavailable.",
    );
    await expect(note(page).locator("time")).toHaveAttribute(
      "datetime",
      new Date(deadline).toISOString(),
    );
    await expect(note(page)).toContainText("2026-10-31 14:10:00.000 UTC");
    await expect(note(page)).toContainText(
      "Eligibility is not a refresh guarantee.",
    );
    await expect(
      page.getByText("Solana Tracker", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(`time[datetime="${new Date(checkedAt).toISOString()}"]`),
    ).toHaveCount(1);
    await summary(page).press("Enter");
    await summary(page).press("Enter");
    expect(run.requests).toHaveLength(2);
    expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await renderer(page)).toMatchObject({ created: 1, removed: 0 });
    await page.clock.runFor(539_000);
    expect(run.requests).toHaveLength(2);
    run.check();
  });
test("unsupported retained policy has no invented retry deadline", async ({
  page,
}) => {
  const run = await harness(page, "unsupported");
  await fail(page);
  await summary(page).click();
  await expect(note(page)).toContainText(
    "No chart is supported for this indexed token.",
  );
  await expect(note(page)).toContainText(
    "No retry eligibility time is available for this chart.",
  );
  await expect(note(page).locator("time")).toHaveCount(0);
  await page.clock.runFor(600_000);
  expect(run.requests).toHaveLength(2);
  run.check();
});
test("malformed raw deadline is never formatted as a date; existing bounded fallback remains authoritative", async ({
  page,
}) => {
  const run = await harness(page, "invalid");
  await fail(page);
  await summary(page).click();
  await expect(note(page).locator("time")).toHaveAttribute(
    "datetime",
    new Date(checkedAt + 120_000).toISOString(),
  );
  await expect(note(page)).not.toContainText(/Invalid Date|not-a-date/);
  expect(run.requests).toHaveLength(2);
  run.check();
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px: retry detail is keyboard accessible, bounded and initially closed`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      const run = await harness(page, "budget", app);
      await fail(page);
      await expect(note(page)).toBeHidden();
      await summary(page).scrollIntoViewIfNeeded();
      const target = await summary(page).boundingBox();
      expect(target!.height).toBeGreaterThanOrEqual(44);
      await summary(page).focus();
      await page.keyboard.press("Enter");
      await expect(note(page)).toBeVisible();
      await note(page).scrollIntoViewIfNeeded();
      const bounds = await note(page).evaluate((node) => {
        const r = node.getBoundingClientRect();
        return {
          x: r.x,
          right: r.right,
          content: node.scrollWidth,
          width: node.clientWidth,
        };
      });
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.content).toBeLessThanOrEqual(bounds.width);
      expect(run.requests).toHaveLength(2);
      await page.screenshot({
        path: `tmp/chart-retry-guidance/${app}-${width}.png`,
      });
      run.check();
    });
