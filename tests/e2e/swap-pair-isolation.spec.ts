import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43233",
  css = {} as Record<"platform" | "forum", string>;
let script: string;
const sol = "So11111111111111111111111111111111111111112",
  usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  other = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1V",
  wallet = "11111111111111111111111111111111";
declare global {
  interface Window {
    __swapPairIsolation: {
      calls: { name: string; args: Record<string, unknown> }[];
      blocked: string[];
      queries: string[];
      settle(index: number, success: boolean, marker?: number): void;
    };
  }
}
const audits = new WeakMap<
  Page,
  { errors: string[]; outbound: string[]; mode: string }
>();
const calls = (page: Page) =>
  page.evaluate(() => window.__swapPairIsolation.calls);
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/swap-pair-isolation.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"pair-isolation-only",setup(build){build.onResolve({filter:/^convex\\/react$|commerce-wallet$|^@\\/lib\\/commerce-wallet-client$|^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/swap-pair-isolation-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
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
  expect(await page.evaluate(() => window.__swapPairIsolation.blocked)).toEqual(
    audit.mode === "held" ? ["forumSwapRecovery:ensure"] : [],
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
      window.__swapPairIsolation.settle(index, success, marker),
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
for (const change of ["reverse", "picker", "aba"])
  for (const success of [false, true])
    test(`${change}: delayed old quote ${success ? "success" : "failure"} never binds to the changed exact pair`, async ({
      page,
    }) => {
      await harness(page);
      await quote(page);
      const reverse = page.getByRole("button", {
        name: "Reverse token pair",
        exact: true,
      });
      await expect(reverse).toBeEnabled();
      if (change === "picker") await pick(page, other);
      else {
        await reverse.click();
        if (change === "aba") await reverse.click();
      }
      await settle(page, 0, success, 9);
      await expect(estimate(page)).toHaveCount(0);
      await expect(page.locator(".swap-receive")).toHaveText("0.00");
      await expect(
        page.getByText(
          /Routes could not be verified|PRIVATE_STALE_QUOTE_ERROR/,
        ),
      ).toHaveCount(0);
      expect(await calls(page)).toEqual([
        {
          name: "forumSwaps:quote",
          args: {
            wallet,
            inputMint: sol,
            outputMint: usdc,
            amountRaw: "1000000000",
            slippageBps: 50,
            supportsV1: false,
          },
        },
      ]);
      if (change !== "aba") {
        await page.clock.runFor(1000);
        await expect.poll(async () => (await calls(page)).length).toBe(2);
        await settle(page, 1, true, 7);
        await expect(estimate(page)).toBeVisible();
        const nextInput = change === "reverse" ? usdc : sol,
          nextOutput = change === "reverse" ? sol : other;
        expect((await calls(page))[1].args).toEqual({
          wallet,
          inputMint: nextInput,
          outputMint: nextOutput,
          amountRaw: change === "reverse" ? "1000000" : "1000000000",
          slippageBps: 50,
          supportsV1: false,
        });
        await expect(page.locator(".swap-receive")).toHaveText("7");
        await expect(estimate(page)).toContainText(
          `6 ${change === "reverse" ? "SOL" : "OTHER"}`,
        );
        await expect(estimate(page)).toContainText(
          `collected in ${change === "reverse" ? "SOL" : "OTHER"}`,
        );
        await expect(estimate(page)).not.toContainText("Inert route 9");
      } else {
        await page.clock.runFor(2000);
        expect((await calls(page)).length).toBe(1);
      }
    });
test("a current quote failure remains generic and a changed pair removes that old-pair error", async ({
  page,
}) => {
  await harness(page);
  await quote(page);
  await settle(page, 0, false);
  await expect(page.getByText(/Routes could not be verified/)).toBeVisible();
  await expect(
    page.getByText("PRIVATE_STALE_QUOTE_ERROR", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reverse token pair", exact: true })
    .click();
  await expect(page.getByText(/Routes could not be verified/)).toHaveCount(0);
});
for (const mode of ["guest", "unlinked", "held"])
  test(`${mode} existing gate admits no quote or wallet operation`, async ({
    page,
  }) => {
    await harness(page, mode);
    await amount(page).fill("1");
    await page.clock.runFor(3000);
    expect(await calls(page)).toEqual([]);
    await expect(estimate(page)).toHaveCount(0);
    if (mode === "held") {
      await page
        .getByRole("button", { name: "View swap status", exact: true })
        .click();
      await expect(
        page.getByText(/A previous wallet request needs verification/),
      ).toBeVisible();
    }
  });
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px actual picker/reverse controls are keyboard usable and remain bounded`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await harness(page, "", app);
      await quote(page);
      const reverse = page.getByRole("button", {
        name: "Reverse token pair",
        exact: true,
      });
      await reverse.focus();
      await expect(reverse).toBeFocused();
      expect((await reverse.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Enter");
      await settle(page, 0, true, 9);
      await expect(estimate(page)).toHaveCount(0);
      await page
        .getByRole("button", { name: "Receive token", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", {
        name: "Select a token",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await page.clock.runFor(250);
      const row = dialog
        .locator(".swap-token-row")
        .filter({ has: page.locator(`code[title="${other}"]`) });
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      for (const target of [dialog, row]) {
        const box = (await target.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(
          await target.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      await row.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toBeHidden();
      await page.clock.runFor(1000);
      await expect.poll(async () => (await calls(page)).length).toBe(2);
      await settle(page, 1, true, 7);
      await expect(estimate(page)).toBeVisible();
      for (const node of [
        page.getByLabel("Token swap", { exact: true }),
        reverse,
        estimate(page),
      ]) {
        await node.scrollIntoViewIfNeeded();
        const box = (await node.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(
          await node.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
    });
