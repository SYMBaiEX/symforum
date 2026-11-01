import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43258",
  mint = "So11111111111111111111111111111111111111112";
const checkedAt = Date.parse("2026-11-01T00:00:00Z"),
  first = Date.parse("2026-10-31T00:00:00Z") / 1000;
let script: string;
const css = {} as Record<"platform" | "forum", string>;
const audits = new WeakMap<
  Page,
  { errors: string[]; unexpected: string[]; requests: string[] }
>();
test.beforeAll(() => {
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
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/candle-gaps.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[{name:"instrument-installed-real-chart-only",setup(build){build.onResolve({filter:/^lightweight-charts$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/candle-gaps-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));for(const file of r.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
  );
});
const note = (page: Page) =>
  page.getByRole("note", { name: "Loaded candle coverage", exact: true });
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
async function harness(
  page: Page,
  mode = "sparse",
  app: "platform" | "forum" = "platform",
) {
  const audit = {
    errors: [] as string[],
    unexpected: [] as string[],
    requests: [] as string[],
  };
  audits.set(page, audit);
  page.on("pageerror", (e) => audit.errors.push(e.message));
  await page.clock.install({ time: checkedAt + 1000 });
  await page.clock.pauseAt(checkedAt + 1000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (url.origin === origin && url.pathname === `/api/token/${mint}/chart`) {
      const interval = url.searchParams.get("interval")!;
      audit.requests.push(interval);
      const step = (
        { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 } as Record<
          string,
          number
        >
      )[interval];
      const slots =
        mode === "single"
          ? [0]
          : mode === "empty"
            ? []
            : mode === "duplicate"
              ? [0, 1, 1]
              : mode === "out-of-order"
                ? [0, 2, 1]
                : mode === "contiguous"
                  ? [0, 1, 2, 3]
                  : [0, 1, 4, 5];
      return route.fulfill({
        json: {
          state: "ready",
          cache: { nextRetryAt: checkedAt + 600_000 },
          mint,
          pool: "11111111111111111111111111111111",
          interval,
          checkedAt,
          candleSource: "solana-tracker",
          stale: mode === "stale",
          candles: slots.map((slot) => ({
            time:
              (first + slot * step + (mode === "offset" ? 1 : 0)) *
              (mode === "milliseconds" ? 1000 : 1),
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 0,
          })),
        },
      });
    }
    audit.unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(origin);
  return audit;
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.unexpected).toEqual([]);
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}: closed by default; exact loaded gaps and caution stay bounded with keyboard and reduced motion`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const audit = await harness(page, "sparse", app);
      await expect.poll(async () => (await renderer(page))?.created).toBe(1);
      await expect(note(page)).toBeHidden();
      const canvas = await page
        .getByRole("img", { name: /USD candlestick chart/ })
        .elementHandle();
      const chartBox = (await page
        .getByRole("img", { name: /USD candlestick chart/ })
        .boundingBox())!;
      await summary(page).focus();
      expect(
        (await summary(page).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Enter");
      await expect(note(page)).toContainText(
        "2 unrepresented 15m UTC interval slots across 1 gap between 4 loaded bars.",
      );
      await expect(note(page)).toContainText(
        "do not prove zero trading or complete provider history",
      );
      await expect(note(page)).toContainText(
        "No candles are filled in or synthesized.",
      );
      const box = (await note(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(
        await note(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      expect(
        await page
          .getByRole("img", { name: /USD candlestick chart/ })
          .evaluate((el, original) => el === original, canvas),
      ).toBe(true);
      expect(
        (await page
          .getByRole("img", { name: /USD candlestick chart/ })
          .boundingBox())!.height,
      ).toBe(chartBox.height);
      expect(audit.requests).toEqual(["15m"]);
      expect(await renderer(page)).toMatchObject({ created: 1, removed: 0 });
    });
test("changing the existing interval recomputes the same loaded-slot evidence without extra requests", async ({
  page,
}) => {
  const audit = await harness(page);
  await summary(page).click();
  for (const interval of ["15m", "1m", "5m", "1h", "4h"]) {
    if (interval !== "15m") {
      await page.getByRole("button", { name: interval, exact: true }).click();
      // The existing mint/interval-keyed controller replaces its disclosure.
      // Reopen deliberately; gap copy must not change that lifecycle contract.
      await expect(summary(page)).toBeVisible();
      await expect(summary(page).locator("..")).not.toHaveAttribute("open", "");
      await summary(page).click();
    }
    await expect(note(page)).toContainText(
      `2 unrepresented ${interval} UTC interval slots`,
    );
  }
  expect(audit.requests).toEqual(["15m", "1m", "5m", "1h", "4h"]);
});
for (const mode of ["single", "offset", "contiguous", "stale"])
  test(`${mode}: coverage copy is conservative and keeps original checked source`, async ({
    page,
  }) => {
    const audit = await harness(page, mode);
    await summary(page).click();
    await expect(note(page)).toContainText(
      mode === "single"
        ? "At least two aligned timestamps"
        : mode === "offset"
          ? "Gap counts cannot be assessed"
          : mode === "contiguous"
            ? "No skipped 15m UTC interval slots"
            : "2 unrepresented 15m UTC interval slots",
    );
    await expect(
      page.getByRole("region", { name: "Recent candle data", exact: true }),
    ).toContainText("Solana Tracker");
    await expect(
      page.getByRole("region", { name: "Recent candle data", exact: true }),
    ).toContainText("2026-11-01 00:00:00 UTC");
    expect(audit.requests).toEqual(["15m"]);
  });
for (const mode of ["duplicate", "out-of-order", "empty", "milliseconds"])
  test(`${mode}: existing parser rejects the payload instead of presenting a repaired gap count`, async ({
    page,
  }) => {
    const audit = await harness(page, mode);
    await expect(
      page.getByText(/Chart source is temporarily unavailable/),
    ).toBeVisible();
    await expect(note(page)).toHaveCount(0);
    expect(audit.requests).toEqual(["15m"]);
  });
