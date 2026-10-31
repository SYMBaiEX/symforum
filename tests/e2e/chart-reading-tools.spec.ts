import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43238";
const checkedAt = Date.parse("2026-10-31T12:00:00Z"),
  mint = "So11111111111111111111111111111111111111112";
let script: string, css: string;
test.beforeAll(() => {
  css =
    FORUM_SHARED_THEME_CSS +
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/chart-reading-tools.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env.NODE_ENV":JSON.stringify("production")}});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  source = "geckoterminal",
  copyMode = "ok",
  failure = false,
  newSnapshot = false,
) {
  const errors: string[] = [],
    unexpected: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: checkedAt + 1000 });
  await page.addInitScript((mode) => {
    const win = window as unknown as {
      copied: string[];
      finishCopy?: () => void;
    };
    win.copied = [];
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          win.copied.push(text);
          if (mode === "deny")
            return Promise.reject(Error("Invented clipboard denial"));
          if (mode === "defer")
            return new Promise<void>((resolve) => {
              win.finishCopy = resolve;
            });
          return Promise.resolve();
        },
      },
    });
  }, copyMode);
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
      const selected = url.pathname.match(
        /^\/api\/token\/([^/]+)\/chart$/,
      )?.[1];
      if (selected) {
        requests.push(url.href);
        if (failure && requests.length > 1)
          return route.fulfill({ status: 503, json: { state: "unavailable" } });
        return route.fulfill({
          json: {
            mint: selected,
            pool: "11111111111111111111111111111111",
            interval: url.searchParams.get("interval"),
            checkedAt:
              newSnapshot && requests.length > 1
                ? checkedAt + 300_000
                : checkedAt,
            candleSource: source,
            candles: Array.from({ length: 35 }, (_, index) => ({
              time: Math.floor(checkedAt / 1000) - 3600 + index * 60,
              open: 1 + index,
              high: 2 + index,
              low: 0.5 + index,
              close: 1.5 + index,
              volume: index === 34 ? 0 : index + 0.125,
            })),
          },
        });
      }
    }
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(origin);
  await expect(
    page.getByText("Read candle data", { exact: true }),
  ).toBeVisible();
  await page.getByText("Read candle data", { exact: true }).click();
  return {
    requests,
    check: () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}
const region = (page: Page) =>
  page.getByRole("region", { name: "Recent candle data", exact: true });
const copy = (page: Page) =>
  page.getByRole("button", { name: "Copy displayed readings", exact: true });
const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { copied: string[] }).copied);
for (const source of ["geckoterminal", "solana-tracker"])
  test(`${source} copies exactly the displayed twenty rows with original UTC source context`, async ({
    page,
  }) => {
    const audit = await harness(page, source);
    await expect(
      region(page).getByText("2026-10-31 12:00:00 UTC", { exact: true }),
    ).toBeVisible();
    await expect(
      region(page).getByText(
        source === "geckoterminal" ? "GeckoTerminal" : "Solana Tracker",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(region(page).locator("tbody tr")).toHaveCount(20);
    await expect(copy(page)).toHaveAccessibleDescription(
      /showing latest 20.*volume unit unknown/,
    );
    const canvas = await page.locator("canvas").first().elementHandle();
    const canvasCount = await page.locator("canvas").count();
    const canvasBounds = await page.locator("canvas").first().boundingBox();
    await copy(page).click();
    await expect(region(page).getByRole("status")).toHaveText(
      "Displayed readings copied.",
    );
    const text = (await copied(page))[0],
      lines = text.split("\n");
    const rows = await region(page)
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((row) =>
          Array.from(row.querySelectorAll("td"), (cell) =>
            cell.textContent!.trim(),
          ).join("\t"),
        ),
      );
    expect(lines.slice(-20)).toEqual(rows);
    expect(text).toContain(`Mint: ${mint}`);
    expect(text).toContain("Interval: 15m");
    expect(text).toContain("Source volume unit unknown");
    expect(lines).toHaveLength(26);
    expect(rows[0].split("\t").at(-1)).toBe("0");
    expect(audit.requests).toHaveLength(1);
    expect(await canvas?.evaluate((node) => node.isConnected)).toBe(true);
    expect(await page.locator("canvas").count()).toBe(canvasCount);
    expect(await page.locator("canvas").first().boundingBox()).toEqual(
      canvasBounds,
    );
    audit.check();
  });
test("clipboard denial leaves readable manual fallback without retry or new fetch", async ({
  page,
}) => {
  const audit = await harness(page, "geckoterminal", "deny");
  await copy(page).click();
  await expect(region(page).getByRole("status")).toHaveText(
    "Copy unavailable. Select the readings below and copy them manually.",
  );
  await expect(region(page).locator("tbody tr")).toHaveCount(20);
  expect(await copied(page)).toHaveLength(1);
  expect(audit.requests).toHaveLength(1);
  audit.check();
});
for (const change of ["mint", "interval"])
  test(`deferred clipboard completion cannot claim success for a new ${change}`, async ({
    page,
  }) => {
    const audit = await harness(page, "geckoterminal", "defer");
    await copy(page).click();
    if (change === "mint")
      await page.evaluate(() =>
        window.dispatchEvent(new Event("chart:switch")),
      );
    else await page.getByRole("button", { name: "1h", exact: true }).click();
    await expect.poll(() => audit.requests.length).toBe(2);
    await page.getByText("Read candle data", { exact: true }).click();
    await expect(copy(page)).toBeEnabled();
    await page.evaluate(() =>
      (window as unknown as { finishCopy?: () => void }).finishCopy?.(),
    );
    await expect(region(page).getByRole("status")).toHaveText("");
    expect(await copied(page)).toHaveLength(1);
    audit.check();
  });
test("deferred clipboard completion cannot claim a newer snapshot on the same mounted chart", async ({
  page,
}) => {
  const audit = await harness(page, "geckoterminal", "defer", false, true);
  const canvas = await page.locator("canvas").first().elementHandle();
  await copy(page).click();
  await page.clock.fastForward(6 * 60_000);
  await expect.poll(() => audit.requests.length).toBe(2);
  await expect(
    region(page).getByText("2026-10-31 12:05:00 UTC", { exact: true }),
  ).toBeVisible();
  await expect(copy(page)).toBeEnabled();
  await page.evaluate(() =>
    (window as unknown as { finishCopy?: () => void }).finishCopy?.(),
  );
  await expect(region(page).getByRole("status")).toHaveText("");
  expect((await copied(page))[0]).toContain("Checked: 2026-10-31 12:00:00 UTC");
  expect(await canvas?.evaluate((node) => node.isConnected)).toBe(true);
  audit.check();
});
test("retained data after failed refresh keeps its original full check time", async ({
  page,
}) => {
  const audit = await harness(page, "solana-tracker", "ok", true);
  await page.clock.fastForward(6 * 60_000);
  await expect.poll(() => audit.requests.length).toBe(2);
  await expect(
    region(page).getByText("2026-10-31 12:00:00 UTC", { exact: true }),
  ).toBeVisible();
  await copy(page).click();
  expect((await copied(page))[0]).toContain("Checked: 2026-10-31 12:00:00 UTC");
  audit.check();
});
for (const width of [320, 390])
  test(`copy and full source time remain reachable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const audit = await harness(page);
    await copy(page).scrollIntoViewIfNeeded();
    await expect(copy(page)).toBeVisible();
    const bounds = await copy(page).boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    audit.check();
  });
