import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
import {
  marketMoney,
  marketQuantity,
} from "../../components/trading/terminal-format";
import { formatMarketPercent } from "../../components/trading/market-explorer-model";
const origin = "http://127.0.0.1:43230";
const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const mintB = "So11111111111111111111111111111111111111112";
declare global {
  interface Window {
    __metricInspection: {
      select(mint: string): void;
      reads: string[];
      forbidden: string[];
    };
  }
}
let script: string;
const css = {} as Record<"platform" | "forum", string>;
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
const inspection = (page: Page) =>
  page.getByLabel("Selected metric inspection", { exact: true });
const reading = (page: Page, label: string) =>
  inspection(page).getByRole("listitem", {
    name: `${label} reading`,
    exact: true,
  });
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/token-metric-inspection.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"metric-inspection-only",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^\\.\\/price-chart$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/token-metric-inspection-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  scenario = "",
  app: "platform" | "forum" = "platform",
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    audit.outbound.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?scenario=${scenario}`);
  await expect(
    page.getByRole("heading", { name: "$SAME", exact: true }),
  ).toBeVisible();
}
async function open(page: Page) {
  await page.getByText("Market details & sources", { exact: true }).click();
  await inspection(page).locator("summary").click();
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  expect(
    await page.evaluate(() => window.__metricInspection.forbidden),
  ).toEqual([]);
});
for (const scenario of ["", "chart", "chart-missing", "zero", "unavailable"])
  test(`${scenario || "indexed"} compact metrics retain their original formatting and selection when inspection opens`, async ({
    page,
  }) => {
    await harness(page, scenario);
    const zero = scenario === "zero",
      unavailable = scenario === "unavailable";
    const chart = scenario === "chart" || scenario === "chart-missing";
    const statsMissing = scenario === "chart-missing";
    // Independent expectations from the pre-inspection compact display rules.
    const price = chart
      ? 0.000000000987654321
      : unavailable
        ? null
        : zero
          ? 0
          : 0.000000000123456789;
    const cap = zero ? 0 : null;
    const liquidity =
      statsMissing || unavailable
        ? null
        : scenario === "chart"
          ? 45678.1234
          : zero
            ? 0
            : 12345.6789;
    const fdv =
      statsMissing || unavailable
        ? null
        : scenario === "chart"
          ? 9876543.21
          : zero
            ? 0
            : 1234567.89;
    const volume24h =
      statsMissing || unavailable
        ? null
        : scenario === "chart"
          ? 87654.321
          : zero
            ? 0
            : 54321.1234;
    const volume1h = unavailable ? null : zero ? 0 : 765.4321;
    const change = unavailable ? null : zero ? 0 : -0.00123456789;
    const expected = [
      [marketMoney(price)],
      [
        marketMoney(cap, true),
        marketMoney(liquidity, true),
        marketMoney(volume24h, true),
        formatMarketPercent(change),
      ],
      [
        marketMoney(volume1h, true),
        marketMoney(fdv, true),
        marketQuantity(zero ? 0 : 1234),
        marketMoney(volume24h, true),
        formatMarketPercent(change),
      ],
    ];
    for (let i = 0; i < expected.length; i++)
      expect(
        await page.locator("dl").nth(i).locator("dd").allTextContents(),
      ).toEqual(expected[i]);
    await expect(inspection(page)).not.toHaveAttribute("open");
    await open(page);
    for (let i = 0; i < expected.length; i++)
      expect(
        await page.locator("dl").nth(i).locator("dd").allTextContents(),
      ).toEqual(expected[i]);
  });
test("fresh chart readings retain original holder and one-hour sources and times", async ({
  page,
}) => {
  await harness(page, "chart");
  await open(page);
  await expect(reading(page, "Price")).toContainText(
    "0.000000000987654321 USD",
  );
  await expect(reading(page, "Price")).toContainText(
    "Chart market response (provider not supplied)",
  );
  await expect(reading(page, "Price").locator("time")).toHaveAttribute(
    "datetime",
    "2026-10-31T11:59:00.000Z",
  );
  for (const label of ["Holders", "1h volume", "1h change"]) {
    await expect(reading(page, label)).toContainText("Stale sample");
    await expect(reading(page, label).locator("time")).toHaveAttribute(
      "datetime",
      "2026-10-31T10:00:00.000Z",
    );
    await expect(reading(page, label).getByRole("link")).toHaveAttribute(
      "href",
      "https://indexed.example.test/original",
    );
  }
  await expect(reading(page, "Market cap")).toContainText("Unavailable");
  await expect(reading(page, "FDV")).toContainText("9876543.21 USD");
  await expect(reading(page, "1h change")).toContainText("-0.00123456789 %");
});
test("refreshed market sample does not retime holders and gives distinct exact-mint source names", async ({
  page,
}) => {
  await harness(page, "overlay");
  await open(page);
  for (const label of ["Price", "1h volume", "1h change", "24h volume"]) {
    await expect(reading(page, label)).toContainText("Refreshed market sample");
    await expect(reading(page, label).locator("time")).toHaveAttribute(
      "datetime",
      "2026-10-31T11:59:00.000Z",
    );
    await expect(
      reading(page, label).getByRole("link", {
        name: `${label} sample source for ${mintA}`,
        exact: true,
      }),
    ).toHaveAttribute("href", "https://refreshed.example.test/pool");
  }
  await expect(reading(page, "Holders")).toContainText("1234 addresses");
  await expect(reading(page, "Holders")).toContainText("Stale sample");
  await expect(reading(page, "Holders").locator("time")).toHaveAttribute(
    "datetime",
    "2026-10-31T10:00:00.000Z",
  );
});
test("zero is inspectable while missing cap stays missing beside FDV and tiny values stay unabridged", async ({
  page,
}) => {
  await harness(page);
  await open(page);
  await expect(reading(page, "Market cap")).toContainText("Unavailable");
  await expect(reading(page, "FDV")).toContainText("1234567.89 USD");
  await expect(reading(page, "Price")).toContainText(
    "0.000000000123456789 USD",
  );
  await page.goto(`${origin}/?scenario=zero`);
  await open(page);
  for (const label of [
    "Price",
    "Market cap",
    "Liquidity",
    "1h volume",
    "FDV",
    "24h volume",
  ])
    await expect(reading(page, label)).toContainText("0 USD");
  await expect(reading(page, "Holders")).toContainText("0 addresses");
  await expect(reading(page, "1h change")).toContainText("0 %");
});
test("missing checked-chart stats never fall back to older indexed values", async ({
  page,
}) => {
  await harness(page, "chart-missing");
  await open(page);
  for (const label of ["Market cap", "FDV", "Liquidity", "24h volume"])
    await expect(reading(page, label)).toContainText("Unavailable");
  await expect(reading(page, "Holders")).toContainText("1234 addresses");
});
test("changing between duplicate symbols excludes the old mint's checked readings", async ({
  page,
}) => {
  await harness(page, "chart");
  await open(page);
  await expect(reading(page, "Price")).toContainText(
    "0.000000000987654321 USD",
  );
  await page.getByRole("button", { name: "Token B", exact: true }).click();
  await expect(reading(page, "Price")).toContainText("0.25 USD");
  await expect(reading(page, "Price")).toContainText("Indexed market sample");
  await expect(inspection(page)).not.toContainText("Chart market response");
  await expect(reading(page, "Price").getByRole("link")).toHaveAccessibleName(
    `Price sample source for ${mintB}`,
  );
});
for (const scenario of ["missing", "loading", "invalid-time", "unavailable"])
  test(`${scenario} inspection does not invent numeric values or observation times`, async ({
    page,
  }) => {
    await harness(page, scenario);
    await open(page);
    if (scenario === "invalid-time") {
      await expect(inspection(page).locator("time")).toHaveCount(0);
      await expect(reading(page, "Price")).toContainText(
        "Observation time unavailable",
      );
    } else if (scenario === "unavailable") {
      await expect(reading(page, "Price")).toContainText("Unavailable");
      await expect(reading(page, "Price")).toContainText(
        "Source data unavailable",
      );
      await expect(reading(page, "Holders")).toContainText("1234 addresses");
    } else {
      await expect(inspection(page).locator("time")).toHaveCount(0);
      for (const label of ["Price", "Market cap", "Holders"])
        await expect(reading(page, label)).toContainText("Unavailable");
    }
  });
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px keyboard inspection remains inside its actual scrollport without new reads`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      await harness(page, "chart", app);
      await expect(inspection(page).locator("summary")).toBeHidden();
      const outer = page.getByText("Market details & sources", { exact: true });
      await outer.focus();
      await page.keyboard.press("Enter");
      const summary = inspection(page).locator("summary");
      await summary.focus();
      await expect(summary).toBeFocused();
      expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Enter");
      const workspace = page.getByRole("region", {
        name: "Loaded metric workspace",
        exact: true,
      });
      for (const label of [
        "Price",
        "Market cap",
        "Liquidity",
        "1h volume",
        "FDV",
        "Holders",
        "24h volume",
        "1h change",
      ]) {
        const row = reading(page, label);
        await row.scrollIntoViewIfNeeded();
        const box = (await row.boundingBox())!,
          port = (await workspace.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(port.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(port.x + port.width + 1);
        expect(
          await row.evaluate(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        ).toBe(true);
        await expect(row).toBeVisible();
      }
      await summary.focus();
      await page.keyboard.press("Tab");
      await expect(reading(page, "1h volume").getByRole("link")).toBeFocused();
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(summary).toBeFocused();
      await expect(reading(page, "Price")).toBeHidden();
      expect(
        await workspace.evaluate(
          (node) => node.scrollHeight > node.clientHeight,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(() => document.scrollingElement?.scrollTop),
      ).toBe(0);
      expect(
        await page.evaluate(() => window.__metricInspection.reads),
      ).toEqual([mintA]);
    });
