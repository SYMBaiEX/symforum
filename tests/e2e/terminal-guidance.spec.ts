import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

let script: string;
let css: string;
test.beforeAll(() => {
  css =
    readFileSync("styles/forum-shared.css", "utf8") +
    execFileSync(
      "bun",
      [
        "-e",
        `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/platform/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
  // Reuse the real terminal composition and its existing capability-only mocks.
  // The only admitted action is an inert quote; no signer or provider exists.
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/terminal.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"terminal-guidance-isolation",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/terminal-convex.ts"}));build.onResolve({filter:/^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/identity-navigation.ts"}));build.onResolve({filter:/^@\\/lib\\/commerce-wallet-client$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/terminal-wallet-client.ts"}));build.onResolve({filter:/commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/terminal-wallet.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});

async function harness(page: Page) {
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:43236") {
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (url.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
      if (url.pathname === "/images/brand/symforum-icon-64.png")
        return route.fulfill({
          contentType: "image/png",
          body: readFileSync("public/images/brand/symforum-icon-64.png"),
        });
      if (/^\/api\/token\/[^/]+\/chart$/.test(url.pathname))
        return route.fulfill({
          status: 503,
          json: { error: "Isolated chart unavailable" },
        });
    }
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto("http://127.0.0.1:43236/?orderquote");
  const order = page.getByRole("complementary", {
    name: "Trade selected token",
  });
  if (!(await order.isVisible()))
    await page
      .getByRole("navigation", { name: "Terminal dock" })
      .getByRole("button", { name: "Trade", exact: true })
      .click();
  await expect(
    order.getByRole("textbox", { name: "You pay", exact: true }),
  ).toBeVisible();
  return {
    order,
    check: async () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
      expect(
        await page.evaluate(() =>
          (
            window as unknown as { __terminalFixtureCalls: string[] }
          ).__terminalFixtureCalls.every((name) =>
            [
              "action:forumSwaps:quote",
              "action:forumCommerce:resolveMint",
              "action:forumTerminal:getWalletReadState",
            ].includes(name),
          ),
        ),
      ).toBe(true);
    },
  };
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`terminal guidance is disclosed without breaking the order layout at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const { order, check } = await harness(page);
    const amount = order.getByRole("textbox", { name: "You pay", exact: true });
    const compatibility = order.getByText("Wallet compatibility", {
      exact: true,
    });
    await expect(amount).toHaveAccessibleDescription(
      /at most 9 decimal places.*never rounded/,
    );
    await expect(
      order.getByRole("combobox", { name: "Slippage limit", exact: true }),
    ).toHaveAccessibleDescription(/default is 0.5%.*fresh quote/);
    await expect(
      order.getByText(/Extra decimals are rejected, never rounded/),
    ).toBeHidden();
    await amount.fill("0.1234567891");
    await amount.blur();
    const error = order.getByRole("alert");
    await expect(error).toHaveText(
      "This token supports at most 9 decimal places.",
    );
    const errorLayout = await error.evaluate((node) => {
      const parent = node.parentElement!;
      return {
        width: node.getBoundingClientRect().width,
        parent: parent.clientWidth,
        scroll: node.scrollWidth,
        available: node.clientWidth,
      };
    });
    expect(errorLayout.width).toBeGreaterThan(errorLayout.parent * 0.8);
    expect(errorLayout.scroll).toBeLessThanOrEqual(errorLayout.available);
    await amount.fill("1");
    await expect(
      order.getByText("Minimum received", { exact: true }),
    ).toBeVisible();
    await expect(
      order.getByText(
        "0.5% integrator fee (Jupiter share included) · collected in SYMF",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      order.locator("dd[aria-describedby]"),
    ).toHaveAccessibleDescription(
      /included in the quote.*full cost is not known here/,
    );
    if (viewport.width > 840) {
      const slippage = await order
        .getByRole("combobox", { name: "Slippage limit", exact: true })
        .boundingBox();
      const summary = await compatibility.boundingBox();
      expect(Math.abs(slippage!.y - summary!.y)).toBeLessThanOrEqual(8);
    }
    await compatibility.click();
    for (const text of [
      order.getByText(/Extra decimals are rejected, never rounded/),
      order.getByText(/Slippage limits how much less/),
      order.getByText(/their full cost is not known here/),
    ]) {
      await text.scrollIntoViewIfNeeded();
      await expect(text).toBeVisible();
      expect(
        await text.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await check();
  });
}
