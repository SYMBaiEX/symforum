import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
let script: string;
const css = {} as Record<"platform" | "forum", string>;
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
type FixtureState = {
  reads: string[];
  routes: string[];
  forbidden: string[];
  nativeRoute: string;
};
declare global {
  interface Window {
    __signinContext: FixtureState;
  }
}
const state = (page: Page) => page.evaluate(() => window.__signinContext);
test.beforeAll(() => {
  for (const variant of ["platform", "forum"] as const) {
    css[variant] =
      FORUM_SHARED_THEME_CSS +
      readFileSync("styles/forum-shared.css", "utf8") +
      execFileSync(
        "bun",
        [
          "-e",
          `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
        ],
        {
          cwd: `apps/${variant}`,
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
        },
      );
  }
  script = execFileSync(
    "bun",
    [
      "-e",
      `const result=await Bun.build({entrypoints:["tests/e2e/fixtures/signin-context.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_CONVEX_URL:"https://fixture.invalid",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"signin-local-only",setup(build){build.onResolve({filter:/^convex-helpers\\/react\\/cache\\/hooks$|^next\\/(navigation|link|image)$|^next-themes$|^\\.\\/host$/},args=>args.path==="./host"&&!args.importer.endsWith("/plugin-adapter/router.tsx")?undefined:({path:process.cwd()+"/tests/e2e/fixtures/signin-context-state.tsx"}));}}]});if(!result.success)throw new Error(result.logs.join("\\n"));for(const file of result.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  path: string,
  variant: "platform" | "forum" = "platform",
  origin = "http://127.0.0.1:43252",
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (error) => audit.errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (
      url.origin === origin &&
      route.request().resourceType() === "document" &&
      url.pathname !== "/signin"
    )
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[variant]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    audit.outbound.push(url.href);
    return route.abort();
  });
  await page.goto(origin + path);
  await expect(
    page.getByRole("button", { name: "Forum menu", exact: true }),
  ).toBeVisible();
}
test.afterEach(async ({ page }) => {
  expect(audits.get(page)?.errors).toEqual([]);
  expect(audits.get(page)?.outbound).toEqual([]);
  const fixture = await state(page);
  expect(fixture.forbidden).toEqual([]);
  expect(fixture.reads.sort()).toEqual([
    "forum:getMyForumNavState",
    "forum:overview",
  ]);
});
const returnTo = async (link: Locator) =>
  new URL(
    (await link.getAttribute("href"))!,
    "https://fixture.invalid",
  ).searchParams.get("redirectTo");
async function menuSignIn(page: Page) {
  await page.getByRole("button", { name: "Forum menu", exact: true }).click();
  return page.getByRole("menuitem", {
    name: "Sign in to participate",
    exact: true,
  });
}
test("topbar preserves feed context and captures current anchor before keyboard activation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await harness(
    page,
    "/forum?view=feed&scope=following&authors=humans&sort=new#post-12",
  );
  const link = page.getByRole("link", { name: "Sign in", exact: true });
  await link.focus();
  await expect
    .poll(() => returnTo(link))
    .toBe("/forum?view=feed&scope=following&authors=humans&sort=new#post-12");
  await page.keyboard.press("Enter");
  expect((await state(page)).routes).toEqual([await link.getAttribute("href")]);
});
test("same-route query changes and subsequent hash changes are not stale", async ({
  page,
}) => {
  await harness(page, "/forum?view=feed&authors=agents#post-1");
  const link = await menuSignIn(page);
  await link.focus();
  await expect
    .poll(() => returnTo(link))
    .toBe("/forum?view=feed&authors=agents#post-1");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    history.replaceState(
      null,
      "",
      "/forum?view=community&scope=discover#post-2",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const next = await menuSignIn(page);
  await next.focus();
  await expect
    .poll(() => returnTo(next))
    .toBe("/forum?view=community&scope=discover#post-2");
});
test("search paging survives while auth, secrets and nested return arguments do not", async ({
  page,
}) => {
  await harness(
    page,
    "/search?q=hello+world&author=Alice&sort=new&page=3&size=24&token=secret&redirectTo=//evil.test&code=secret&state=secret#post-21",
  );
  const link = await menuSignIn(page);
  await link.focus();
  await expect
    .poll(() => returnTo(link))
    .toBe("/search?q=hello+world&author=Alice&sort=new&page=3&size=24#post-21");
  await page.keyboard.press("Enter");
  expect((await state(page)).routes).toHaveLength(1);
  expect((await state(page)).routes[0]).not.toContain("secret");
});
test("exact mint and native route context remain local, never the host document URL", async ({
  page,
}) => {
  await harness(
    page,
    "/forum/trade?mint=So11111111111111111111111111111111111111112&fixtureNative=1#host-secret=ignored",
  );
  const link = await menuSignIn(page);
  await link.focus();
  await expect
    .poll(() => returnTo(link))
    .toBe(
      "/forum/trade?mint=So11111111111111111111111111111111111111112#post-native",
    );
  await page.keyboard.press("Enter");
  expect((await state(page)).routes[0]).toMatch(/^\/signin\?/);
  expect((await state(page)).nativeRoute).toBe((await state(page)).routes[0]);
});

for (const [origin, path] of [
  ["https://www.symbaiex.com", "/forum?view=feed&authors=humans#post-6"],
  ["https://forum.symbaiex.com", "/?view=feed&authors=humans#post-6"],
])
  test(`mocked ${origin}: pointer/modifier link context and rail agree`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await harness(page, path, "platform", origin);
    const header = page.getByRole("link", { name: "Sign in", exact: true });
    // All documents/scripts are fulfilled locally even on these hostnames.
    // Inspect the deliberate pointer event without navigating or authenticating.
    await header.dispatchEvent("pointerdown", { button: 1, metaKey: true });
    await expect.poll(() => returnTo(header)).toBe(path);
    const href = await header.getAttribute("href");
    expect(new URL(href!, page.url()).origin).toBe(origin);
    const rail = page.getByRole("link", {
      name: "Sign in to join in",
      exact: true,
    });
    await rail.focus();
    await expect.poll(() => rail.getAttribute("href")).toBe(href);
    expect((await state(page)).routes).toEqual([]);
  });
for (const variant of ["platform", "forum"] as const)
  for (const width of [320, 390]) {
    test(`${variant} ${width}: keyboard menu target fits and retains local forum-host context`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await harness(page, "/?view=community&authors=humans#post-3", variant);
      const trigger = page.getByRole("button", {
        name: "Forum menu",
        exact: true,
      });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const link = page.getByRole("menuitem", {
        name: "Sign in to participate",
        exact: true,
      });
      await link.focus();
      await expect(link).toBeFocused();
      await expect
        .poll(() => returnTo(link))
        .toBe("/?view=community&authors=humans#post-3");
      // Radix scales its entering menu: measure the settled target, without
      // removing animation or relaxing the 44px requirement.
      await expect
        .poll(async () => (await link.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);
      const menu = await page.getByRole("menu").boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      expect((await state(page)).routes).toEqual([]);
    });
  }
