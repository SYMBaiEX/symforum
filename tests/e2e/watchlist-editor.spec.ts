import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const mint = "So11111111111111111111111111111111111111112";
type Editor = {
  calls: { name: string; args: Record<string, unknown> }[];
  selected: { mint: string }[];
  mode: "success" | "reject" | "defer";
  serverOnlyUpdate(bounds: {
    priceAboveUsd?: number | null;
    priceBelowUsd?: number | null;
  }): void;
  settle(success: boolean): void;
};
declare global {
  interface Window {
    __watchEditor: Editor;
  }
}
let script: string;
let css: string;
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/watchlist-editor.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env.NODE_ENV":JSON.stringify("production")},plugins:[{name:"watchlist-mock",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/watchlist-editor-state.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});

async function harness(page: Page, scenario = "") {
  const audit = { errors: [] as string[], external: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:43219") {
      audit.external.push(url.origin);
      return route.abort();
    }
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43219/?${scenario}`);
  await expect(
    page.getByRole("form", { name: "Watch thresholds" }),
  ).toBeVisible();
}
test.afterEach(({ page }) => {
  const audit = audits.get(page);
  if (audit) {
    expect(audit.errors).toEqual([]);
    expect(audit.external).toEqual([]);
  }
});
const calls = (page: Page) => page.evaluate(() => window.__watchEditor.calls);
const save = (page: Page) =>
  page.getByRole("button", { name: "Update watch", exact: true }).click();

test("clear above is a reversible draft; Save preserves the lower threshold", async ({
  page,
}) => {
  await harness(page);
  await page.getByRole("button", { name: "Clear above", exact: true }).click();
  await expect(
    page.getByText("Above threshold will be cleared when you save."),
  ).toBeVisible();
  expect(await calls(page)).toEqual([]);
  await save(page);
  expect(await calls(page)).toEqual([
    {
      name: "forumTerminal:setWatchlist",
      args: { mint, enabled: true, priceAboveUsd: null },
    },
  ]);
  await expect(
    page.getByText("Saved thresholds: above not set, below $5.00."),
  ).toBeVisible();
});

test("clear below can be undone and blank fields still keep both saved thresholds", async ({
  page,
}) => {
  await harness(page);
  await page.getByRole("button", { name: "Clear below", exact: true }).click();
  await page
    .getByRole("button", { name: "Keep saved below", exact: true })
    .click();
  expect(await calls(page)).toEqual([]);
  await save(page);
  expect((await calls(page))[0].args).toEqual({
    mint,
    enabled: true,
  });
  await page.getByRole("button", { name: "Clear below", exact: true }).click();
  await save(page);
  expect((await calls(page))[1].args).toEqual({
    mint,
    enabled: true,
    priceBelowUsd: null,
  });
});

test("clear both also waits for explicit Save", async ({ page }) => {
  await harness(page);
  await page
    .getByRole("button", { name: "Clear thresholds", exact: true })
    .click();
  expect(await calls(page)).toEqual([]);
  await expect(
    page.getByText("Above threshold will be cleared when you save."),
  ).toBeVisible();
  await expect(
    page.getByText("Below threshold will be cleared when you save."),
  ).toBeVisible();
  await save(page);
  expect((await calls(page))[0].args).toEqual({
    mint,
    enabled: true,
    priceAboveUsd: null,
    priceBelowUsd: null,
  });
});

test("clearing one bound preserves another tab's newer unrelated bound", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() =>
    window.__watchEditor.serverOnlyUpdate({ priceBelowUsd: 6 }),
  );
  await expect(
    page.getByText("Saved thresholds: above $10.00, below $5.00."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear above", exact: true }).click();
  await save(page);
  expect((await calls(page))[0].args).toEqual({
    mint,
    enabled: true,
    priceAboveUsd: null,
  });
  await expect(
    page.getByText("Saved thresholds: above not set, below $6.00."),
  ).toBeVisible();
});

test("blank KEEP omits both bounds and preserves newer server values", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() =>
    window.__watchEditor.serverOnlyUpdate({
      priceAboveUsd: 12,
      priceBelowUsd: 6,
    }),
  );
  await save(page);
  expect((await calls(page))[0].args).toEqual({ mint, enabled: true });
  await expect(
    page.getByText("Saved thresholds: above $12.00, below $6.00."),
  ).toBeVisible();
});

test("server validation still rejects a locally-valid edit against a newer bound", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() =>
    window.__watchEditor.serverOnlyUpdate({
      priceAboveUsd: 20,
      priceBelowUsd: 12,
    }),
  );
  await page
    .getByRole("textbox", { name: "Alert above, USD", exact: true })
    .fill("11");
  await save(page);
  expect((await calls(page))[0].args).toEqual({
    mint,
    enabled: true,
    priceAboveUsd: 11,
  });
  await expect(
    page.getByText(/Your existing settings are unchanged/),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Alert above, USD", exact: true }),
  ).toHaveValue("11");
});

test("precision is preserved when existing thresholds are kept", async ({
  page,
}) => {
  await harness(page, "precision");
  await expect(
    page.getByText(
      /Saved thresholds: above \$0\.1234567890123456, below \$0\.0000000123456789/,
    ),
  ).toBeVisible();
  await save(page);
  expect((await calls(page))[0].args).toEqual({
    mint,
    enabled: true,
  });
  await expect(
    page.getByText(
      /Saved thresholds: above \$0\.1234567890123456, below \$0\.0000000123456789/,
    ),
  ).toBeVisible();
});

test("invalid thresholds have associated errors, focus the bad field, and cannot save", async ({
  page,
}) => {
  await harness(page);
  const above = page.getByRole("textbox", {
    name: "Alert above, USD",
    exact: true,
  });
  const below = page.getByRole("textbox", {
    name: "Alert below, USD",
    exact: true,
  });
  for (const value of ["0", "-1", "Infinity", "not a price", "4"]) {
    await above.fill(value);
    await save(page);
    await expect(above).toHaveAttribute("aria-invalid", "true");
    await expect(above).toBeFocused();
    const description = await above.getAttribute("aria-describedby");
    expect(description).toContain("above-error");
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await calls(page)).toEqual([]);
  }
  await above.fill("20");
  await below.fill("-1");
  await save(page);
  await expect(below).toHaveAttribute("aria-invalid", "true");
  await expect(below).toBeFocused();
  expect(await calls(page)).toEqual([]);
});

test("failed Save retains the saved thresholds and staged clear for deliberate retry", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() => {
    window.__watchEditor.mode = "reject";
  });
  await page.getByRole("button", { name: "Clear above", exact: true }).click();
  await save(page);
  await expect(
    page.getByText(/Your existing settings are unchanged/),
  ).toBeVisible();
  await expect(
    page.getByText("Saved thresholds: above $10.00, below $5.00."),
  ).toBeVisible();
  await expect(
    page.getByText("Above threshold will be cleared when you save."),
  ).toBeVisible();
  await page.evaluate(() => {
    window.__watchEditor.mode = "success";
  });
  await save(page);
  expect((await calls(page)).map((call) => call.args)).toEqual(
    Array(2).fill({
      mint,
      enabled: true,
      priceAboveUsd: null,
    }),
  );
});

test("acknowledgement progress is separate from Save and failed acknowledgements keep exact-mint View", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() => {
    window.__watchEditor.mode = "defer";
  });
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Marking read…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Update watch", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => window.__watchEditor.settle(false));
  await expect(
    page.getByText("This alert could not be marked read. Try later."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /View token for alert, mint/ })
    .click();
  expect(await page.evaluate(() => window.__watchEditor.selected)).toEqual([
    {
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      symbol: "SAME",
      name: "Alerted Solana token",
    },
  ]);
  expect(await calls(page)).toEqual([
    { name: "forumTerminal:acknowledgeAlert", args: { id: "fixture-alert" } },
  ]);
});

test("rapid form submissions admit only one Save and disable draft edits while pending", async ({
  page,
}) => {
  await harness(page);
  await page.evaluate(() => {
    window.__watchEditor.mode = "defer";
    const form = document.querySelector("form")!;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Alert above, USD", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Clear below", exact: true }),
  ).toBeDisabled();
  expect(await calls(page)).toHaveLength(1);
  await page.evaluate(() => window.__watchEditor.settle(true));
  await expect(
    page.getByRole("button", { name: "Update watch", exact: true }),
  ).toBeEnabled();
});

test("keyboard-only threshold clearing reaches Save without submitting on clear", async ({
  page,
}) => {
  await harness(page);
  await page
    .getByRole("textbox", { name: "Alert above, USD", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Clear above", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await calls(page)).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("textbox", { name: "Alert below, USD", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Clear below", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Update watch", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Saved thresholds: above not set, below $5.00."),
  ).toBeVisible();
  expect(await calls(page)).toEqual([
    {
      name: "forumTerminal:setWatchlist",
      args: { mint, enabled: true, priceAboveUsd: null },
    },
  ]);
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
])
  test(`staged threshold controls remain readable at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await harness(page, "precision");
    const clear = page.getByRole("button", {
      name: "Clear above",
      exact: true,
    });
    await clear.scrollIntoViewIfNeeded();
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await clear.click();
    await expect(
      page.getByText("Above threshold will be cleared when you save."),
    ).toBeVisible();
    const submit = page.getByRole("button", {
      name: "Update watch",
      exact: true,
    });
    await submit.scrollIntoViewIfNeeded();
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await calls(page)).toEqual([]);
    await page.screenshot({
      path: test
        .info()
        .outputPath(`fixture-watchlist-draft-${viewport.width}.png`),
    });
    await submit.click();
    expect((await calls(page))[0].args).toEqual({
      mint,
      enabled: true,
      priceAboveUsd: null,
    });
  });
