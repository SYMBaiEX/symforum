import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43259",
  css = {} as Record<"platform" | "forum", string>;
let script: string;
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  other = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1V";
declare global {
  interface Window {
    __swapAmountInspection: {
      calls: { name: string; args: Record<string, unknown> }[];
      blocked: string[];
      queries: string[];
      setIdentity(value: string): void;
      setMetadataAvailable(value: boolean): void;
      settle(
        index: number,
        success: boolean,
        marker?: number,
        feeBps?: number,
        rawFee?: string,
        rawOutput?: string,
        rawMinimum?: string,
      ): void;
    };
  }
}
const audits = new WeakMap<
  Page,
  { errors: string[]; outbound: string[]; mode: string }
>();
const calls = (page: Page) =>
  page.evaluate(() => window.__swapAmountInspection.calls);
const amount = (page: Page) =>
  page.getByRole("textbox", { name: "You pay", exact: true });
const estimate = (page: Page) =>
  page.getByLabel("Swap estimate", { exact: true });
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/swap-amount-inspection.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"pair-isolation-only",setup(build){build.onResolve({filter:/^convex\\/react$|commerce-wallet$|^@\\/lib\\/commerce-wallet-client$|^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/swap-amount-inspection-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 7 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  mode = "",
  app: "platform" | "forum" = "platform",
) {
  const audit = { errors: [] as string[], outbound: [] as string[], mode };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  const start = new Date("2026-10-31T14:00:00Z");
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
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
  await page.goto(`${origin}/?mode=${mode}`);
  await expect(amount(page)).toBeVisible();
}
test.afterEach(async ({ page }) => {
  const audit = audits.get(page)!;
  expect(audit.errors).toEqual([]);
  expect(audit.outbound).toEqual([]);
  expect(
    await page.evaluate(() => window.__swapAmountInspection.blocked),
  ).toEqual(
    audit.mode === "prepare"
      ? ["forumSwaps:prepare"]
      : audit.mode === "held"
        ? ["forumSwapRecovery:ensure"]
        : [],
  );
  expect(
    (await calls(page)).every((call) => call.name === "forumSwaps:quote"),
  ).toBe(true);
});
async function quote(page: Page) {
  await amount(page).fill("1");
  await page.clock.runFor(1000);
  await expect.poll(async () => (await calls(page)).length).toBe(1);
}
async function pick(page: Page, mint: string) {
  await page
    .getByRole("button", { name: "Receive token", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Select a token",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.clock.runFor(250);
  await dialog
    .locator(".swap-token-row")
    .filter({ has: page.locator(`code[title="${mint}"]`) })
    .click();
  await expect(dialog).toBeHidden();
}

const routes = (page: Page) => page.locator("details.commerce-routes");
const routeSummary = (page: Page) => routes(page).locator("summary");
const exactRouteOutput = (page: Page) =>
  routes(page).locator(".commerce-route > span:last-child > strong");
const minimum = (page: Page) =>
  estimate(page)
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: "Minimum received" }) })
    .locator("dd");
async function resolveAmounts(page: Page, raw: string, floor: string) {
  await page.evaluate(
    ({ raw, floor }) =>
      window.__swapAmountInspection.settle(
        0,
        true,
        7,
        50,
        "5000000",
        raw,
        floor,
      ),
    { raw, floor },
  );
  await page.clock.runFor(1);
  await expect(estimate(page)).toBeVisible();
}
async function bounded(
  node: import("@playwright/test").Locator,
  width: number,
) {
  await node.scrollIntoViewIfNeeded();
  const box = (await node.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(
    await node.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(
    await node.evaluate((el) => {
      const style = getComputedStyle(el);
      return (
        !["hidden", "clip"].includes(style.overflowX) &&
        style.textOverflow !== "ellipsis"
      );
    }),
  ).toBe(true);
}
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    for (const sample of [
      {
        mode: "",
        raw: "1",
        floor: "0",
        formatted: "0.000000000000000001",
        minimum: "0",
        name: "one raw unit at 18 decimals",
      },
      {
        mode: "integer",
        raw: "18446744073709551615",
        floor: "18446744073709551614",
        formatted: "18,446,744,073,709,551,615",
        minimum: "18,446,744,073,709,551,614",
        name: "maximum u64 integer",
      },
    ])
      test(`${app} ${width}: ${sample.name} remains completely inspectable with existing disclosure`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await harness(page, sample.mode, app);
        await quote(page);
        await resolveAmounts(page, sample.raw, sample.floor);
        await expect(page.locator(".swap-receive")).toHaveText(
          sample.formatted,
        );
        await expect(minimum(page)).toHaveText(`${sample.minimum} TINY`);
        await expect(routes(page)).not.toHaveAttribute("open", "");
        await routeSummary(page).focus();
        await expect(routeSummary(page)).toBeFocused();
        expect(
          (await routeSummary(page).boundingBox())!.height,
        ).toBeGreaterThanOrEqual(44);
        await page.keyboard.press("Enter");
        await expect(exactRouteOutput(page)).toHaveText(
          `${sample.formatted} TINY`,
        );
        await bounded(exactRouteOutput(page), width);
        await bounded(minimum(page), width);
        await bounded(routes(page), width);
        await expect(routes(page)).toContainText(usdc);
        expect((await calls(page)).length).toBe(1);
      });
test("the headline may ellipsize but the open route preserves every exact digit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await harness(page);
  await quote(page);
  await resolveAmounts(page, "18446744073709551615", "18446744073709551614");
  const output = page.locator(".swap-receive");
  await expect(output).toHaveText("18.446744073709551615");
  expect(await output.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  await routeSummary(page).click();
  await expect(exactRouteOutput(page)).toHaveText("18.446744073709551615 TINY");
  await bounded(exactRouteOutput(page), 320);
});
test("literal zero is not converted into missing metadata or a made-up positive value", async ({
  page,
}) => {
  await harness(page);
  await quote(page);
  await resolveAmounts(page, "0", "0");
  await expect(page.locator(".swap-receive")).toHaveText("0");
  await expect(minimum(page)).toHaveText("0 TINY");
  await routeSummary(page).click();
  await expect(exactRouteOutput(page)).toHaveText("0 TINY");
});
for (const mode of ["missing-output", "metadata-loading"])
  test(`${mode}: no invented decimal fallback estimate is admitted`, async ({
    page,
  }) => {
    await harness(page, mode);
    await amount(page).fill("1");
    await page.clock.runFor(3000);
    expect(await calls(page)).toEqual([]);
    await expect(estimate(page)).toHaveCount(0);
    await expect(routes(page)).toHaveCount(0);
    await expect(page.locator(".swap-receive")).toHaveText("0.00");
  });
test("pending and expired quotes retain existing honest state, without an automatic wallet request", async ({
  page,
}) => {
  await harness(page);
  await quote(page);
  await expect(page.locator(".swap-receive")).toHaveText("…");
  await expect(routes(page)).toHaveCount(0);
  await resolveAmounts(page, "1", "0");
  await routeSummary(page).click();
  await page.clock.runFor(26000);
  await expect(page.locator(".swap-receive")).toHaveText("0.00");
  await expect(
    page
      .getByText(
        "Quote expired. A fresh quote will be checked when you swap.",
        { exact: true },
      )
      .last(),
  ).toBeVisible();
  await expect(exactRouteOutput(page)).toHaveText("0.000000000000000001 TINY");
  await expect(routes(page)).toContainText("0s to quote");
  expect((await calls(page)).length).toBe(1);
});
for (const change of ["picker", "aba"])
  test(`${change}: changing mint never leaves another pair's inspected values visible`, async ({
    page,
  }) => {
    await harness(page);
    await quote(page);
    await resolveAmounts(page, "1", "0");
    await routeSummary(page).click();
    if (change === "picker") await pick(page, other);
    else {
      const reverse = page.getByRole("button", {
        name: "Reverse token pair",
        exact: true,
      });
      await reverse.click();
      await reverse.click();
    }
    await expect(routes(page)).toHaveCount(0);
    await expect(estimate(page)).toHaveCount(0);
    await expect(page.locator(".swap-receive")).toHaveText("0.00");
  });

for (const app of ["platform", "forum"] as const)
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 640, height: 450 },
  ])
    test(`${app} ${viewport.width}x${viewport.height}: exact amounts stay readable inside actual terminal rail/reflow geometry`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await harness(page, "integer", app);
      await quote(page);
      await resolveAmounts(
        page,
        "18446744073709551615",
        "18446744073709551614",
      );
      await routeSummary(page).focus();
      await page.keyboard.press("Enter");
      await expect(exactRouteOutput(page)).toHaveText(
        "18,446,744,073,709,551,615 TINY",
      );
      await expect(minimum(page)).toHaveText("18,446,744,073,709,551,614 TINY");
      await bounded(exactRouteOutput(page), viewport.width);
      await bounded(minimum(page), viewport.width);
      const rail = (await page.locator("[data-terminal-order]").boundingBox())!;
      const value = (await exactRouteOutput(page).boundingBox())!;
      expect(value.x).toBeGreaterThanOrEqual(rail.x);
      expect(value.x + value.width).toBeLessThanOrEqual(rail.x + rail.width);
      expect(audits.get(page)?.outbound).toEqual([]);
    });
test.describe("touch-emulated inspection", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("opens the existing disclosure without wallet or provider activity", async ({
    page,
  }) => {
    await harness(page);
    await quote(page);
    await resolveAmounts(page, "1", "0");
    await routeSummary(page).tap();
    await expect(exactRouteOutput(page)).toHaveText(
      "0.000000000000000001 TINY",
    );
    await bounded(exactRouteOutput(page), 390);
    expect(audits.get(page)).toMatchObject({ errors: [], outbound: [] });
    expect(
      await page.evaluate(() => window.__swapAmountInspection.blocked),
    ).toEqual([]);
    expect((await calls(page)).length).toBe(1);
  });
});

test("metadata disappearing after a quote never invents a six-decimal receive amount", async ({
  page,
}) => {
  await harness(page);
  await quote(page);
  await resolveAmounts(page, "18446744073709551615", "18446744073709551614");
  await routeSummary(page).click();
  await expect(exactRouteOutput(page)).toHaveText("18.446744073709551615 TINY");
  await page.evaluate(() =>
    window.__swapAmountInspection.setMetadataAvailable(false),
  );
  await expect(exactRouteOutput(page)).toHaveText(
    "Receive amount unavailable · token precision not loaded",
  );
  await expect(routes(page)).not.toContainText("18,446,744,073,709.551615");
  await expect(routes(page)).toContainText(
    "Quoted output · raw base units: 18446744073709551615",
  );
  await expect(estimate(page)).toHaveCount(0);
  await page.evaluate(() =>
    window.__swapAmountInspection.setMetadataAvailable(true),
  );
  await expect(exactRouteOutput(page)).toHaveText("18.446744073709551615 TINY");
  await expect(routes(page)).not.toContainText(
    "Quoted output · raw base units:",
  );
  expect((await calls(page)).length).toBe(1);
});
