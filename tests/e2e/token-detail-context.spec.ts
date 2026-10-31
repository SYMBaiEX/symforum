import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
let script: string, css: string;
const origin = "http://127.0.0.1:43226";
const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const mintB = "So11111111111111111111111111111111111111112";
type ClipboardFixture = {
  mode: "success" | "failure" | "deferred";
  writes: string[];
  pending: { resolve(): void; reject(): void }[];
  settle(index: number, success: boolean): void;
};
declare global {
  interface Window {
    __tokenClipboard: ClipboardFixture;
    __tokenContext: {
      select(mint: string): void;
      reads: string[];
      forbidden: string[];
    };
  }
}
const audits = new WeakMap<Page, { errors: string[]; external: string[] }>();
test.beforeAll(() => {
  css =
    FORUM_SHARED_THEME_CSS + readFileSync("styles/forum-shared.css", "utf8");
  css += execFileSync(
    "bun",
    [
      "-e",
      `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/platform/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/token-detail-context.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"token-detail-only",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/token-detail-context-state.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  scenario = "",
  mode: ClipboardFixture["mode"] = "success",
) {
  const audit = { errors: [] as string[], external: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.addInitScript((mode) => {
    const fixture: ClipboardFixture = {
      mode,
      writes: [],
      pending: [],
      settle(index, success) {
        const pending = this.pending[index];
        if (success) pending.resolve();
        else pending.reject();
      },
    };
    window.__tokenClipboard = fixture;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value: string) {
          fixture.writes.push(value);
          if (fixture.mode === "failure")
            return Promise.reject(new Error("Clipboard denied"));
          if (fixture.mode === "deferred")
            return new Promise<void>((resolve, reject) =>
              fixture.pending.push({
                resolve,
                reject: () => reject(new Error("Clipboard denied")),
              }),
            );
          return Promise.resolve();
        },
      },
    });
  }, mode);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    audit.external.push(url.href);
    return route.abort();
  });
  await page.goto(`${origin}/?scenario=${scenario}`);
  await expect(
    page.getByRole("heading", { name: "$SAME", exact: true }),
  ).toBeVisible();
}
test.afterEach(async ({ page }) => {
  const audit = audits.get(page);
  if (audit) {
    expect(audit.errors).toEqual([]);
    expect(audit.external).toEqual([]);
  }
  expect(await page.evaluate(() => window.__tokenContext.forbidden)).toEqual(
    [],
  );
});
const copy = (page: Page) =>
  page
    .getByRole("button", { name: "Copy selected token mint", exact: true })
    .click();
const details = (page: Page) =>
  page.getByText("Market details & sources", { exact: true });
async function settle(page: Page, index: number, success: boolean) {
  await page.evaluate(
    async ({ index, success }) => {
      window.__tokenClipboard.settle(index, success);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    },
    { index, success },
  );
}
test("copy success belongs to the exact selected mint, not a duplicate symbol", async ({
  page,
}) => {
  await harness(page);
  await copy(page);
  await expect(page.getByText("Mint copied.", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Token B", exact: true }).click();
  await expect(page.getByText("Mint copied.", { exact: true })).toHaveCount(0);
  await copy(page);
  await expect(page.getByText("Mint copied.", { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => window.__tokenClipboard.writes)).toEqual([
    mintA,
    mintB,
  ]);
});
for (const backToA of [false, true])
  test(`a deferred old-mint clipboard attempt cannot claim the current token after A→B${backToA ? "→A" : ""}`, async ({
    page,
  }) => {
    await harness(page, "", "deferred");
    await copy(page);
    await page.getByRole("button", { name: "Token B", exact: true }).click();
    if (backToA)
      await page.getByRole("button", { name: "Token A", exact: true }).click();
    await settle(page, 0, true);
    await expect(page.getByText("Mint copied.", { exact: true })).toHaveCount(
      0,
    );
    await copy(page);
    await settle(page, 1, true);
    await expect(page.getByText("Mint copied.", { exact: true })).toHaveCount(
      1,
    );
    expect(await page.evaluate(() => window.__tokenClipboard.writes)).toEqual([
      mintA,
      backToA ? mintA : mintB,
    ]);
  });
test("clipboard denial is explicit and an old denial cannot follow the next mint", async ({
  page,
}) => {
  await harness(page, "", "failure");
  await copy(page);
  await expect(page.getByText(/Copy unavailable. The full mint/)).toBeVisible();
  await page.getByRole("button", { name: "Token B", exact: true }).click();
  await expect(page.getByText(/Copy unavailable. The full mint/)).toHaveCount(
    0,
  );
});
test("new-mint copy feedback survives a late old-mint denial", async ({
  page,
}) => {
  await harness(page, "", "deferred");
  await copy(page);
  await page.getByRole("button", { name: "Token B", exact: true }).click();
  await copy(page);
  await settle(page, 1, true);
  await settle(page, 0, false);
  await expect(page.getByText("Mint copied.", { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Copy unavailable. The full mint/)).toHaveCount(
    0,
  );
});
test("project links carry unverified context while the source link stays distinct", async ({
  page,
}) => {
  await harness(page);
  await details(page).click();
  await expect(
    page.getByText(/Website and social links are unverified project metadata/),
  ).toBeVisible();
  for (const name of ["Website", "X", "Telegram"]) {
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toHaveAccessibleDescription(
      /unverified project metadata/,
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(
    page.getByRole("link", { name: "Market source", exact: true }),
  ).not.toHaveAttribute("aria-describedby");
});
for (const scenario of ["unsafe", "missing"])
  test(`${scenario} project links stay absent without replacing missing metrics`, async ({
    page,
  }) => {
    await harness(page, scenario);
    await details(page).click();
    for (const name of ["Website", "X", "Telegram"])
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(
        0,
      );
    await expect(
      page.getByText("Unavailable", { exact: true }),
    ).not.toHaveCount(0);
    await page.getByText("What these metrics mean", { exact: true }).click();
    await expect(
      page.getByText(/Missing values remain unavailable/),
    ).toBeVisible();
  });
for (const width of [320, 390])
  test(`${width}px native glossary is keyboard readable in the existing scrollport without changing stale metrics`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    await harness(page);
    await expect(
      page.getByText("What these metrics mean", { exact: true }),
    ).toBeHidden();
    const metrics = await page.locator("dl").allTextContents();
    await details(page).focus();
    await page.keyboard.press("Enter");
    const glossary = page.getByText("What these metrics mean", { exact: true });
    await glossary.focus();
    await expect(glossary).toBeFocused();
    expect((await glossary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");
    for (const text of [
      /circulating supply/,
      /fully diluted valuation/,
      /not a guarantee of executable depth/,
      /not verified people/,
      /one-hour and 24-hour/,
    ])
      await expect(page.getByText(text)).toBeVisible();
    await expect(page.getByText(/Stale sampled metrics/)).toBeVisible();
    expect(
      (await page.locator("dl").allTextContents()).slice(0, metrics.length),
    ).toEqual(metrics);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Token explorer", exact: true }),
    ).toBeFocused();
    const workspace = page.getByRole("region", {
      name: "Loaded token workspace",
      exact: true,
    });
    expect(
      await workspace.evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);
    expect(await workspace.evaluate((node) => node.scrollTop)).toBeGreaterThan(
      0,
    );
    expect(
      await page.evaluate(() => document.scrollingElement?.scrollTop),
    ).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => window.__tokenContext.reads)).toEqual([
      mintA,
    ]);
  });
