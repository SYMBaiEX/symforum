import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
import type { TerminalWalletReadState } from "../../lib/forum-terminal-model";
const origin = "http://127.0.0.1:43252",
  walletA = "EULE1PmLm452j4sfNTn4HrzEWa957Zdf3tZCtmjoaTtF",
  walletB = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY",
  mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  mintB = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1V";
type DemandWindow = Window & {
  walletDemand: {
    reads: { args: { wallet: string; selectedMint: string } }[];
    forbidden: string[];
    metadataReads: { mint: string }[];
    change(patch: {
      wallet?: string;
      mint?: string;
      auth?: string;
      mounted?: boolean;
    }): void;
    settle(
      i: number,
      value: TerminalWalletReadState | null,
      failed?: boolean,
    ): void;
  };
  setDemandEnvironment(online: boolean, visible: boolean): void;
};
const calls = (p: Page) =>
  p.evaluate(() => (window as unknown as DemandWindow).walletDemand.reads);
const refresh = (p: Page) =>
  p.getByRole("button", { name: "Refresh wallet balances", exact: true });
const frames = (p: Page) =>
  p.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
const record = (wallet = walletA, mint = mintA): TerminalWalletReadState => ({
  wallet,
  checkedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  slot: 123,
  balances: [
    {
      mint: "So11111111111111111111111111111111111111112",
      rawAmount: "1000000000",
      decimals: 9,
    },
    { mint, rawAmount: "2000000", decimals: 6 },
  ],
  maxSolRaw: null,
  feeReserveLamports: null,
});
let script: string;
const css = new Map<string, string>();
test.beforeAll(() => {
  const baselineLoader =
    process.env.WALLET_VISIBLE_DEMAND_BASELINE === "1"
      ? `build.onLoad({filter:/wallet-panel[.]tsx$/},()=>({contents:Bun.spawnSync(['git','show','fafd6a560ef862396f33c66141e4bf2b228e4b0a:components/trading/wallet-panel.tsx']).stdout.toString(),loader:'tsx',resolveDir:process.cwd()+'/components/trading'}));`
      : "";
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
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/wallet-visible-demand.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"isolated-wallet-demand",setup(build){${baselineLoader}build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/wallet-visible-demand-state.tsx"}));build.onLoad({filter:/components\\/trading\\/forum-terminal[.]tsx$/},async(args)=>({contents:(await Bun.file(args.path).text())+'\\nexport { AccountPanels as VisibleDemandAccountPanels };',loader:'tsx'}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));for(const file of r.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  scenario = "",
  app = "platform",
  online = true,
  visible = true,
) {
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ online: initialOnline, visible: initialVisible }) => {
      let online = initialOnline,
        visible = initialVisible;
      Object.defineProperty(navigator, "onLine", { get: () => online });
      Object.defineProperty(document, "visibilityState", {
        get: () => (visible ? "visible" : "hidden"),
      });
      Object.defineProperty(document, "hidden", { get: () => !visible });
      Object.assign(window, {
        setDemandEnvironment(nextOnline: boolean, nextVisible: boolean) {
          online = nextOnline;
          visible = nextVisible;
          window.dispatchEvent(new Event(online ? "online" : "offline"));
          document.dispatchEvent(new Event("visibilitychange"));
        },
      });
    },
    { online, visible },
  );
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin === origin) {
      if (u.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.get(app)}${scenario.includes("csshidden") ? "main{visibility:hidden}" : ""}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (u.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
      if (u.pathname === "/images/brand/symforum-icon-64.png")
        return route.fulfill({
          contentType: "image/png",
          body: readFileSync("public/images/brand/symforum-icon-64.png"),
        });
      if (u.pathname.endsWith("/chart"))
        return route.fulfill({
          status: 503,
          json: {
            state: "unavailable",
            cache: { nextRetryAt: Date.now() + 600_000 },
          },
        });
    }
    unexpected.push(u.href);
    return route.abort();
  });
  await page.goto(`${origin}/?held&${scenario}`);
  await frames(page);
  return {
    check: async () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
      expect(
        await page.evaluate(
          () => (window as unknown as DemandWindow).walletDemand.forbidden,
        ),
      ).toEqual([]);
    },
  };
}
async function openWallet(page: Page) {
  const direct = page.getByRole("button", {
    name: "Wallet & watches",
    exact: true,
  });
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("button", { name: "Wallet & watches", exact: true })
      .click();
  }
}
async function settle(
  page: Page,
  index: number,
  value: TerminalWalletReadState | null = record(),
  failed = false,
) {
  await page.evaluate(
    ({ index, value, failed }) =>
      (window as unknown as DemandWindow).walletDemand.settle(
        index,
        value,
        failed,
      ),
    { index, value, failed },
  );
}
const change = (
  page: Page,
  patch: Parameters<DemandWindow["walletDemand"]["change"]>[0],
) =>
  page.evaluate(
    (patch) => (window as unknown as DemandWindow).walletDemand.change(patch),
    patch,
  );
const environment = (page: Page, online: boolean, visible: boolean) =>
  page.evaluate(
    ({ online, visible }) =>
      (window as unknown as DemandWindow).setDemandEnvironment(online, visible),
    { online, visible },
  );

test("real terminal receipts/closed drawer do not read balances; first wallet visit admits once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const run = await harness(page);
  expect(await calls(page)).toHaveLength(0);
  expect(
    await page.evaluate(
      () => (window as unknown as DemandWindow).walletDemand.metadataReads,
    ),
  ).toEqual([{ mint: "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump" }]);
  await page.getByRole("button", { name: "Receipts", exact: true }).click();
  await expect(
    page.getByText("Outcome protected", { exact: true }),
  ).toBeVisible();
  const receipt = await page
    .getByText("Outcome protected", { exact: true })
    .elementHandle();
  await frames(page);
  expect(await calls(page)).toHaveLength(0);
  await page
    .getByRole("button", { name: "Close tools panel", exact: true })
    .click();
  await openWallet(page);
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0].args).toEqual({
    wallet: walletA,
    selectedMint: "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
  });
  await settle(
    page,
    0,
    record(walletA, "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump"),
  );
  await expect(refresh(page)).toBeEnabled();
  await page
    .getByRole("button", { name: "Close tools panel", exact: true })
    .click();
  await openWallet(page);
  await frames(page);
  expect(await calls(page)).toHaveLength(1);
  expect(await receipt!.evaluate((node) => node.isConnected)).toBe(true);
  await refresh(page).click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await refresh(page).dispatchEvent("click");
  expect(await calls(page)).toHaveLength(2);
  await settle(page, 1, null, true);
  await expect(
    page.getByText(
      "Balances could not be refreshed. No payment request was made.",
      { exact: true },
    ),
  ).toBeVisible();
  await run.check();
});
for (const [online, visible] of [
  [false, true],
  [true, false],
])
  test(`no balance admission while online=${online}/foreground=${visible}`, async ({
    page,
  }) => {
    const run = await harness(page, "parent", "platform", online, visible);
    await frames(page);
    expect(await calls(page)).toHaveLength(0);
    await expect(refresh(page)).toBeDisabled();
    await refresh(page).dispatchEvent("click");
    expect(await calls(page)).toHaveLength(0);
    await environment(page, true, true);
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    await settle(page, 0);
    await environment(page, false, false);
    await environment(page, true, true);
    await frames(page);
    expect(await calls(page)).toHaveLength(1);
    await run.check();
  });
test("a hidden in-flight read settles for its same identity without visibility replay", async ({
  page,
}) => {
  const run = await harness(page, "parent");
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await environment(page, false, false);
  await settle(page, 0);
  await environment(page, true, true);
  await expect(
    page.getByRole("list", { name: "Wallet balances", exact: true }),
  ).toBeVisible();
  await frames(page);
  expect(await calls(page)).toHaveLength(1);
  await run.check();
});

test("real intersection visibility gates an offscreen panel before its first read", async ({
  page,
}) => {
  const run = await harness(page, "parent&offscreen");
  await frames(page);
  expect(await calls(page)).toHaveLength(0);
  await refresh(page).dispatchEvent("click");
  expect(await calls(page)).toHaveLength(0);
  await refresh(page).scrollIntoViewIfNeeded();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await settle(page, 0);
  await run.check();
});
test("current CSS visibility blocks admission even when the observer intersects", async ({
  page,
}) => {
  const run = await harness(page, "parent&csshidden");
  await frames(page);
  expect(await calls(page)).toHaveLength(0);
  const hiddenRefresh = page.getByRole("button", {
    name: "Refresh wallet balances",
    exact: true,
    includeHidden: true,
  });
  await hiddenRefresh.dispatchEvent("click");
  expect(await calls(page)).toHaveLength(0);
  await page.evaluate(() => {
    document.querySelector("main")!.style.visibility = "visible";
    (window as unknown as DemandWindow).setDemandEnvironment(true, true);
  });
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await settle(page, 0);
  await run.check();
});
test("current viewport bounds reject a synchronous online event before observer catches up", async ({
  page,
}) => {
  const run = await harness(page, "parent", "platform", false, true);
  await frames(page);
  expect(await calls(page)).toHaveLength(0);
  const top = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    main.style.transform = "translateY(1800px)";
    const top = document
      .querySelector('[aria-labelledby="terminal-wallet-title"]')!
      .getBoundingClientRect().top;
    (window as unknown as DemandWindow).setDemandEnvironment(true, true);
    return top;
  });
  expect(top).toBeGreaterThan(900);
  expect(await calls(page)).toHaveLength(0);
  await page
    .getByRole("button", {
      name: "Refresh wallet balances",
      exact: true,
      includeHidden: true,
    })
    .dispatchEvent("click");
  expect(await calls(page)).toHaveLength(0);
  await page.evaluate(() => {
    document.querySelector("main")!.style.transform = "";
    (window as unknown as DemandWindow).setDemandEnvironment(true, true);
  });
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await settle(page, 0);
  await run.check();
});
test("closing actual terminal during an admitted read preserves its identity-bound result without replay", async ({
  page,
}) => {
  const run = await harness(page);
  await openWallet(page);
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await page
    .getByRole("button", { name: "Close tools panel", exact: true })
    .click();
  await settle(
    page,
    0,
    record(walletA, "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump"),
  );
  await openWallet(page);
  await expect(
    page.getByRole("list", { name: "Wallet balances", exact: true }),
  ).toBeVisible();
  await frames(page);
  expect(await calls(page)).toHaveLength(1);
  await run.check();
});
test("failed first demand is not automatically replayed by visibility changes", async ({
  page,
}) => {
  const run = await harness(page, "parent");
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await settle(page, 0, null, true);
  await expect(
    page.getByText(
      "Balances are unavailable. Wallet transactions remain separate.",
      { exact: true },
    ),
  ).toBeVisible();
  await environment(page, false, false);
  await environment(page, true, true);
  await frames(page);
  expect(await calls(page)).toHaveLength(1);
  await refresh(page).click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await settle(page, 1);
  await run.check();
});
for (const context of ["wallet", "mint"])
  test(`${context} A→B→A defers old results/errors and unmounts safely`, async ({
    page,
  }) => {
    const run = await harness(page, "parent");
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    await change(
      page,
      context === "wallet" ? { wallet: walletB } : { mint: mintB },
    );
    await expect.poll(async () => (await calls(page)).length).toBe(2);
    await change(
      page,
      context === "wallet" ? { wallet: walletA } : { mint: mintA },
    );
    await expect.poll(async () => (await calls(page)).length).toBe(3);
    await settle(page, 1, null, true);
    await settle(page, 0, record(walletA, mintA));
    await expect(
      page.getByRole("list", { name: "Wallet balances", exact: true }),
    ).toHaveCount(0);
    await settle(page, 2);
    await expect(
      page.getByRole("list", { name: "Wallet balances", exact: true }),
    ).toBeVisible();
    await refresh(page).click();
    await expect.poll(async () => (await calls(page)).length).toBe(4);
    await change(page, { mounted: false });
    await settle(page, 3, null, true);
    await change(page, { mounted: true });
    await expect.poll(async () => (await calls(page)).length).toBe(5);
    await expect(
      page.getByRole("list", { name: "Wallet balances", exact: true }),
    ).toHaveCount(0);
    await settle(page, 4);
    await run.check();
  });
for (const auth of ["guest", "loading", "unlinked"])
  test(`${auth} never reads balances`, async ({ page }) => {
    const run = await harness(page, `auth=${auth}`);
    await openWallet(page);
    await frames(page);
    expect(await calls(page)).toHaveLength(0);
    await run.check();
  });
test("native host never initializes a wallet balance read", async ({
  page,
}) => {
  const run = await harness(page, "native");
  await frames(page);
  expect(await calls(page)).toHaveLength(0);
  await run.check();
});
for (const app of ["platform", "forum"])
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ])
    test(`${app} ${viewport.width}x${viewport.height}: only visible mobile wallet pane demands a read`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const run = await harness(page, "", app);
      expect(await calls(page)).toHaveLength(0);
      await openWallet(page);
      await expect.poll(async () => (await calls(page)).length).toBe(1);
      await settle(
        page,
        0,
        record(walletA, "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump"),
      );
      await refresh(page).scrollIntoViewIfNeeded();
      const box = await refresh(page).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      await refresh(page).focus();
      await expect(refresh(page)).toBeFocused();
      const mobileChart = page.getByRole("button", {
        name: "Chart",
        exact: true,
      });
      if (await mobileChart.isVisible()) await mobileChart.click();
      else
        await page
          .getByRole("button", { name: "Close tools panel", exact: true })
          .click();
      await frames(page);
      await page
        .getByRole("button", {
          name: "Refresh wallet balances",
          exact: true,
          includeHidden: true,
        })
        .dispatchEvent("click");
      expect(await calls(page)).toHaveLength(1);
      await openWallet(page);
      await frames(page);
      expect(await calls(page)).toHaveLength(1);
      await run.check();
    });
