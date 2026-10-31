import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  mintB = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1V";
const wallet = "11111111111111111111111111111111",
  program = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const token = (mint: string, name = "Duplicate fixture token") => ({
  mint,
  symbol: "DUP",
  name,
  decimals: 6,
  tokenProgram: program,
  icon: null,
  verified: false,
});
type PickerFixture = {
  calls: { name: string; args: Record<string, unknown> }[];
  selected: { mint: string }[];
  forbidden: string[];
  settle(index: number, success: boolean, value?: unknown): void;
};
declare global {
  interface Window {
    __pickerIdentity: PickerFixture;
  }
}
const origin = "http://127.0.0.1:43229";
const styles = {} as Record<"platform" | "forum", string>;
let script: string;
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
const state = (page: Page) => page.evaluate(() => window.__pickerIdentity);
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Select a token", exact: true });
const search = (page: Page) =>
  dialog(page).getByRole("textbox", { name: "Search tokens", exact: true });
const row = (page: Page, mint: string) =>
  dialog(page)
    .locator(".swap-token-row")
    .filter({ has: page.locator(`code[title="${mint}"]`) });
const inspector = (page: Page, mint: string) =>
  dialog(page).getByLabel(`Inspect mint ${mint}`, { exact: true });
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/token-picker-identity.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"picker-identity-only",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/token-picker-identity-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  guest = false,
  css: "platform" | "forum" = "platform",
  skipAnimationWait = false,
  longMetadata = false,
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles[css]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    audit.outbound.push(url.href);
    return route.abort();
  });
  await page.goto(
    `${origin}/?${guest ? "guest" : ""}${longMetadata ? "&long" : ""}`,
  );
  await page
    .getByRole("button", { name: "Choose fixture token", exact: true })
    .click();
  await expect(dialog(page)).toBeVisible();
  if (!skipAnimationWait)
    await dialog(page).evaluate((node) =>
      Promise.all(
        node
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
}
test.afterEach(async ({ page }) => {
  const audit = audits.get(page);
  if (audit) {
    expect(audit.errors).toEqual([]);
    expect(audit.outbound).toEqual([]);
  }
  const fixture = await state(page);
  expect(fixture.forbidden).toEqual([]);
  for (const call of fixture.calls) {
    expect([
      "forumTokenDiscovery:search",
      "forumCommerce:resolveMint",
    ]).toContain(call.name);
    expect(call.args.wallet).toBe(wallet);
    expect(Object.keys(call.args).sort()).toEqual(
      call.name.endsWith(":search") ? ["search", "wallet"] : ["mint", "wallet"],
    );
  }
});
async function requested(page: Page, value: string) {
  await search(page).fill(value);
  await expect
    .poll(async () =>
      (await state(page)).calls.some(
        (call) =>
          call.name === "forumTokenDiscovery:search" &&
          call.args.search === value.trim(),
      ),
    )
    .toBe(true);
  return (await state(page)).calls.findIndex(
    (call) =>
      call.name === "forumTokenDiscovery:search" &&
      call.args.search === value.trim(),
  );
}
async function settle(
  page: Page,
  index: number,
  success: boolean,
  value?: unknown,
) {
  await page.evaluate(
    async ({ index, success, value }) => {
      window.__pickerIdentity.settle(index, success, value);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    },
    { index, success, value },
  );
}
for (const oldSuccess of [true, false])
  test(`reverse-order search ${oldSuccess ? "success" : "error"} cannot replace current results or errors`, async ({
    page,
  }) => {
    await harness(page);
    const old = await requested(page, "alpha");
    const current = await requested(page, "beta");
    await settle(page, current, true, [token(mintB, "beta current token")]);
    await expect(row(page, mintB)).toBeVisible();
    await settle(page, old, oldSuccess, [token(mintA, "alpha old token")]);
    await expect(row(page, mintB)).toBeVisible();
    await expect(row(page, mintA)).toHaveCount(0);
    await expect(dialog(page).getByRole("alert")).toHaveCount(0);
    expect((await state(page)).selected).toEqual([]);
  });
for (const success of [true, false])
  test(`late search ${success ? "success" : "error"} after close cannot reopen, leak or select on next open`, async ({
    page,
  }) => {
    await harness(page);
    const pending = await requested(page, "alpha");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await settle(page, pending, success, [token(mintA, "alpha old token")]);
    await expect(dialog(page)).toBeHidden();
    expect((await state(page)).selected).toEqual([]);
    await page
      .getByRole("button", { name: "Choose fixture token", exact: true })
      .click();
    await expect(dialog(page)).toBeVisible();
    await expect(row(page, mintA)).toHaveCount(0);
    await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  });
test("an older matching response cannot repopulate a current failed search", async ({
  page,
}) => {
  await harness(page);
  const old = await requested(page, "du"),
    current = await requested(page, "dup");
  await settle(page, current, false);
  await expect(dialog(page).getByRole("alert")).toContainText(
    "Live search unavailable.",
  );
  await settle(page, old, true, [token(mintA)]);
  await expect(row(page, mintA)).toHaveCount(0);
  await expect(dialog(page).getByRole("alert")).toContainText(
    "Live search unavailable.",
  );
  expect((await state(page)).selected).toEqual([]);
});
for (const success of [true, false])
  test(`discovered candidate ${success ? "success" : "denial"} cannot select before exact mint resolution`, async ({
    page,
  }) => {
    await harness(page);
    const query = await requested(page, "dup");
    await settle(page, query, true, [token(mintA), token(mintB)]);
    expect((await state(page)).selected).toEqual([]);
    expect(
      (await state(page)).calls.some(
        (call) => call.name === "forumCommerce:resolveMint",
      ),
    ).toBe(false);
    await row(page, mintB).click();
    const calls = (await state(page)).calls;
    const resolve = calls.findIndex(
      (call) => call.name === "forumCommerce:resolveMint",
    );
    expect(calls[resolve].args).toEqual({ wallet, mint: mintB });
    expect((await state(page)).selected).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();
    await settle(page, resolve, success, token(mintB));
    if (success) {
      expect((await state(page)).selected).toMatchObject([{ mint: mintB }]);
      await expect(dialog(page)).toBeHidden();
    } else {
      expect((await state(page)).selected).toEqual([]);
      await expect(dialog(page).getByRole("alert")).toContainText(
        "This mint could not be verified. No wallet request was made.",
      );
      await expect(
        page.getByText("PRIVATE_PROVIDER_FIXTURE_ERROR"),
      ).toHaveCount(0);
    }
  });
test("the existing 650ms debounce and short-query admission are unchanged", async ({
  page,
}) => {
  const start = new Date("2026-10-31T12:00:00Z");
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
  await harness(page, false, "platform", true);
  await page.clock.runFor(250);
  await search(page).fill("a");
  await page.clock.runFor(1000);
  expect((await state(page)).calls).toEqual([]);
  await search(page).fill(" du ");
  await page.clock.runFor(649);
  expect((await state(page)).calls).toEqual([]);
  await page.clock.runFor(1);
  expect((await state(page)).calls).toEqual([
    { name: "forumTokenDiscovery:search", args: { wallet, search: "du" } },
  ]);
});
test("exact-match labels require the full valid original-case address and inspection never selects", async ({
  page,
}) => {
  await harness(page, true);
  await expect(inspector(page, mintA)).toBeVisible();
  for (const mint of [mintA, mintB]) {
    await search(page).fill(mint);
    await expect(row(page, mint)).toBeVisible();
    await expect(
      dialog(page).getByText("Exact mint match · identity only", {
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(inspector(page, mint)).toHaveAccessibleName(
      `Inspect mint ${mint}`,
    );
  }
  await search(page).fill("DUP");
  await expect(
    dialog(page).getByText("Exact mint match · identity only", { exact: true }),
  ).toHaveCount(0);
  await search(page).fill("1".repeat(33));
  await expect(
    dialog(page).getByText("Exact mint match · identity only", { exact: true }),
  ).toHaveCount(0);
  await search(page).fill("DUP");
  await inspector(page, mintB).focus();
  await page.keyboard.press("Enter");
  await expect(inspector(page, mintB).locator("..").locator("code")).toHaveText(
    mintB,
  );
  await expect(
    inspector(page, mintB)
      .locator("..")
      .getByText(/Names and symbols are untrusted metadata/),
  ).toBeVisible();
  expect((await state(page)).selected).toEqual([]);
  expect((await state(page)).calls).toEqual([]);
});
async function bounds(
  page: Page,
  target: Locator,
  label: string,
  vertical = true,
) {
  const box = await target.boundingBox();
  expect(box, `${label} rendered`).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x, label).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, label).toBeLessThanOrEqual(viewport.width);
  if (vertical) {
    expect(box!.y, label).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, label).toBeLessThanOrEqual(viewport.height);
  }
}
test.describe("touch mint inspection", () => {
  test.use({ hasTouch: true });
  for (const css of ["platform", "forum"] as const)
    test(`${css} touch inspection reveals only exact identity without selecting`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await harness(page, true, css, false, true);
      await inspector(page, mintB).tap();
      const code = inspector(page, mintB).locator("..").locator("code");
      await expect(code).toHaveText(mintB);
      await code.scrollIntoViewIfNeeded();
      await bounds(page, code, "Touch-inspected mint");
      await code.tap();
      expect((await state(page)).selected).toEqual([]);
      expect((await state(page)).calls).toEqual([]);
    });
});
for (const [css, width] of [
  ["platform", 320],
  ["platform", 390],
  ["forum", 320],
  ["forum", 390],
] as const)
  test(`${css} ${width}px real dialog and separate mint inspection fit without clipped identity`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    await harness(page, true, css, false, true);
    await expect(dialog(page)).toHaveAttribute("data-surface", "forum");
    await bounds(page, dialog(page), "Dialog");
    expect(
      await dialog(page).evaluate(
        (node) => node.scrollHeight <= node.clientHeight,
      ),
    ).toBe(true);
    await bounds(page, search(page), "Search input");
    await bounds(
      page,
      dialog(page).getByRole("button", { name: "Close", exact: true }),
      "Dialog close",
    );
    await bounds(page, row(page, mintA), "Selection row");
    const rowHeight = await row(page, mintA).boundingBox(),
      groupHeight = await row(page, mintA).locator("..").boundingBox();
    expect(groupHeight!.height).toBe(rowHeight!.height);
    expect(
      await row(page, mintA).evaluate(
        (node) => node.scrollWidth <= node.clientWidth,
      ),
    ).toBe(true);
    for (const quick of await dialog(page)
      .locator(".swap-token-quick button")
      .all())
      await bounds(page, quick, "Quick token");
    const inspect = inspector(page, mintA);
    await expect(inspect).toBeVisible();
    await bounds(page, inspect, "Mint inspector");
    expect((await inspect.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await inspect.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const selectBox = await row(page, mintA).boundingBox(),
      inspectBox = await inspect.boundingBox();
    expect(selectBox!.x + selectBox!.width).toBeLessThanOrEqual(inspectBox!.x);
    await inspect.focus();
    await page.keyboard.press("Enter");
    const code = inspect.locator("..").locator("code");
    await code.scrollIntoViewIfNeeded();
    await expect(code).toHaveText(mintA);
    await bounds(page, code, "Full mint");
    expect(
      await code.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await dialog(page).evaluate(
        (node) => node.scrollWidth <= node.clientWidth,
      ),
    ).toBe(true);
    expect(await dialog(page).evaluate((node) => node.scrollTop)).toBe(0);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Choose fixture token", exact: true }),
    ).toBeFocused();
    expect((await state(page)).calls).toEqual([]);
    expect((await state(page)).selected).toEqual([]);
  });
