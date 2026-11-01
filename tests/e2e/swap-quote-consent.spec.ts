import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43249",
  css = {} as Record<"platform" | "forum", string>;
let script: string;
const sol = "So11111111111111111111111111111111111111112",
  usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  other = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1V",
  wallet = "11111111111111111111111111111111";
declare global {
  interface Window {
    __swapQuoteConsent: {
      calls: { name: string; args: Record<string, unknown> }[];
      blocked: string[];
      queries: string[];
      setIdentity(value: string): void;
      settle(
        index: number,
        success: boolean,
        marker?: number,
        feeBps?: number,
        rawFee?: string,
        rawOutput?: string,
      ): void;
    };
  }
}
const audits = new WeakMap<
  Page,
  { errors: string[]; outbound: string[]; mode: string }
>();
const calls = (page: Page) =>
  page.evaluate(() => window.__swapQuoteConsent.calls);
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/swap-quote-consent.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"pair-isolation-only",setup(build){build.onResolve({filter:/^convex\\/react$|commerce-wallet$|^@\\/lib\\/commerce-wallet-client$|^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/swap-quote-consent-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
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
  expect(await page.evaluate(() => window.__swapQuoteConsent.blocked)).toEqual(
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
async function settle(page: Page, index: number, success: boolean, marker = 7) {
  await page.evaluate(
    ({ index, success, marker }) =>
      window.__swapQuoteConsent.settle(index, success, marker),
    { index, success, marker },
  );
  await page.clock.runFor(1);
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

const comparison = (page: Page) =>
  page.getByRole("region", { name: "Quote changes requiring review" });
async function refresh(page: Page, marker = 5, feeBps = 50) {
  await page.clock.runFor(21000);
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await page.evaluate(
    ({ marker, feeBps }) =>
      window.__swapQuoteConsent.settle(1, true, marker, feeBps),
    { marker, feeBps },
  );
  await page.clock.runFor(1);
}
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px: reviewed changes are exact, bounded and keyboard reachable with reduced motion`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await harness(page, "", app);
      await quote(page);
      await settle(page, 0, true, 7);
      await expect(estimate(page)).toBeVisible();
      await refresh(page, 5, 75);
      const panel = comparison(page);
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("7 → 5");
      await expect(panel).toContainText("6 → 4");
      await expect(panel).toContainText("0.5% integrator fee");
      await expect(panel).toContainText("0.75% integrator fee");
      await expect(panel).toContainText("collected in USDC");
      for (const node of [
        panel,
        page.getByLabel("Token swap", { exact: true }),
      ]) {
        const box = (await node.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(
          await node.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      const swap = page.getByRole("button", { name: "Swap", exact: true });
      await swap.focus();
      await expect(swap).toBeFocused();
      expect((await swap.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await calls(page)).length).toBe(2);
    });
test("expiry announces only the transition, not every clock tick, and never fetches automatically", async ({
  page,
}) => {
  await harness(page);
  await quote(page);
  await settle(page, 0, true);
  const status = page.locator('[role="status"][aria-atomic="true"]');
  await expect(status).toHaveText("");
  await page.evaluate(() => {
    const target = document.querySelector(
      '[role="status"][aria-atomic="true"]',
    )!;
    Object.assign(window, { __expiryChanges: 0 });
    new MutationObserver(() => {
      (window as unknown as { __expiryChanges: number }).__expiryChanges++;
    }).observe(target, { subtree: true, characterData: true, childList: true });
  });
  await page.clock.runFor(26000);
  await expect(status).toHaveText(
    "Quote expired. A fresh quote will be checked when you swap.",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __expiryChanges: number }).__expiryChanges,
    ),
  ).toBe(1);
  await page.clock.runFor(5000);
  expect(
    await page.evaluate(
      () => (window as unknown as { __expiryChanges: number }).__expiryChanges,
    ),
  ).toBe(1);
  expect((await calls(page)).length).toBe(1);
});
for (const change of ["amount", "reverse", "picker", "aba"])
  test(`${change} never compares a former input context`, async ({ page }) => {
    await harness(page);
    await quote(page);
    await settle(page, 0, true);
    if (change === "amount") await amount(page).fill("2");
    else if (change === "picker") await pick(page, other);
    else {
      const reverse = page.getByRole("button", {
        name: "Reverse token pair",
        exact: true,
      });
      await reverse.click();
      if (change === "aba") await reverse.click();
    }
    await expect(comparison(page)).toHaveCount(0);
    await page.clock.runFor(1100);
    if ((await calls(page)).length === 2) {
      await settle(page, 1, true, 5);
      await expect(estimate(page)).toBeVisible();
    }
    await expect(comparison(page)).toHaveCount(0);
  });
test("failed refresh clears displayed comparison and reveals no private provider error", async ({
  page,
}) => {
  await harness(page);
  await quote(page);
  await settle(page, 0, true);
  await page.clock.runFor(21000);
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await settle(page, 1, false);
  await expect(comparison(page)).toHaveCount(0);
  await expect(page.getByText(/Routes could not be verified/)).toBeVisible();
  await expect(
    page.getByText("PRIVATE_STALE_QUOTE_ERROR", { exact: true }),
  ).toHaveCount(0);
});
test("a still-fresh quote retains the existing preparation path without a new consent gate", async ({
  page,
}) => {
  await harness(page, "prepare");
  await quote(page);
  await settle(page, 0, true);
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__swapQuoteConsent.blocked))
    .toEqual(["forumSwaps:prepare"]);
  await expect(comparison(page)).toHaveCount(0);
  expect((await calls(page)).length).toBe(1);
});

for (const success of [true, false])
  test(`identity change rejects delayed old ${success ? "success" : "failure"} and cannot compare that account`, async ({
    page,
  }) => {
    await harness(page);
    await quote(page);
    await page.evaluate(() =>
      window.__swapQuoteConsent.setIdentity("another-inert-user"),
    );
    await page.clock.runFor(1);
    await settle(page, 0, success);
    await expect(comparison(page)).toHaveCount(0);
    await expect(estimate(page)).toHaveCount(0);
    await expect(page.getByText(/Routes could not be verified/)).toHaveCount(0);
    await page.clock.runFor(1100);
    await expect.poll(async () => (await calls(page)).length).toBe(2);
    await settle(page, 1, true, 5);
    await expect(estimate(page)).toBeVisible();
    await expect(comparison(page)).toHaveCount(0);
  });
test("an identity ABA clears a displayed comparison even if the pair and amount return", async ({
  page,
}) => {
  await harness(page);
  await quote(page);
  await settle(page, 0, true);
  await refresh(page);
  await expect(comparison(page)).toBeVisible();
  await page.evaluate(() =>
    window.__swapQuoteConsent.setIdentity("other-user"),
  );
  await page.clock.runFor(1);
  await expect(comparison(page)).toHaveCount(0);
  await page.evaluate(() =>
    window.__swapQuoteConsent.setIdentity("inert-pair-reader"),
  );
  await page.clock.runFor(1);
  await expect(comparison(page)).toHaveCount(0);
});

test("a fee-only refresh still requires review and exposes the actual fee metadata", async ({
  page,
}) => {
  await harness(page);
  await quote(page);
  await settle(page, 0, true, 7);
  await refresh(page, 7, 75);
  await expect(comparison(page)).toContainText("7 → 7");
  await expect(comparison(page)).toContainText("6 → 6");
  await expect(comparison(page)).toContainText("0.75% total");
  await expect(comparison(page)).toContainText(usdc);
});
test("a second worsened refresh compares the immediately previous displayed quote, not the first", async ({
  page,
}) => {
  await harness(page);
  await quote(page);
  await settle(page, 0, true, 7);
  await refresh(page, 5);
  await expect(comparison(page)).toContainText("7 → 5");
  await page.clock.runFor(21000);
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(3);
  await page.evaluate(() => window.__swapQuoteConsent.settle(2, true, 3));
  await page.clock.runFor(1);
  await expect(comparison(page)).toContainText("5 → 3");
  await expect(comparison(page)).toContainText("4 → 2");
  await expect(comparison(page)).not.toContainText("7 →");
});
test("an improved refreshed minimum keeps the original preparation path and never invents renewed consent", async ({
  page,
}) => {
  await harness(page, "prepare");
  await quote(page);
  await settle(page, 0, true, 7);
  await refresh(page, 9);
  await expect
    .poll(() => page.evaluate(() => window.__swapQuoteConsent.blocked))
    .toEqual(["forumSwaps:prepare"]);
  await expect(comparison(page)).toHaveCount(0);
});

test("large quoted integer fields remain exact without a synthetic fee conversion", async ({
  page,
}) => {
  await harness(page);
  await quote(page);
  await page.evaluate(() =>
    window.__swapQuoteConsent.settle(
      0,
      true,
      7,
      50,
      "900719925474099399999",
      "900719925474099399999",
    ),
  );
  await expect(estimate(page)).toBeVisible();
  await page.clock.runFor(21000);
  await page.getByRole("button", { name: "Swap", exact: true }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await page.evaluate(() =>
    window.__swapQuoteConsent.settle(
      1,
      true,
      5,
      50,
      "900719925474099400000",
      "900719925474099400000",
    ),
  );
  await page.clock.runFor(1);
  await expect(comparison(page)).toContainText(
    "900719925474099399999 → 900719925474099400000",
  );
  await expect(comparison(page)).toContainText(
    "900,719,925,474,099.399999 → 900,719,925,474,099.4",
  );
});

for (const mode of ["mismatched-pair", "mismatched-amount"])
  test(`${mode}: the existing gate may stop the swap but presentation never invents comparable economics`, async ({
    page,
  }) => {
    await harness(page, mode);
    await quote(page);
    await settle(page, 0, true);
    await refresh(page);
    await expect(page.getByText(/^Quote updated:/)).toBeVisible();
    await expect(comparison(page)).toHaveCount(0);
  });
