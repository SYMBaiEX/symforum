import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43243";
let script: string;
const styles = {} as Record<"platform" | "forum", string>;
type Failure = "none" | "market" | "markets" | "treasury" | "swap";
declare global {
  interface Window {
    __panelRecovery: {
      fail(value: Failure): void;
      signOut(): void;
      mounts: Record<string, number>;
      unmounts: Record<string, number>;
      calls: string[];
      denied: string[];
    };
  }
}
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
test.beforeAll(() => {
  const baseline =
    process.env.PANEL_RECOVERY_BASELINE === "1"
      ? execFileSync(
          "git",
          ["show", "8ba7ac40:components/trading/terminal-boundary.tsx"],
          { encoding: "utf8" },
        )
      : null;
  for (const app of ["platform", "forum"] as const)
    styles[app] =
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
      `const baseline=${JSON.stringify(baseline)};const result=await Bun.build({entrypoints:["tests/e2e/fixtures/terminal-panel-recovery.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"panel-recovery-only",setup(build){if(baseline!==null)build.onLoad({filter:/terminal-boundary\\.tsx$/},()=>({contents:baseline,loader:"tsx"}));build.onResolve({filter:/^convex\\/react$|commerce-wallet$|^\\.\\/token-detail$|^\\.\\/market-explorer$|^\\.\\/transparency-panel$|^\\.\\/wallet-panel$|^\\.\\/price-chart$|^@\\/components\\/swap\\/token-swap$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/terminal-panel-recovery-state.tsx"}));build.onResolve({filter:/^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/identity-navigation.ts"}));build.onResolve({filter:/^@\\/lib\\/commerce-wallet-client$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/terminal-wallet-client.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 9 * 1024 * 1024 },
  );
});
async function harness(page: Page, app: "platform" | "forum" = "platform") {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (
      url.origin === origin &&
      url.pathname === "/images/brand/symforum-icon-64.png"
    )
      return route.fulfill({
        contentType: "image/png",
        body: readFileSync("public/images/brand/symforum-icon-64.png"),
      });
    audit.outbound.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?orderquote&held`);
  await expect(
    page.getByRole("heading", { name: "Trading terminal", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__panelRecovery.mounts.swap ?? 0))
    .toBe(1);
}
const fail = (page: Page, value: Failure) =>
  page.evaluate((value) => window.__panelRecovery.fail(value), value);
const protectedState = (page: Page) =>
  page.evaluate(() => ({
    mounts: Object.fromEntries(
      Object.entries(window.__panelRecovery.mounts).filter(
        ([key]) => !["market", "markets", "treasury"].includes(key),
      ),
    ),
    unmounts: Object.fromEntries(
      Object.entries(window.__panelRecovery.unmounts).filter(
        ([key]) => !["market", "markets", "treasury"].includes(key),
      ),
    ),
    calls: window.__panelRecovery.calls.filter(
      (name) => name !== "forumTerminalRefresh:refresh",
    ),
  }));
test.afterEach(async ({ page }) => {
  expect(audits.get(page)).toEqual({ errors: [], outbound: [] });
  expect(await page.evaluate(() => window.__panelRecovery.denied)).toEqual([]);
});
test("retrying public token data preserves actual mounted protected siblings, input and attention", async ({
  page,
}) => {
  await harness(page);
  const input = page.getByLabel("You pay", { exact: true });
  await input.fill("0.5");
  // A protected attempt intentionally prevents another quote, but keeps the
  // authored amount in the existing controller.
  await expect(input).toHaveValue("0.5");
  const before = await protectedState(page);
  await fail(page, "market");
  await expect(
    page.getByText("Selected token data is temporarily unavailable.", {
      exact: true,
    }),
  ).toBeVisible();
  await fail(page, "none");
  await page.getByRole("button", { name: /^Retry panel:/ }).click();
  await expect(
    page.getByText("Selected token data is temporarily unavailable.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(input).toHaveValue("0.5");
  expect(await protectedState(page)).toEqual(before);
  await expect(
    page.getByRole("status", { name: "Known protected operations" }),
  ).toContainText("Swap receipts");
  await expect(
    page.getByRole("tabpanel", { name: "Chart", exact: true }),
  ).toBeFocused();
});
test("a still-failing read retries only on explicit input and keeps keyboard focus local", async ({
  page,
}) => {
  await harness(page);
  const before = await protectedState(page);
  await fail(page, "market");
  const retry = page.getByRole("button", { name: /^Retry panel:/ });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(retry).toBeVisible();
  await expect(retry).toBeFocused();
  expect(await protectedState(page)).toEqual(before);
  await fail(page, "none");
  await page.keyboard.press("Enter");
  await expect(retry).toHaveCount(0);
  expect(await protectedState(page)).toEqual(before);
});
test("discovery and treasury retries stay local across navigation and auth changes", async ({
  page,
}) => {
  await harness(page);
  for (const [failure, label] of [
    ["markets", "Token discovery"],
    ["treasury", "Treasury transparency"],
  ] as const) {
    if (failure === "markets")
      await page.getByRole("tab", { name: "Markets", exact: true }).click();
    else await page.locator('[data-terminal-dock="treasury"]').click();
    const before = await protectedState(page);
    await fail(page, failure);
    await expect(
      page.getByText(`${label} is temporarily unavailable.`, { exact: true }),
    ).toBeVisible();
    await fail(page, "none");
    await page.getByRole("button", { name: /^Retry panel:/ }).click();
    await expect(
      page.getByText(`${label} is temporarily unavailable.`, { exact: true }),
    ).toHaveCount(0);
    expect(await protectedState(page)).toEqual(before);
  }
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  await fail(page, "market");
  await page.evaluate(() => window.__panelRecovery.signOut());
  await expect
    .poll(() => page.evaluate(() => window.__panelRecovery.unmounts.swap ?? 0))
    .toBe(1);
  const signedOut = await protectedState(page);
  await fail(page, "none");
  await page.getByRole("button", { name: /^Retry panel:/ }).click();
  expect(await protectedState(page)).toEqual(signedOut);
  await expect(
    page.getByRole("status", { name: "Known protected operations" }),
  ).toHaveCount(0);
});
test("two failed public panels recover independently with distinct accessible actions", async ({
  page,
}) => {
  await harness(page);
  const before = await protectedState(page);
  await fail(page, "market");
  await page.locator('[data-terminal-dock="treasury"]').click();
  await fail(page, "treasury");
  await fail(page, "none");
  await page
    .getByRole("button", {
      name: "Retry panel: Selected token data",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Selected token data is temporarily unavailable.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Treasury transparency is temporarily unavailable.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await protectedState(page)).toEqual(before);
  await page
    .getByRole("button", {
      name: "Retry panel: Treasury transparency",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Treasury transparency is temporarily unavailable.", {
      exact: true,
    }),
  ).toHaveCount(0);
  expect(await protectedState(page)).toEqual(before);
});
test("protected swap failures never expose the read-only local reset", async ({
  page,
}) => {
  await harness(page);
  await fail(page, "swap");
  await expect(
    page.getByText("Wallet and swap is temporarily unavailable.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Retry panel:/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Reload page", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Other panels remain available. Reload when no wallet request is open.",
      { exact: true },
    ),
  ).toBeVisible();
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px read recovery has direct bounds, 44px target and keyboard recovery`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await harness(page, app);
      const before = await protectedState(page);
      await fail(page, "market");
      const retry = page.getByRole("button", {
        name: /^Retry panel:/,
      });
      await expect(retry).toBeVisible();
      const box = (await retry.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const panel = retry.locator("..");
      expect(
        await panel.evaluate(
          (node) => node.scrollWidth <= node.clientWidth + 1,
        ),
      ).toBe(true);
      await retry.focus();
      await fail(page, "none");
      await page.keyboard.press("Enter");
      await expect(retry).toHaveCount(0);
      expect(await protectedState(page)).toEqual(before);
    });
