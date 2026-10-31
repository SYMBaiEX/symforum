import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { TerminalWalletReadState } from "../../lib/forum-terminal-model";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43232";
const walletA = "EULE1PmLm452j4sfNTn4HrzEWa957Zdf3tZCtmjoaTtF",
  walletB = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  mintB = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1V";
const sol = "So11111111111111111111111111111111111111112";
type Read = { name: string; args: { wallet: string; selectedMint?: string } };
declare global {
  interface Window {
    __walletReadIsolation: {
      change(patch: {
        wallet?: string;
        mint?: string;
        auth?: string;
        mounted?: boolean;
      }): void;
      reads: Read[];
      queries: { name: string; args: unknown }[];
      forbidden: string[];
      settle(
        index: number,
        result: TerminalWalletReadState | null,
        failed?: boolean,
      ): void;
    };
  }
}
let script: string;
const styles = {} as Record<"platform" | "forum", string>;
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
const reads = (page: Page) =>
  page.evaluate(() => window.__walletReadIsolation.reads);
const balances = (page: Page) =>
  page.getByRole("list", { name: "Wallet balances", exact: true });
const refresh = (page: Page) =>
  page.getByRole("button", { name: "Refresh wallet balances", exact: true });
const checkedAt = Date.parse("2026-10-31T13:00:00.000Z");
function record(
  wallet = walletA,
  mint = mintA,
  amount = 1,
  tokenAmount = 2,
): TerminalWalletReadState {
  return {
    wallet,
    checkedAt,
    expiresAt: checkedAt + 60000,
    slot: 123,
    balances: [
      { mint: sol, rawAmount: `${amount}000000000`, decimals: 9 },
      { mint, rawAmount: `${tokenAmount}000000`, decimals: 6 },
    ],
    maxSolRaw: null,
    feeReserveLamports: null,
  };
}
test.beforeAll(() => {
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/wallet-read-isolation.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"wallet-read-parent-only",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/wallet-read-isolation-state.tsx"}));build.onLoad({filter:/components\\/trading\\/forum-terminal\\.tsx$/},async(args)=>({contents:(await Bun.file(args.path).text())+"\\nexport { AccountPanels as WalletReadIsolationParent };",loader:"tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  auth = "linked",
  app: "platform" | "forum" = "platform",
  native = false,
) {
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
    audit.outbound.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?auth=${auth}${native ? "&native" : ""}`);
  await expect(page.getByRole("main")).toBeVisible();
}
async function count(page: Page, expected: number) {
  await expect.poll(async () => (await reads(page)).length).toBe(expected);
}
async function settle(
  page: Page,
  index: number,
  result: TerminalWalletReadState | null,
  failed = false,
) {
  await page.evaluate(
    async ({ index, result, failed }) => {
      window.__walletReadIsolation.settle(index, result, failed);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    },
    { index, result, failed },
  );
}
async function switchIdentity(page: Page, button: string, expected: number) {
  await page.getByRole("button", { name: button, exact: true }).click();
  await count(page, expected);
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  expect(
    await page.evaluate(() => window.__walletReadIsolation.forbidden),
  ).toEqual([]);
  expect(
    (await reads(page)).every(
      (read) => read.name === "forumTerminal:getWalletReadState",
    ),
  ).toBe(true);
});
for (const target of ["wallet", "mint"])
  test(`actual keyed parent rejects delayed ${target} data and errors after selection changes`, async ({
    page,
  }) => {
    await harness(page);
    await count(page, 1);
    await switchIdentity(page, target === "wallet" ? "Wallet B" : "Token B", 2);
    await expect(balances(page)).toHaveCount(0);
    await expect(refresh(page)).toBeDisabled();
    await settle(page, 0, record(walletA, mintA, 9, 9));
    await expect(balances(page)).toHaveCount(0);
    await expect(refresh(page)).toBeDisabled();
    const wallet = target === "wallet" ? walletB : walletA,
      mint = target === "mint" ? mintB : mintA;
    await settle(page, 1, record(wallet, mint, 3, 4));
    await expect(balances(page).getByText("3", { exact: true })).toBeVisible();
    await expect(balances(page).getByText("4", { exact: true })).toBeVisible();
    await expect(balances(page).getByText("9", { exact: true })).toHaveCount(0);
    expect(await reads(page)).toEqual([
      {
        name: "forumTerminal:getWalletReadState",
        args: { wallet: walletA, selectedMint: mintA },
      },
      {
        name: "forumTerminal:getWalletReadState",
        args: { wallet, selectedMint: mint },
      },
    ]);
  });
test("manual refresh failure retains the last successful sample and a later success clears only its own error", async ({
  page,
}) => {
  await harness(page);
  await count(page, 1);
  await settle(page, 0, record());
  const before = await page.getByText(/^Checked /).textContent();
  await refresh(page).click();
  await count(page, 2);
  await settle(page, 1, null, true);
  await expect(balances(page).getByText("1", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Balances could not be refreshed. No payment request was made.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await page.getByText(/^Checked /).textContent()).toBe(before);
  await refresh(page).click();
  await count(page, 3);
  await settle(page, 2, {
    ...record(walletA, mintA, 5, 6),
    checkedAt: checkedAt + 120000,
  });
  await expect(balances(page).getByText("5", { exact: true })).toBeVisible();
  await expect(page.getByText(/Balances could not be refreshed/)).toHaveCount(
    0,
  );
  expect(await page.getByText(/^Checked /).textContent()).not.toBe(before);
});
test("newer wallet success is not replaced by an older manual-refresh failure", async ({
  page,
}) => {
  await harness(page);
  await count(page, 1);
  await settle(page, 0, record());
  await refresh(page).click();
  await count(page, 2);
  await switchIdentity(page, "Wallet B", 3);
  await settle(page, 2, record(walletB, mintA, 7, 8));
  await settle(page, 1, null, true);
  await expect(balances(page).getByText("7", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Balances could not be refreshed|Balances are unavailable/),
  ).toHaveCount(0);
  await expect(refresh(page)).toBeEnabled();
});
for (const target of ["wallet", "mint"])
  test(`actual ${target} ABA remount cannot accept historical success or failure`, async ({
    page,
  }) => {
    await harness(page);
    await count(page, 1);
    await switchIdentity(page, target === "wallet" ? "Wallet B" : "Token B", 2);
    await switchIdentity(page, target === "wallet" ? "Wallet A" : "Token A", 3);
    await settle(page, 2, record(walletA, mintA, 3, 4));
    await settle(page, 0, null, true);
    await settle(
      page,
      1,
      record(
        target === "wallet" ? walletB : walletA,
        target === "mint" ? mintB : mintA,
        9,
        9,
      ),
    );
    await expect(balances(page).getByText("3", { exact: true })).toBeVisible();
    await expect(balances(page).getByText("9", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText(
        /Balances could not be refreshed|Balances are unavailable/,
      ),
    ).toHaveCount(0);
  });
test("unmount and remount isolate pending initial and manual reads", async ({
  page,
}) => {
  await harness(page);
  await count(page, 1);
  await page.evaluate(() =>
    window.__walletReadIsolation.change({ mounted: false }),
  );
  await expect(refresh(page)).toHaveCount(0);
  await settle(page, 0, record(walletA, mintA, 9, 9));
  await page.evaluate(() =>
    window.__walletReadIsolation.change({ mounted: true }),
  );
  await count(page, 2);
  await expect(balances(page)).toHaveCount(0);
  await settle(page, 1, record());
  await refresh(page).click();
  await count(page, 3);
  await page.evaluate(() =>
    window.__walletReadIsolation.change({ mounted: false }),
  );
  await expect(refresh(page)).toHaveCount(0);
  await settle(page, 2, null, true);
  await page.evaluate(() =>
    window.__walletReadIsolation.change({ mounted: true }),
  );
  await count(page, 4);
  await expect(balances(page)).toHaveCount(0);
  await expect(page.getByText(/Balances could not be refreshed/)).toHaveCount(
    0,
  );
  await settle(page, 3, record(walletA, mintA, 5, 6));
  await expect(balances(page).getByText("5", { exact: true })).toBeVisible();
});
test("latest same-wallet multi-token sample labels another mint honestly instead of discarding it or relabelling it selected", async ({
  page,
}) => {
  await harness(page);
  await count(page, 1);
  await switchIdentity(page, "Token B", 2);
  await settle(page, 1, record(walletA, mintA, 3, 4));
  const sampled = balances(page)
    .locator("li")
    .filter({ has: page.locator(`small[title="${mintA}"]`) });
  await expect(sampled).toContainText("4");
  await expect(sampled).not.toContainText("FIXTURE_B");
  await expect(
    page.getByText(
      /selected token’s balance is unavailable; no zero balance is assumed/,
    ),
  ).toBeVisible();
  await settle(page, 0, record(walletA, mintA, 9, 9));
  await expect(sampled).toContainText("4");
  await expect(sampled).not.toContainText("9");
});
test("a null read stays explicitly unavailable and never invents a zero balance", async ({
  page,
}) => {
  await harness(page);
  await count(page, 1);
  await settle(page, 0, null);
  await expect(balances(page)).toHaveCount(0);
  await expect(
    page.getByText(
      /Balance data is unavailable or the shared request allowance is busy/,
    ),
  ).toBeVisible();
  await refresh(page).click();
  await count(page, 2);
  await settle(page, 1, record());
  await expect(balances(page)).toBeVisible();
});
for (const auth of ["guest", "loading", "unlinked"])
  test(`${auth} actual private-wallet boundary does not start a wallet read`, async ({
    page,
  }) => {
    await harness(page, auth);
    await expect(refresh(page)).toHaveCount(0);
    expect(await reads(page)).toEqual([]);
    if (auth === "unlinked")
      await expect(
        page.getByText(/Connect a wallet linked to this account/),
      ).toBeVisible();
    else {
      await expect(
        page.getByRole("link", { name: "Sign in", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => window.__walletReadIsolation.queries),
      ).toEqual([]);
    }
  });
test("sign-out unmounts private content and ignores its delayed result before a fresh signed-in read", async ({
  page,
}) => {
  await harness(page);
  await count(page, 1);
  await page.evaluate(() =>
    window.__walletReadIsolation.change({ auth: "guest" }),
  );
  await expect(refresh(page)).toHaveCount(0);
  await settle(page, 0, record(walletA, mintA, 9, 9));
  await expect(balances(page)).toHaveCount(0);
  await page.evaluate(() =>
    window.__walletReadIsolation.change({ auth: "linked" }),
  );
  await count(page, 2);
  await expect(balances(page)).toHaveCount(0);
  await settle(page, 1, record());
  await expect(balances(page).getByText("1", { exact: true })).toBeVisible();
});
test("actual native terminal guard stays read-only without any wallet or account read", async ({
  page,
}) => {
  await harness(page, "linked", "forum", true);
  await expect(
    page.getByRole("link", { name: "Open the trading terminal", exact: true }),
  ).toBeVisible();
  expect(await reads(page)).toEqual([]);
  expect(
    await page.evaluate(() => window.__walletReadIsolation.queries),
  ).toEqual([]);
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px keyboard refresh and identity switch preserve bounded read-only balances`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      await harness(page, "linked", app);
      await count(page, 1);
      await settle(page, 0, record());
      const button = refresh(page);
      await button.focus();
      await expect(button).toBeFocused();
      await page.keyboard.press("Enter");
      await count(page, 2);
      await settle(page, 1, null, true);
      await expect(page.getByText(/No payment request was made/)).toBeVisible();
      const reveal = page.getByText("Full linked wallet address", {
        exact: true,
      });
      await reveal.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.locator("code").filter({ hasText: walletA }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Wallet B", exact: true }).focus();
      await page.keyboard.press("Enter");
      await count(page, 3);
      await expect(balances(page)).toHaveCount(0);
      await settle(page, 2, record(walletB, mintA, 5, 6));
      await expect(
        page.getByText(/Balances could not be refreshed/),
      ).toHaveCount(0);
      for (const node of [
        balances(page),
        ...(await balances(page).locator("li").all()),
      ]) {
        await node.scrollIntoViewIfNeeded();
        const box = (await node.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(
          await node.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      expect((await reads(page)).map((read) => read.args)).toEqual([
        { wallet: walletA, selectedMint: mintA },
        { wallet: walletA, selectedMint: mintA },
        { wallet: walletB, selectedMint: mintA },
      ]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
