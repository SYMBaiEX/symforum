import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const mint = "So11111111111111111111111111111111111111112",
  selected = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  origin = "http://127.0.0.1:43240";
let script: string;
const css: Record<string, string> = {};
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
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
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/community-scope-guidance.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"scope-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^next\\/link$|commerce-wallet$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/community-scope-guidance-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));for(const f of r.outputs){if(f.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await f.text())+"}));");else process.stdout.write(await f.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  path = `/community?mint=${mint}`,
  app = "platform",
) {
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin === origin) {
      if (["/community", "/forum/community", "/trade"].includes(u.pathname))
        return route.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (u.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
    }
    unexpected.push(u.href);
    return route.abort();
  });
  await page.goto(origin + path);
  return async () => {
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { scopeActions: unknown[] }).scopeActions,
      ),
    ).toEqual([]);
  };
}
const scope = (p: Page) =>
  p.getByRole("region", { name: "Community mint scope", exact: true });
const guide = (p: Page) =>
  p.getByRole("navigation", { name: "Community task guide", exact: true });
const reads = (p: Page) =>
  p.evaluate(
    () =>
      (window as unknown as { scopeReads: { name: string; args: unknown }[] })
        .scopeReads,
  );
for (const pathname of ["/community", "/forum/community"])
  test(`${pathname} exact-mint scope has an explicit all-community recovery that preserves section`, async ({
    page,
  }) => {
    const check = await harness(page, `${pathname}?mint=${mint}&section=work`);
    await expect(scope(page)).toContainText(mint);
    const recovery = scope(page).getByRole("link", {
      name: "Browse full community",
      exact: true,
    });
    const href = await recovery.getAttribute("href");
    const parsed = new URL(href!, origin);
    // Existing ForumLink canonicalizes the legacy platform /forum alias.
    expect(parsed.pathname).toBe("/community");
    expect(parsed.searchParams.get("section")).toBe("work");
    expect(parsed.searchParams.has("mint")).toBe(false);
    expect(
      (await reads(page)).filter(
        (r) => r.name === "forumCommunity:listBounties",
      ),
    ).toEqual([
      { name: "forumCommunity:listBounties", args: { mint, status: "open" } },
    ]);
    await recovery.click();
    await expect(
      page
        .getByRole("navigation", { name: "Community utilities", exact: true })
        .getByRole("button", { name: "Bounties & research", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(scope(page)).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("section")).toBe("work");
    await check();
  });
for (const withUrlMint of [false, true])
  test(`compact scope follows the selected prop, and guidance preserves ${withUrlMint ? "URL mint" : "absent URL mint"} and mounted protected receipts`, async ({
    page,
  }) => {
    const check = await harness(
      page,
      `/trade?${withUrlMint ? `mint=${mint}&` : ""}section=receipts`,
    );
    await expect(
      page.getByText("Protected outcome", { exact: true }),
    ).toBeVisible();
    const held = await page
      .getByText("Protected outcome", { exact: true })
      .elementHandle();
    await page.getByText("Find your next step", { exact: true }).click();
    await guide(page)
      .getByRole("link", { name: /Find project builders/ })
      .click();
    await expect(scope(page)).toContainText(selected);
    await expect(scope(page)).not.toContainText(mint);
    await expect(scope(page)).toContainText("terminal’s selected token");
    expect(new URL(page.url()).searchParams.get("mint")).toBe(
      withUrlMint ? mint : null,
    );
    const recovery = scope(page).getByRole("link", {
      name: "Open full community",
      exact: true,
    });
    expect(
      new URL((await recovery.getAttribute("href"))!, origin).searchParams.has(
        "mint",
      ),
    ).toBe(false);
    await guide(page)
      .getByRole("link", { name: /Commission useful work/ })
      .click();
    await expect(
      page.getByText("A pledge, not escrow.", { exact: true }),
    ).toBeVisible();
    await expect(scope(page)).toContainText(selected);
    await guide(page)
      .getByRole("link", { name: /Support a contributor/ })
      .click();
    await expect(scope(page)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Support a contributor", exact: true }),
    ).toBeVisible();
    expect(await held?.evaluate((node) => node.isConnected)).toBe(true);
    expect(
      (await reads(page)).filter(
        (r) => r.name === "forumCommunity:listPayments",
      ),
    ).toHaveLength(1);
    expect(
      await page.evaluate(
        () => (window as unknown as { scopeLifecycle: unknown }).scopeLifecycle,
      ),
    ).toEqual({ mounts: 1, unmounts: 0 });
    await check();
  });
test("opening task guidance adds no subscriptions, and guest receipts retain sign-in scope", async ({
  page,
}) => {
  const check = await harness(page, `/community?mint=${mint}&guest`);
  const before = await reads(page);
  await page.getByText("Find your next step", { exact: true }).click();
  await expect(guide(page).getByRole("link")).toHaveCount(3);
  expect(await reads(page)).toEqual(before);
  await guide(page)
    .getByRole("link", { name: /Support a contributor/ })
    .click();
  await page
    .getByRole("navigation", { name: "Community utilities", exact: true })
    .getByRole("button", { name: "Your receipts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Sign in to view your receipts",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await reads(page)).some((r) => r.name === "forumCommunity:listPayments"),
  ).toBe(false);
  await check();
});
test("native host keeps its existing scoped first-party handoff without mounting wallet or queries", async ({
  page,
}) => {
  const check = await harness(
    page,
    `/community?mint=${mint}&section=work&native`,
  );
  const link = page.getByRole("link", { name: "Open community", exact: true });
  await expect(link).toBeVisible();
  const url = new URL((await link.getAttribute("href"))!);
  expect(url.protocol).toBe("https:");
  expect(url.searchParams.get("mint")).toBe(mint);
  expect(url.searchParams.get("section")).toBe("work");
  expect(await reads(page)).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as { scopeLifecycle: unknown }).scopeLifecycle,
    ),
  ).toEqual({ mounts: 0, unmounts: 0 });
  await check();
});
for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    for (const compact of [false, true])
      test(`${app} ${compact ? "compact" : "standalone"} scope and guidance fit ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 });
        const check = await harness(
          page,
          `/${compact ? "trade" : "community"}?mint=${mint}`,
          app,
        );
        await expect(scope(page)).toContainText(compact ? selected : mint);
        const summary = page.getByText("Find your next step", { exact: true });
        await summary.focus();
        await page.keyboard.press("Enter");
        for (const control of [
          scope(page).getByRole("link"),
          ...(await guide(page).getByRole("link").all()),
        ]) {
          const box = await control.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        }
        for (const region of [scope(page), guide(page)]) {
          const box = await region.boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          expect(
            await region.evaluate((n) => n.scrollWidth <= n.clientWidth),
          ).toBe(true);
        }
        await page.keyboard.press("Tab");
        await expect(
          guide(page).getByRole("link", { name: /Find project builders/ }),
        ).toBeFocused();
        await check();
      });
