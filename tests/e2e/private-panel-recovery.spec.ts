import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43287";
let script: string;
const css: Record<string, string> = {};
const audits = new WeakMap<Page, { outbound: string[]; errors: string[] }>();
type Receipt = {
  quoteId: string;
  status: "held" | "submitted" | "confirmed" | "prepared";
  signature: string | null;
  inputMint: string;
  outputMint: string;
  createdAt: number;
};
type Delivery = { mode: "loaded" | "loading" | "failed"; rows: Receipt[] };
declare global {
  interface Window {
    privateHistoryFixture: {
      counts: { mounts: number; unmounts: number };
      forbidden: string[];
      queries: { name: string; args: unknown; owner: string | null }[];
      subscriptions: { owner: string | null; active: boolean }[];
      change(value: {
        owner?: string | null;
        auth?: string;
        active?: "wallet" | "receipts";
        mounted?: boolean;
      }): void;
      next(value: Delivery): void;
      deliver(index: number, value: Delivery): void;
      latest(): number;
    };
  }
}
const held: Receipt = {
  quoteId: "invented-held-a",
  status: "held",
  signature: "1".repeat(88),
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
  createdAt: 1793520000000,
};
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
    css[app] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { cwd: `apps/${app}`, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
      );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/private-panel-recovery.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"private-history-inert",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/private-panel-recovery-state.tsx"}));build.onLoad({filter:/components\\/trading\\/forum-terminal\\.tsx$/},async({path})=>({contents:(await Bun.file(path).text())+"\\nexport { AccountPanels as PrivateHistoryParent };",loader:"tsx"}));}}]});if(!result.success)throw Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  app = "platform",
  width = 390,
  direct = false,
  initialFailure = false,
) {
  await page.setViewportSize({ width, height: 844 });
  const audit = { outbound: [] as string[], errors: [] as string[] };
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
  await page.goto(
    `${origin}/?${direct ? "direct&" : ""}${initialFailure ? "initial-failure" : ""}`,
  );
  await expect(page.getByRole("main")).toBeVisible();
}
const attention = (page: Page) => page.getByLabel("Known protected counts");
const retry = (page: Page) =>
  page.getByRole("button", { name: "Retry panel: Swap history", exact: true });
async function deliver(page: Page, value: Delivery, index?: number) {
  await page.evaluate(
    ({ value, index }) => {
      const f = window.privateHistoryFixture;
      f.deliver(index ?? f.latest(), value);
    },
    { value, index },
  );
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.outbound).toEqual([]);
  expect(audits.get(page)?.errors).toEqual([]);
  expect(
    await page.evaluate(() => window.privateHistoryFixture.forbidden),
  ).toEqual([]);
});
test("read failure retains known protection and retries only the history reader", async ({
  page,
}) => {
  await harness(page);
  await expect(attention(page)).toContainText('"count":1');
  await page.getByLabel("Unrelated retained draft").fill("keep my text");
  await deliver(page, { mode: "failed", rows: [] });
  await expect(retry(page)).toBeVisible();
  await expect(attention(page)).toContainText('"count":1');
  await expect(page.getByText(/No swap operations/)).toHaveCount(0);
  await page.evaluate(() =>
    window.privateHistoryFixture.next({ mode: "loaded", rows: [] }),
  );
  await retry(page).click();
  await expect(
    page.getByText(/No swap operations on this account yet/),
  ).toBeVisible();
  await expect(attention(page)).toHaveText("[]");
  await expect(page.getByLabel("Unrelated retained draft")).toHaveValue(
    "keep my text",
  );
  expect(
    await page.evaluate(() => window.privateHistoryFixture.counts),
  ).toEqual({ mounts: 1, unmounts: 0 });
  expect(
    await page.evaluate(() => window.privateHistoryFixture.queries),
  ).toEqual([
    { name: "forumSwaps:listMine", args: {}, owner: "invented-owner-a" },
    { name: "forumSwaps:listMine", args: {}, owner: "invented-owner-a" },
  ]);
});
test("repeated read failure preserves attention and keeps retry focused", async ({
  page,
}) => {
  await harness(page);
  await deliver(page, { mode: "failed", rows: [] });
  await expect(retry(page)).toBeVisible();
  await page.evaluate(() =>
    window.privateHistoryFixture.next({ mode: "failed", rows: [] }),
  );
  await retry(page).click();
  await expect(retry(page)).toBeFocused();
  await expect(attention(page)).toContainText('"count":1');
});
test("owner and loading transitions clear private context and reject ABA old deliveries", async ({
  page,
}) => {
  await harness(page);
  await expect(attention(page)).toContainText('"count":1');
  await page.evaluate(() => {
    const f = window.privateHistoryFixture;
    f.next({ mode: "loading", rows: [] });
    f.change({ owner: "invented-owner-b" });
  });
  await expect(attention(page)).toHaveText("[]");
  await expect(page.getByRole("link", { name: /on Solscan/ })).toHaveCount(0);
  await deliver(page, { mode: "loaded", rows: [held] }, 0);
  await expect(attention(page)).toHaveText("[]");
  await page.evaluate(() =>
    window.privateHistoryFixture.change({ owner: "invented-owner-a" }),
  );
  await expect(attention(page)).toHaveText("[]");
  await deliver(
    page,
    { mode: "loaded", rows: [{ ...held, status: "submitted" }] },
    0,
  );
  await expect(attention(page)).toHaveText("[]");
  await deliver(page, { mode: "loaded", rows: [] });
  await expect(
    page.getByText(/No swap operations on this account yet/),
  ).toBeVisible();
  await page.evaluate(() =>
    window.privateHistoryFixture.change({ auth: "loading" }),
  );
  await expect(
    page.getByText(/No swap operations on this account yet/),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.privateHistoryFixture.change({ auth: "guest" }),
  );
  await expect(
    page.getByRole("link", { name: "Sign in to view swap receipts" }),
  ).toBeVisible();
  await expect(attention(page)).toHaveText("[]");
});
test("retry success focus lands on the stable history surface", async ({
  page,
}) => {
  await harness(page);
  await deliver(page, { mode: "failed", rows: [] });
  await expect(retry(page)).toBeVisible();
  await page.evaluate(() =>
    window.privateHistoryFixture.next({ mode: "loaded", rows: [] }),
  );
  await retry(page).click();
  await expect(
    page.getByRole("region", { name: "Recent swap operations", exact: true }),
  ).toBeFocused();
});
test("undefined reload retains last confirmed protection and old retry deliveries cannot clear it", async ({
  page,
}) => {
  await harness(page);
  await expect(attention(page)).toContainText('"count":1');
  await deliver(page, { mode: "loading", rows: [] });
  await expect(
    page.getByText("Loading your operation receipts…"),
  ).toBeVisible();
  await expect(attention(page)).toContainText('"count":1');
  await deliver(page, { mode: "failed", rows: [] });
  await expect(retry(page)).toBeVisible();
  await page.evaluate(() =>
    window.privateHistoryFixture.next({
      mode: "loaded",
      rows: [
        {
          quoteId: "invented-new-held",
          status: "held",
          signature: null,
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
          createdAt: 1793520000000,
        },
      ],
    }),
  );
  await retry(page).click();
  await expect(attention(page)).toContainText('"count":1');
  await deliver(page, { mode: "loaded", rows: [] }, 0);
  await expect(attention(page)).toContainText('"count":1');
  await expect(
    page.getByText("No signature recorded", { exact: true }),
  ).toBeVisible();
});
test("hidden receipt navigation retains the real watchlist draft and history subscription", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() =>
    window.privateHistoryFixture.change({ active: "wallet" }),
  );
  await page
    .getByRole("textbox", { name: "Alert above, USD", exact: true })
    .fill("0.0042");
  await page.evaluate(() =>
    window.privateHistoryFixture.change({ active: "receipts" }),
  );
  await deliver(page, { mode: "failed", rows: [] });
  await expect(retry(page)).toBeVisible();
  await page.evaluate(() =>
    window.privateHistoryFixture.next({ mode: "loaded", rows: [] }),
  );
  await retry(page).click();
  await page.evaluate(() =>
    window.privateHistoryFixture.change({ active: "wallet" }),
  );
  await expect(
    page.getByRole("textbox", { name: "Alert above, USD", exact: true }),
  ).toHaveValue("0.0042");
  expect(
    await page.evaluate(
      () => window.privateHistoryFixture.subscriptions.length,
    ),
  ).toBe(2);
});
test("absent verified identity gates the reader without a synthetic query or stale link", async ({
  page,
}) => {
  await harness(page, "platform", 390, true);
  await expect(attention(page)).toContainText('"count":1');
  await page.evaluate(() =>
    window.privateHistoryFixture.change({ owner: null }),
  );
  await expect(
    page.getByText(/Confirming your account before loading/),
  ).toBeVisible();
  await expect(attention(page)).toHaveText("[]");
  await expect(page.getByRole("link", { name: /on Solscan/ })).toHaveCount(0);
  await deliver(page, { mode: "loaded", rows: [held] }, 0);
  expect(
    await page.evaluate(
      () => window.privateHistoryFixture.subscriptions.length,
    ),
  ).toBe(1);
  await expect(attention(page)).toHaveText("[]");
});
test("an initially failed read remains unknown rather than confirmed-empty or an all-clear ledger", async ({
  page,
}) => {
  await harness(page, "forum", 390, false, true);
  await expect(retry(page)).toBeVisible();
  await expect(attention(page)).toHaveText("[]");
  await expect(
    page.getByText(/No swap operations on this account yet/),
  ).toHaveCount(0);
  await expect(page.getByText(/Last confirmed records include/)).toHaveCount(0);
  await page.evaluate(() =>
    window.privateHistoryFixture.next({ mode: "loading", rows: [] }),
  );
  await retry(page).click();
  await expect(
    page.getByText("Loading your operation receipts…"),
  ).toBeVisible();
  await expect(attention(page)).toHaveText("[]");
});
test("unmount and fresh remount ignore a prior reader's delayed success or failure", async ({
  page,
}) => {
  await harness(page);
  await expect(attention(page)).toContainText('"count":1');
  await page.evaluate(() =>
    window.privateHistoryFixture.change({ mounted: false }),
  );
  await expect(attention(page)).toHaveText("[]");
  await deliver(page, { mode: "failed", rows: [] }, 0);
  await page.evaluate(() => {
    const f = window.privateHistoryFixture;
    f.next({ mode: "loaded", rows: [] });
    f.change({ mounted: true });
  });
  await expect(
    page.getByText(/No swap operations on this account yet/),
  ).toBeVisible();
  await deliver(page, { mode: "loaded", rows: [held] }, 0);
  await expect(attention(page)).toHaveText("[]");
  await expect(page.getByRole("link", { name: /on Solscan/ })).toHaveCount(0);
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390, 1280])
    test(`${app} ${width}: recovery has intrinsic bounds and 44px keyboard control`, async ({
      page,
    }) => {
      await harness(page, app, width);
      await deliver(page, { mode: "failed", rows: [] });
      await expect(retry(page)).toBeVisible();
      const box = await retry(page).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      const section = page.getByRole("region", {
        name: "Recent swap operations",
        exact: true,
      });
      const bounds = await section.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await retry(page).focus();
      await page.evaluate(() =>
        window.privateHistoryFixture.next({ mode: "loaded", rows: [] }),
      );
      await page.keyboard.press("Enter");
      await expect(section).toBeFocused();
    });
