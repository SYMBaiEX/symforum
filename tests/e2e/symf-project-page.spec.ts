import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43267";
const installation = JSON.parse(
  readFileSync("tests/fixtures/installation.symbaiex.json", "utf8"),
);
const mint: string = installation.token.mint;
const css = {} as Record<"platform" | "forum", string>;
let script: string;
let realScript: string;
let optionalBlankScript: string;
type Snapshot = {
  reads: { name: string; args: unknown }[];
  actions: string[];
  providerMounts: number;
  providerUnmounts: number;
  swapMounts: number;
  swapUnmounts: number;
  outputs: unknown[];
  markets: { token: { mint: string }; now: number }[];
};
const audits = new WeakMap<
  Page,
  { errors: string[]; outbound: string[]; charts: string[] }
>();
const snapshot = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __symfPage: Snapshot }).__symfPage,
  );
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
  function build(real: boolean, optionalBlank = false) {
    const config = structuredClone(installation);
    if (optionalBlank) {
      config.telegram.url = "";
      delete config.x.accounts.symforum;
      config.x.publisherUserId = "";
      config.token.announcementPath = "";
    }
    const filter = real
      ? /^convex\/react$|^convex-helpers\/react\/cache\/hooks$|^next\/navigation$|^next\/link$|^next-themes$|commerce-wallet$/
      : /^convex\/react$|^convex-helpers\/react\/cache\/hooks$|^next\/navigation$|^next\/link$|^next-themes$|commerce-wallet$|trading\/token-detail$|swap\/token-swap$/;
    return execFileSync(
      "bun",
      [
        "-e",
        `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/symf-project-page.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:${JSON.stringify(JSON.stringify(config))}})},plugins:[{name:"symf-page-inert-seams",setup(build){build.onResolve({filter:${filter.toString()}},()=>({path:process.cwd()+"/tests/e2e/fixtures/symf-project-page-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));for(const f of r.outputs){if(f.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await f.text())+"}));");else process.stdout.write(await f.text());}`,
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
  }
  script = build(false);
  realScript = build(true);
  optionalBlankScript = build(false, true);
});
async function open(
  page: Page,
  suffix = "",
  app: "platform" | "forum" = "platform",
  path = `/community?mint=${mint}&section=projects`,
  real = false,
  optionalBlank = false,
) {
  const audit = {
    errors: [] as string[],
    outbound: [] as string[],
    charts: [] as string[],
  };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (["/community", "/forum/community"].includes(url.pathname))
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (url.pathname === "/fixture.js")
        return route.fulfill({
          contentType: "text/javascript",
          body: optionalBlank
            ? optionalBlankScript
            : real
              ? realScript
              : script,
        });
      if (real && url.pathname === `/api/token/${mint}/chart`) {
        audit.charts.push(url.href);
        const now = Date.now();
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            state: "ready",
            mint,
            pool: installation.token.pool,
            interval: url.searchParams.get("interval") ?? "15m",
            checkedAt: now,
            candleSource: "geckoterminal",
            priceUsd: 0.00008,
            stats: {
              marketCap: 80000,
              fdv: 80000,
              liquidity: 12345,
              volume24h: 45678,
            },
            candles: Array.from({ length: 12 }, (_, index) => ({
              time: Math.floor(now / 1000) - (12 - index) * 900,
              open: 0.00007 + index * 0.000001,
              high: 0.000075 + index * 0.000001,
              low: 0.000065 + index * 0.000001,
              close: 0.000072 + index * 0.000001,
              volume: 100 + index * 12,
            })),
          }),
        });
      }
      const image =
        url.pathname === "/_next/image"
          ? url.searchParams.get("url")
          : url.pathname;
      if (
        image &&
        [
          "/images/home-banner-light.webp",
          "/images/home-banner-dark.webp",
          "/images/brand/symforum-icon-192.png",
          "/images/brand/symforum-icon-64.png",
        ].includes(image)
      )
        return route.fulfill({
          contentType: image.endsWith(".png") ? "image/png" : "image/webp",
          body: readFileSync(`public${image}`),
        });
    }
    audit.outbound.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}${path}${suffix ? `&${suffix}` : ""}`);
}
const pageHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: /SYMBaiEX Forum/ });
const utility = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Community utilities", exact: true })
    .getByRole("button", { name, exact: true });
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  expect((await snapshot(page)).actions).toEqual([]);
});
test("missing optional social and announcement configuration produces no fabricated destination or broader search", async ({
  page,
}) => {
  await open(
    page,
    "guest",
    "platform",
    `/community?mint=${mint}&section=projects`,
    false,
    true,
  );
  await expect(pageHeading(page)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Telegram", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "X", exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: /Read the.*token announcement/ }),
  ).toHaveCount(0);
  const hrefs = await page
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(
    hrefs.every((href) => !!href && !/^https:\/\/x\.com\/?$/.test(href)),
  ).toBe(true);
  expect(
    (await snapshot(page)).reads.some((read) => read.name === "forum:search"),
  ).toBe(false);
});
for (const app of ["platform", "forum"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [320, 390, 1280])
      test(`${app} ${theme} ${width}px uses official branding and directly bounded responsive sections`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await open(page, `theme=${theme}&guest`, app);
        await expect(pageHeading(page)).toBeVisible();
        const logo = page.getByRole("img", {
          name: "SYMBaiEX Forum logo",
          exact: true,
        });
        await expect(logo).toBeVisible();
        await expect
          .poll(() =>
            logo.evaluate((img: HTMLImageElement) => img.naturalWidth),
          )
          .toBeGreaterThan(0);
        await expect(
          page.getByText("Current Pump.fun mint", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(/The historical Bags token is separate/),
        ).toBeVisible();
        const nav = page.getByRole("navigation", {
          name: "SYMF project sections",
          exact: true,
        });
        await expect(nav.getByRole("link")).toHaveCount(4);
        for (const link of await nav.getByRole("link").all()) {
          const box = await link.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
          const target = await link.getAttribute("href");
          expect(
            await page.evaluate(
              (id) => !!document.getElementById(id!.slice(1)),
              target,
            ),
          ).toBe(true);
        }
        for (const label of [
          "Inert shared market workspace",
          "Swap SYMF",
          "SYMF forum discussions",
          "Project contributors",
        ]) {
          const node = page
            .getByRole("region", { name: label, exact: true })
            .or(page.getByRole("complementary", { name: label, exact: true }));
          await expect(node).toBeVisible();
          const box = await node.boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        for (const button of await page.getByRole("button").all()) {
          if (!(await button.isVisible())) continue;
          const bounds = await button.boundingBox();
          expect(
            bounds!.height,
            (await button.textContent()) ?? "",
          ).toBeGreaterThanOrEqual(44);
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
        }
        const state = await snapshot(page);
        expect(state.providerMounts).toBe(1);
        expect(state.swapMounts).toBe(1);
        expect(state.outputs).toEqual([
          {
            mint,
            symbol: "SYMF",
            name: installation.token.name,
            decimals: installation.token.decimals,
            tokenProgram: installation.token.tokenProgram,
            icon: "/images/brand/symforum-icon-64.png",
          },
        ]);
        expect(
          state.markets.every(
            (row) =>
              row.token.mint === mint && row.now > 0 && row.now % 60000 === 0,
          ),
        ).toBe(true);
      });
for (const path of [
  `/community?mint=${mint.toLowerCase()}&section=projects`,
  "/community?mint=SYMF&section=projects",
  "/community?mint=So11111111111111111111111111111111111111112&section=projects",
  `/community?mint=${mint}&mint=${mint}&section=projects`,
  "/community?section=projects",
  `/community?mint=${mint}&section=projects&compact`,
  `/community?mint=${mint}&section=projects&native`,
])
  test(`curated page is never activated for nonmatching or unsupported scope: ${path}`, async ({
    page,
  }) => {
    await open(page, "guest", "platform", path);
    if (path.includes("native"))
      await expect(
        page.getByRole("heading", {
          name: "Community projects and rewards",
          exact: true,
        }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("navigation", {
          name: "Community utilities",
          exact: true,
        }),
      ).toBeVisible();
    await expect(pageHeading(page)).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Inert native swap", exact: true }),
    ).toHaveCount(0);
    expect((await snapshot(page)).swapMounts).toBe(0);
  });
for (const guest of [true, false])
  test(`${guest ? "guest" : "signed-in"} keeps one protected swap through utility switches, resize and theme`, async ({
    page,
  }) => {
    await open(page, guest ? "guest" : "");
    const amount = page.getByRole("textbox", {
      name: "Inert swap amount",
      exact: true,
    });
    await expect(amount).toBeVisible();
    await amount.fill("0.5");
    await utility(page, "Bounties & research").click();
    await expect(amount).toBeHidden();
    await utility(page, "Project hubs").click();
    await expect(amount).toHaveValue("0.5");
    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() =>
      (
        window as unknown as { __symfPage: { setTheme(value: string): void } }
      ).__symfPage.setTheme("light"),
    );
    await expect(amount).toHaveValue("0.5");
    const state = await snapshot(page);
    expect(state.providerMounts).toBe(1);
    expect(state.providerUnmounts).toBe(0);
    expect(state.swapMounts).toBe(1);
    expect(state.swapUnmounts).toBe(0);
    await expect(
      page.getByText("Protected fixture attempt retained", { exact: true }),
    ).toBeVisible();
  });
test("a direct work link does not eagerly mount chart or swap until projects is deliberately selected", async ({
  page,
}) => {
  await open(page, "guest", "platform", `/community?mint=${mint}&section=work`);
  await expect(utility(page, "Bounties & research")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect((await snapshot(page)).swapMounts).toBe(0);
  await utility(page, "Project hubs").click();
  await expect(pageHeading(page)).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Inert swap amount", exact: true }),
  ).toBeVisible();
  expect((await snapshot(page)).swapMounts).toBe(1);
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    for (const scenario of ["market-loading", "market-error"])
      test(`${app} ${width}px ${scenario} leaves project identity, swap, discussions and contributors available`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 });
        await open(page, `guest&${scenario}`, app);
        await expect(pageHeading(page)).toBeVisible();
        await expect(
          page.getByRole("textbox", { name: "Inert swap amount", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("region", {
            name: "SYMF forum discussions",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", {
            name: "Project contributors",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText(
            scenario === "market-error"
              ? "SYMF market and chart is temporarily unavailable."
              : "Shared chart is loading",
            { exact: true },
          ),
        ).toBeVisible();
        for (const button of await page
          .getByRole("region", { name: "Project hubs", exact: true })
          .getByRole("button")
          .all()) {
          if (!(await button.isVisible())) continue;
          const box = await button.boundingBox();
          expect(
            box!.height,
            (await button.textContent()) ?? "",
          ).toBeGreaterThanOrEqual(44);
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
        }
        expect((await snapshot(page)).swapMounts).toBe(1);
      });
test("official destinations and keyboard anchors remain available with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "guest");
  await expect(pageHeading(page)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Explorer", exact: true }),
  ).toHaveAttribute("href", `https://solscan.io/token/${mint}`);
  await expect(
    page.getByRole("link", { name: "View on Pump.fun", exact: true }),
  ).toHaveAttribute("href", `https://pump.fun/coin/${mint}`);
  await expect(
    page.getByRole("link", { name: "Telegram", exact: true }),
  ).toHaveAttribute("href", installation.telegram.url);
  const market = page
    .getByRole("navigation", { name: "SYMF project sections", exact: true })
    .getByRole("link", { name: "Market", exact: true });
  await market.focus();
  await page.keyboard.press("Tab");
  await expect(
    page
      .getByRole("navigation", { name: "SYMF project sections", exact: true })
      .getByRole("link", { name: "Overview", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  expect(new URL(page.url()).hash).toMatch(/-overview$/);
  const state = await snapshot(page);
  expect(
    state.reads.some((read) => /Market|Wallet|Risk|refresh/i.test(read.name)),
  ).toBe(false);
  expect(state.swapMounts).toBe(1);
});

for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390, 1280])
    test(`${app} ${width}px actual token stats, chart renderer and native swap fit without making wallet requests`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
      await open(
        page,
        "guest&theme=dark",
        app,
        `/community?mint=${mint}&section=projects`,
        true,
      );
      await expect(pageHeading(page)).toBeVisible();
      // The actual demand-driven chart does not fetch until its viewport is visible.
      await page
        .getByRole("group", { name: "Candle interval", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("img", {
          name: /SYMF USD candlestick chart, 12 candles/,
        }),
      ).toBeVisible();
      const swap = page.getByRole("complementary", {
        name: "Swap SYMF",
        exact: true,
      });
      const cta = swap.getByRole("button", {
        name: "Sign in to swap",
        exact: true,
      });
      await expect(cta).toBeVisible();
      await expect(swap.getByText("SYMF", { exact: true })).toBeVisible();
      for (const locator of [
        swap,
        cta,
        page.getByRole("img", {
          name: /SYMF USD candlestick chart, 12 candles/,
        }),
      ]) {
        const box = await locator.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const swapControls = swap
        .getByRole("button")
        .or(swap.getByRole("combobox"))
        .or(swap.getByRole("textbox"));
      for (const control of await swapControls.all()) {
        if (!(await control.isVisible())) continue;
        const bounds = await control.boundingBox();
        const label = await control.evaluate(
          (element) =>
            `${element.tagName}:${element.getAttribute("aria-label") ?? element.id ?? ""}:${element.textContent?.slice(0, 80) ?? ""}`,
        );
        expect(bounds!.height, label).toBeGreaterThanOrEqual(44);
        expect(bounds!.width, label).toBeGreaterThanOrEqual(44);
      }
      expect(audits.get(page)!.charts).toHaveLength(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const state = await snapshot(page);
      expect(
        state.reads
          .filter((read) => read.name === "forumTerminal:getMarket")
          .every((read) => (read.args as { mint: string }).mint === mint),
      ).toBe(true);
      expect(
        state.reads
          .filter((read) => read.name === "forumCommunity:listProjectPage")
          .every((read) => (read.args as { mint: string }).mint === mint),
      ).toBe(true);
      if (app === "platform" && [390, 1280].includes(width)) {
        mkdirSync("/private/tmp/output", { recursive: true });
        await page.screenshot({
          path: `/private/tmp/output/symf-project-preview-${width === 1280 ? "desktop" : "mobile"}-20261102.png`,
          fullPage: true,
        });
      }
    });
