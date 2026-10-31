import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  mintB = "EPjFWdd5aufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
let script: string, css: string;
test.beforeAll(() => {
  css =
    FORUM_SHARED_THEME_CSS +
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
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
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/community-identity-links.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"identity-link-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^next\\/link$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/community-identity-links-state.ts"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(page: Page, path = "/community") {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === "http://127.0.0.1:43235" &&
      ["/community", "/forum/community"].includes(url.pathname)
    )
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (
      url.origin === "http://127.0.0.1:43235" &&
      url.pathname === "/fixture.js"
    )
      return route.fulfill({ contentType: "text/javascript", body: script });
    external.push(url.href);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:43235${path}`);
  await expect(
    page
      .getByRole("heading", {
        name: /Project hubs|Community projects and rewards|Bounties and research requests/,
      })
      .first(),
  ).toBeVisible();
  return async () => {
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    expect(
      await page.evaluate(() => window.communityIdentity.operations),
    ).toEqual([]);
  };
}
const row = (page: Page, name = "Project one") =>
  page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: false }) });
const copies = (page: Page) =>
  page.evaluate(() => window.communityIdentity.copies);
const subscriptions = (page: Page) =>
  page.evaluate(() => window.communityIdentity.subscriptions);

for (const path of ["/community", "/forum/community"])
  test(`public handles use encoded host-aware profile paths (${path})`, async ({
    page,
  }) => {
    const check = await harness(page, path);
    const prefix = path.startsWith("/forum") ? "/forum" : "";
    await expect(
      page.getByRole("link", { name: "@Alice_Builder", exact: true }),
    ).toHaveAttribute("href", `${prefix}/members/Alice_Builder`);
    await expect(
      page.getByRole("link", { name: "@case/sensitive?name", exact: true }),
    ).toHaveAttribute("href", `${prefix}/members/case%2Fsensitive%3Fname`);
    expect(await copies(page)).toEqual([]);
    await check();
  });
test("identical tickers retain distinct exact case-sensitive mint copies and row feedback", async ({
  page,
}) => {
  const check = await harness(page);
  const before = await subscriptions(page);
  await row(page)
    .getByRole("button", { name: `Copy mint ${mintA}`, exact: true })
    .click();
  await expect(row(page).getByRole("status")).toHaveText("Exact mint copied.");
  await expect(row(page, "Project two").getByRole("status")).toHaveText("");
  await row(page, "Project two")
    .getByRole("button", { name: `Copy mint ${mintB}`, exact: true })
    .click();
  expect(await copies(page)).toEqual([mintA, mintB]);
  expect(await subscriptions(page)).toEqual(before);
  await check();
});

test("missing public handles remain labels instead of invented member destinations", async ({
  page,
}) => {
  const check = await harness(page);
  const before = await subscriptions(page);
  for (const name of ["Forum member", ""]) {
    await page.evaluate(
      (name) => window.communityIdentity.replaceFirstHandle(name),
      name,
    );
    await expect(
      row(page).getByRole("link", { name: /Forum member|Alice_Builder/ }),
    ).toHaveCount(0);
    await expect(
      row(page).getByText("Forum member", { exact: true }),
    ).toBeVisible();
  }
  expect(await subscriptions(page)).toEqual(before);
  await check();
});
for (const allowed of [true, false])
  test(`deferred copy completion cannot label a row's replacement mint (${allowed ? "success" : "denial"})`, async ({
    page,
  }) => {
    const check = await harness(page);
    await page.evaluate(() => window.communityIdentity.mode("deferred"));
    await row(page)
      .getByRole("button", { name: `Copy mint ${mintA}`, exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    expect(await copies(page)).toEqual([mintA]);
    await page.evaluate(
      (mint) => window.communityIdentity.replaceFirstMint(mint),
      mintB,
    );
    await expect(
      row(page).getByRole("button", {
        name: `Copy mint ${mintB}`,
        exact: true,
      }),
    ).toBeEnabled();
    await page.evaluate(
      (ok) => window.communityIdentity.settle(0, ok),
      allowed,
    );
    await expect(
      row(page).getByRole("button", {
        name: `Copy mint ${mintB}`,
        exact: true,
      }),
    ).toHaveText("Copy mint");
    await expect(row(page).getByRole("status")).toHaveText("");
    await expect(row(page).getByRole("textbox")).toHaveCount(0);
    await check();
  });
test("denied clipboard access offers exact read-only manual copying without automatic retry", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() => window.communityIdentity.mode("denied"));
  const copy = row(page).getByRole("button", {
    name: `Copy mint ${mintA}`,
    exact: true,
  });
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(row(page).getByRole("status")).toContainText(
    "Clipboard unavailable",
  );
  const manual = row(page).getByRole("textbox", {
    name: `Exact mint ${mintA} to copy manually`,
    exact: true,
  });
  await expect(manual).toHaveValue(mintA);
  await expect(manual).toHaveAttribute("readonly", "");
  await page.keyboard.press("Tab");
  await expect(manual).toBeFocused();
  expect(
    await manual.evaluate(
      (input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!,
    ),
  ).toBe(mintA.length);
  expect(await copies(page)).toEqual([mintA]);
  await check();
});

test("absent clipboard API falls back manually without claiming a copy", async ({
  page,
}) => {
  const check = await harness(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    }),
  );
  await row(page)
    .getByRole("button", { name: `Copy mint ${mintA}`, exact: true })
    .click();
  await expect(row(page).getByRole("status")).toContainText(
    "Clipboard unavailable",
  );
  await expect(row(page).getByRole("textbox")).toHaveValue(mintA);
  expect(await copies(page)).toEqual([]);
  await check();
});
test("work mint links use the configured terminal origin and exact mint, without actions", async ({
  page,
}) => {
  const check = await harness(page, "/community?section=work");
  await expect(
    page.getByRole("heading", { name: "Work one", exact: true }),
  ).toBeVisible();
  const before = await subscriptions(page);
  for (const [name, mint] of [
    ["Work one", mintA],
    ["Work two", mintB],
  ]) {
    const item = row(page, name);
    const link = new URL(
      (await item
        .getByRole("link", { name: "Open token market" })
        .getAttribute("href"))!,
    );
    expect(link.hostname).toBe("forum.symbaiex.com");
    expect(link.pathname).toBe("/trade");
    expect(link.searchParams.get("mint")).toBe(mint);
    await item
      .getByRole("button", { name: `Copy mint ${mint}`, exact: true })
      .click();
  }
  expect(await copies(page)).toEqual([mintA, mintB]);
  await expect(row(page, "Work without mint")).toBeVisible();
  await expect(
    row(page, "Work without mint").getByRole("link", {
      name: "Open token market",
    }),
  ).toHaveCount(0);
  await expect(
    row(page, "Work without mint").getByRole("button", { name: /Copy mint/ }),
  ).toHaveCount(0);
  expect(await subscriptions(page)).toEqual(before);
  await check();
});
for (const width of [320, 390])
  for (const compact of [true, false])
    test(`public identity controls fit keyboard targets at ${width}px (${compact ? "compact" : "standalone"})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const check = await harness(
        page,
        `/community?${compact ? "compact" : ""}`,
      );
      const before = await subscriptions(page);
      for (const control of [
        row(page).getByRole("link", { name: "@Alice_Builder", exact: true }),
        row(page).getByRole("button", {
          name: `Copy mint ${mintA}`,
          exact: true,
        }),
      ]) {
        await control.scrollIntoViewIfNeeded();
        await control.focus();
        await expect(control).toBeFocused();
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await page.keyboard.press("Enter");
      await expect(row(page).getByRole("status")).toHaveText(
        "Exact mint copied.",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await subscriptions(page)).toEqual(before);
      await check();
    });
test("native community handoff adds no identity controls, wallet or queries", async ({
  page,
}) => {
  const check = await harness(page, `/community?native&mint=${mintA}`);
  await expect(
    page.getByRole("link", { name: "Open community" }),
  ).toBeVisible();
  const href = new URL(
    (await page
      .getByRole("link", { name: "Open community" })
      .getAttribute("href"))!,
  );
  expect(href.origin).toBe("https://forum.symbaiex.com");
  expect(href.pathname).toBe("/community");
  expect(href.searchParams.get("mint")).toBe(mintA);
  await expect(page.getByRole("button", { name: /Copy mint/ })).toHaveCount(0);
  expect(await subscriptions(page)).toEqual([]);
  expect(await copies(page)).toEqual([]);
  await check();
});
