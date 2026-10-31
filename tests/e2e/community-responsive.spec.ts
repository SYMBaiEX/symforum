import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
let script: string, css: string;
test.beforeAll(() => {
  css =
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
      "bun",
      [
        "-e",
        `import postcss from 'postcss';import tailwind from 'tailwindcss';import config from './tailwind.config.ts';const css=(await Bun.file('apps/platform/app/globals.css').text()).replace(/^@import.*$/m,'');process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:['tests/e2e/fixtures/community-responsive.tsx'],target:'browser',format:'iife',minify:true,define:{'process.env':JSON.stringify({NODE_ENV:'production',NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file('tests/fixtures/installation.symbaiex.json').text()})},plugins:[{name:'responsive-fixture-only',setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|commerce-wallet$|forum-link$/},()=>({path:process.cwd()+'/tests/e2e/fixtures/community-responsive-mocks.tsx'}));}}]});if(!result.success)throw new Error(JSON.stringify(result.logs));for(const file of result.outputs){if(file.path.endsWith('.css'))process.stdout.write(';document.head.appendChild(Object.assign(document.createElement("style"),{textContent:'+JSON.stringify(await file.text())+'}));');else if(file.path.endsWith('.js'))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});
async function harness(page: Page, theme: "light" | "dark", compact: boolean) {
  const unexpected: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43232" && url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<html class="${theme === "dark" ? "dark" : ""}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`,
      });
    if (
      url.origin === "http://127.0.0.1:43232" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43232/?${compact ? "compact" : ""}`);
  await expect(
    page.getByRole("navigation", { name: "Community utilities" }),
  ).toBeVisible();
  return async () => {
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(() => window.communityResponsiveFixture.forbidden),
    ).toEqual([]);
  };
}
async function noOverflow(page: Page) {
  const measure = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll("main *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1)
        );
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        text: element.textContent?.slice(0, 60),
        class: element.className,
      })),
  }));
  expect(measure.scroll, JSON.stringify(measure.offenders)).toBeLessThanOrEqual(
    measure.width + 1,
  );
}
async function select(page: Page, label: string) {
  const control = page
    .getByRole("navigation", { name: "Community utilities" })
    .getByRole("button", { name: label, exact: true });
  await control.focus();
  await page.keyboard.press("Enter");
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await expect(control).toBeFocused();
  const target = await control.getAttribute("aria-controls");
  await expect(
    page.getByRole("region", { name: label, exact: true }),
  ).toHaveAttribute("id", target!);
  const box = await control.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
}
async function exercise(page: Page, info: TestInfo) {
  const nav = page.getByRole("navigation", { name: "Community utilities" });
  await expect(nav.getByRole("button")).toHaveCount(4);
  for (const control of await nav.getByRole("button").all()) {
    await expect(control).toBeVisible();
    expect(
      await control.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
  }
  const navigationButtons = await nav.getByRole("button").all();
  await navigationButtons[0].focus();
  for (const control of navigationButtons.slice(1)) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("projects.png"),
    fullPage: true,
  });
  const add = page.getByRole("button", { name: "Add project", exact: true });
  await add.focus();
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog", {
    name: "Introduce your project",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Exact Solana mint")
    .fill("5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump");
  await dialog.getByLabel("Your role").fill("r".repeat(60));
  await dialog
    .getByLabel("What are you building?")
    .fill("A long, local-only draft. ".repeat(30));
  await expect(dialog.getByLabel("Your role")).toHaveValue("r".repeat(60));
  const rect = await dialog.boundingBox();
  expect(rect?.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await select(page, "Bounties & research");
  await noOverflow(page);
  await page.getByRole("button", { name: "Create brief", exact: true }).click();
  dialog = page.getByRole("dialog", {
    name: "Commission useful work",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Title", { exact: true }).fill("x".repeat(120));
  await dialog
    .getByLabel("Brief and acceptance criteria")
    .fill("This draft is deliberately long. ".repeat(80));
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await select(page, "Tips & profile");
  await expect(
    page.getByRole("combobox", { name: "Contributor", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await select(page, "Your receipts");
  await noOverflow(page);
  const receipt = page.getByRole("button", {
    name: "Check protected receipt",
    exact: true,
  });
  await receipt.focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog", {
    name: "Review one-time tip",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Protected uncertain outcome", { exact: true }),
  ).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await expect
    .poll(async () => {
      const box = await close.boundingBox();
      return box ? Math.min(box.height, box.width) : 0;
    })
    .toBeGreaterThanOrEqual(43.99);
  await page.screenshot({
    path: info.outputPath("protected-receipt.png"),
    fullPage: false,
  });
  await expect(
    dialog.getByRole("button", { name: "Open exact payment in wallet" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Verify saved payment", exact: true }),
  ).toBeDisabled();
  const signature = dialog.getByLabel("Transaction signature", { exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(signature).toBeFocused();
  await expect
    .poll(async () => {
      const inputBounds = await signature.boundingBox();
      const currentBounds = await dialog.boundingBox();
      return (
        !!inputBounds &&
        !!currentBounds &&
        inputBounds.y >= currentBounds.y &&
        inputBounds.y + inputBounds.height <=
          currentBounds.y + currentBounds.height + 1
      );
    })
    .toBe(true);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("protected-receipt-controls.png"),
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(receipt).toBeFocused();
}
for (const width of [320, 390, 768, 1440])
  for (const theme of ["light", "dark"] as const)
    for (const compact of [false, true]) {
      test(`community ${width}px ${theme} ${compact ? "compact" : "standalone"} stays readable without financial actions`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 720 });
        const check = await harness(page, theme, compact);
        await exercise(page, info);
        await check();
      });
    }
test.describe("200-percent zoom emulation (1440x900 device / 720x450 CSS viewport)", () => {
  test.use({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  test("reflow, short dialogs and keyboard receipt recovery retain their controls", async ({
    page,
  }, info) => {
    const check = await harness(page, "light", false);
    await exercise(page, info);
    await check();
  });
});
