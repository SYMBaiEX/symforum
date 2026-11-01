import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43307",
  at = Date.parse("2026-11-01T12:00:00Z");
let script: string;
const css = {} as Record<"platform" | "forum", string>;
type Fixture = {
  reads: { name: string; args: unknown }[];
  forbidden: string[];
  rows: { mint: string; intentKey: string }[];
  update(patch: {
    owner?: string | null;
    mint?: string;
    history?: string;
    mounted?: boolean;
  }): void;
};
declare global {
  interface Window {
    __researchReceiptLibrary: Fixture;
  }
}
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
test.beforeAll(() => {
  for (const app of ["platform", "forum"] as const)
    css[app] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/research-receipt-library.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"receipt-local-only",setup(build){build.onResolve({filter:/^convex\\/react$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/research-receipt-library-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));process.stdout.write(await result.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(page: Page, app: "platform" | "forum" = "platform") {
  await page.clock.install({ time: at });
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
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "Token research export" }),
  ).toBeVisible();
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  const f = await page.evaluate(() => window.__researchReceiptLibrary);
  expect(f.forbidden).toEqual([]);
  for (const read of f.reads) {
    expect(["forumResearch:getConfig", "forumResearch:listMine"]).toContain(
      read.name,
    );
    expect(Object.keys(read.args as object)).toEqual(
      read.name.endsWith("getConfig") ? ["now"] : [],
    );
  }
});
const open = (page: Page) =>
  page.getByText("Your recent research receipts", { exact: true }).click();
const search = (page: Page) =>
  page.getByRole("searchbox", { name: "Search loaded receipts", exact: true });
test("local filtering never hides protected attempts or changes reads", async ({
  page,
}) => {
  await harness(page);
  await open(page);
  const before = await page.evaluate(
    () => window.__researchReceiptLibrary.reads,
  );
  const firstPinned = page
    .getByRole("region", { name: "Protected research payment attempts" })
    .getByRole("listitem")
    .first();
  await firstPinned.evaluate((node) => {
    node.setAttribute("data-mount-marker", "retained");
  });
  await search(page).fill("no-matching-receipt");
  await page
    .getByRole("combobox", { name: "Receipt status", exact: true })
    .selectOption("fulfilled");
  const pinned = page.getByRole("region", {
    name: "Protected research payment attempts",
  });
  await expect(pinned.getByRole("listitem")).toHaveCount(3);
  await expect(firstPinned).toHaveAttribute("data-mount-marker", "retained");
  await expect(pinned).toContainText("0 match this search");
  await expect(
    page.getByText("Showing 3 of 7 loaded receipts.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No other loaded receipts match.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__researchReceiptLibrary.reads),
  ).toEqual(before);
  await page
    .getByRole("button", { name: "Clear receipt search", exact: true })
    .click();
  await expect(search(page)).toBeFocused();
  await expect(
    page.getByRole("combobox", { name: "Receipt status" }),
  ).toHaveValue("fulfilled");
  await expect(
    page.getByText("Showing 4 of 7 loaded receipts.", { exact: true }),
  ).toBeVisible();
});

test("full original-case mint and exact receipt-ID searches use loaded records only", async ({
  page,
}) => {
  await harness(page);
  await open(page);
  const rows = await page.evaluate(() => window.__researchReceiptLibrary.rows);
  const before = await page.evaluate(
    () => window.__researchReceiptLibrary.reads,
  );
  await search(page).fill(rows[3].mint);
  await expect(
    page.getByText("Showing 4 of 7 loaded receipts.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open report + receipt", exact: true }),
  ).toHaveAttribute("href", `/api/research/token/${rows[3].intentKey}`);
  await search(page).fill(rows[0].mint.toLowerCase());
  await expect(
    page.getByText("Showing 3 of 7 loaded receipts.", { exact: true }),
  ).toBeVisible();
  await search(page).fill(rows[3].intentKey);
  await expect(
    page.getByText("Showing 4 of 7 loaded receipts.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__researchReceiptLibrary.reads),
  ).toEqual(before);
});
test("expiry/status projection uses the unchanged minute clock without automatic recovery", async ({
  page,
}) => {
  await harness(page);
  await open(page);
  await page
    .getByRole("combobox", { name: "Receipt status" })
    .selectOption("expired");
  await expect(
    page.getByText("Showing 4 of 7 loaded receipts.", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(60000);
  await expect(
    page.getByText("Showing 5 of 7 loaded receipts.", { exact: true }),
  ).toBeVisible();
  const reads = await page.evaluate(
    () => window.__researchReceiptLibrary.reads,
  );
  expect(
    reads.filter((read) => read.name === "forumResearch:getConfig"),
  ).toHaveLength(2);
  expect(
    reads.filter((read) => read.name === "forumResearch:listMine"),
  ).toHaveLength(1);
});
test("owner/mint changes clear only local filter presentation and do not reveal prior receipts", async ({
  page,
}) => {
  await harness(page);
  await open(page);
  await search(page).fill("no-match");
  await page.evaluate(() =>
    window.__researchReceiptLibrary.update({ owner: "B", history: "loading" }),
  );
  await open(page);
  await expect(search(page)).toHaveValue("");
  await expect(
    page.getByText("Loading your research receipts…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Protected research payment attempts" }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.__researchReceiptLibrary.update({ history: "loaded" }),
  );
  await expect(
    page.getByText("Showing 1 of 1 loaded receipts.", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.__researchReceiptLibrary.update({ owner: null }),
  );
  await expect(
    page.getByText("Your recent research receipts", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.__researchReceiptLibrary.update({ owner: "A" }),
  );
  await open(page);
  await expect(search(page)).toHaveValue("");
  await search(page).fill("no-match");
  await page.evaluate(() =>
    window.__researchReceiptLibrary.update({
      mint: window.__researchReceiptLibrary.rows[3].mint,
    }),
  );
  await open(page);
  await expect(search(page)).toHaveValue("");
});
test("genuinely empty loaded owner history stays distinct from filtered no-match", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() =>
    window.__researchReceiptLibrary.update({ history: "empty" }),
  );
  await open(page);
  await expect(
    page.getByText("No research receipts are loaded.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No other loaded receipts match.", { exact: true }),
  ).toHaveCount(0);
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}: local controls and pinned rows fit with keyboard access`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await harness(page, app);
      const summary = page.getByText("Your recent research receipts", {
        exact: true,
      });
      await summary.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await expect(search(page)).toBeFocused();
      await search(page).fill("x".repeat(120));
      // Collect independent evidence for BOTH fields before the original hard
      // control/row assertions below. Soft failures still fail the whole test.
      for (const field of [
        search(page),
        page.getByRole("combobox", { name: "Receipt status" }),
      ]) {
        const bounds = await field.boundingBox();
        expect
          .soft(
            bounds?.height,
            (await field.getAttribute("type")) ?? "status select",
          )
          .toBeGreaterThanOrEqual(44);
      }
      for (const control of [
        search(page),
        page.getByRole("combobox", { name: "Receipt status" }),
        page.getByRole("button", { name: "Clear receipt search" }),
        summary,
      ]) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      for (const row of await page
        .getByRole("region", { name: "Protected research payment attempts" })
        .getByRole("listitem")
        .all()) {
        const box = await row.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        for (const action of await row.locator("a,button").all()) {
          const target = await action.boundingBox();
          expect(target!.height).toBeGreaterThanOrEqual(44);
          expect(target!.width).toBeGreaterThanOrEqual(44);
          expect(target!.x).toBeGreaterThanOrEqual(box!.x);
          expect(target!.x + target!.width).toBeLessThanOrEqual(
            box!.x + box!.width,
          );
        }
      }
    });
