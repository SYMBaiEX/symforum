import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
let script: string;
let css: string;
const selectedMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
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
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/community-navigation-terminal.tsx"],target:"browser",format:"iife",define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"actual-terminal-navigation",setup(build){build.onResolve({filter:/^convex\\/react$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/community-navigation-terminal-convex.ts"}));build.onResolve({filter:/^next\\/navigation$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/community-navigation-mocks.tsx"}));build.onResolve({filter:/commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/terminal-wallet.tsx"}));build.onResolve({filter:/^@\\/lib\\/commerce-wallet-client$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/terminal-wallet-client.ts"}));build.onResolve({filter:/token-swap$|research-purchase$|wallet-panel$/},(args)=>args.importer.endsWith("community-navigation-terminal-probes.tsx")?undefined:({path:process.cwd()+"/tests/e2e/fixtures/community-navigation-terminal-probes.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
});
async function mounts(page: Page) {
  return page.evaluate(() => ({
    ...(
      window as unknown as { communityTerminalMounts: Record<string, number> }
    ).communityTerminalMounts,
  }));
}
for (const initial of [undefined, "11111111111111111111111111111111"])
  test(`actual TerminalPage keeps local token selection and mounted controllers while changing sections (${initial ? "URL mint" : "no URL mint"})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors: string[] = [],
      unexpected: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "http://127.0.0.1:43227" && url.pathname === "/trade")
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (
        url.origin === "http://127.0.0.1:43227" &&
        url.pathname === "/fixture.js"
      )
        return route.fulfill({ contentType: "text/javascript", body: script });
      if (
        url.origin === "http://127.0.0.1:43227" &&
        /^\/api\/token\/[^/]+\/chart$/.test(url.pathname)
      )
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fixture chart unavailable" }),
        });
      if (
        url.origin === "http://127.0.0.1:43227" &&
        url.pathname === "/images/brand/symforum-icon-64.png"
      )
        return route.fulfill({
          contentType: "image/png",
          body: readFileSync("public/images/brand/symforum-icon-64.png"),
        });
      unexpected.push(url.pathname);
      return route.abort();
    });
    await page.goto(
      `http://127.0.0.1:43227/trade?orderinput&held${initial ? `&mint=${initial}` : ""}`,
    );
    await page.getByRole("tab", { name: "Markets", exact: true }).click();
    await page.getByRole("button", { name: /^View NOVA,/ }).click();
    await expect(
      page.getByRole("heading", { name: "$NOVA", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { communityTerminalMints: string[] }
          ).communityTerminalMints.at(-1),
        ),
      )
      .toBe(selectedMint);
    await expect
      .poll(async () => {
        const x = await mounts(page);
        return (
          Object.values(x).length === 3 && Object.values(x).every((n) => n > 0)
        );
      })
      .toBe(true);
    const before = await mounts(page);
    await expect(
      page.locator('#terminal-account [data-held="true"]'),
    ).toHaveCount(1);
    await page
      .getByRole("navigation", { name: "Terminal dock", exact: true })
      .getByRole("button", { name: "Community", exact: true })
      .click();
    const nav = page.getByRole("navigation", {
      name: "Community utilities",
      exact: true,
    });
    await nav
      .getByRole("button", { name: "Bounties & research", exact: true })
      .click();
    expect(new URL(page.url()).searchParams.getAll("mint")).toEqual(
      initial ? [initial] : [],
    );
    expect(new URL(page.url()).searchParams.has("held")).toBe(true);
    expect(new URL(page.url()).searchParams.has("orderinput")).toBe(true);
    expect(new URL(page.url()).searchParams.get("section")).toBe("work");
    await nav
      .getByRole("button", { name: "Your receipts", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Your community payments",
        exact: true,
      }),
    ).toBeVisible();
    expect(await mounts(page)).toEqual(before);
    await expect(
      page.locator('#terminal-account [data-held="true"]'),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { communityTerminalMints: string[] }
          ).communityTerminalMints.at(-1),
        ),
      )
      .toBe(selectedMint);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
    const actions = await page.evaluate(
      () =>
        (window as unknown as { __terminalFixtureCalls: string[] })
          .__terminalFixtureCalls,
    );
    expect(
      actions.filter((name) =>
        /prepare|submit|verify|markPayment|:pay|:check/.test(name),
      ),
    ).toEqual([]);
  });
