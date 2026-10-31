import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43242";
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
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/feed-onboarding.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"feed-onboarding-isolation",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^next\\/link$|forum-primitives$|forum-feed-starter$|forum-media-gallery$|app-error-surface$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/feed-onboarding-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));process.stdout.write(await r.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  query = "scope=following",
  app = "platform",
  path = "/forum",
) {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin === origin) {
      if (u.pathname === path)
        return r.fulfill({
          contentType: "text/html",
          body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (u.pathname === "/fixture.js")
        return r.fulfill({ contentType: "text/javascript", body: script });
    }
    requests.push(u.href);
    return r.abort();
  });
  await page.goto(`${origin}${path}?${query}`);
  return async (expectedReads = 1) => {
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
    const calls = await page.evaluate(
      () =>
        (window as unknown as { onboardingCalls: unknown[] }).onboardingCalls,
    );
    expect(calls).toHaveLength(expectedReads);
    const events = await page.evaluate(
      () =>
        (window as unknown as { onboardingEvents: { event: string }[] })
          .onboardingEvents,
    );
    expect(events.every((e) => e.event === "feed_open")).toBe(true);
  };
}
const signIn = (p: Page) =>
    p.getByRole("link", { name: "Sign in to use Following", exact: true }),
  choose = (p: Page) =>
    p.getByRole("link", { name: "Choose boards to follow", exact: true });
for (const native of [false, true])
  for (const path of ["/", "/forum"])
    test(`guest Following explanation has a safe full-context ${native ? "native" : "website"} handoff from ${path}`, async ({
      page,
    }) => {
      const check = await harness(
        page,
        `scenario=guest&view=community&scope=following&sort=unanswered&authors=agents&redirectTo=https%3A%2F%2Fevil.invalid${native ? "&native" : ""}`,
        "platform",
        path,
      );
      await expect(
        page.getByRole("button", { name: "Following", exact: true }),
      ).toBeDisabled();
      await expect(signIn(page)).toBeVisible();
      const href = new URL((await signIn(page).getAttribute("href"))!);
      expect(href.origin).toBe("https://forum.symbaiex.com");
      expect(href.pathname).toBe("/signin");
      expect(
        await signIn(page).getAttribute("data-forum-owner-control"),
      ).not.toBeNull();
      const back = new URL(href.searchParams.get("redirectTo")!, href.origin);
      expect(back.origin).toBe(href.origin);
      expect(back.pathname).toBe("/");
      expect([...back.searchParams]).toEqual([
        ["view", "community"],
        ["scope", "following"],
        ["authors", "agents"],
        ["sort", "unanswered"],
      ]);
      await page
        .getByRole("combobox", { name: "Authors", exact: true })
        .focus();
      await page.keyboard.press("Tab");
      await expect(signIn(page)).toBeFocused();
      await check();
    });
for (const native of [false, true])
  for (const authors of ["all", "humans", "agents"])
    test(`exhausted authenticated Following offers the actual interests control without zero-follow claims (${authors}, ${native ? "native" : "website"})`, async ({
      page,
    }) => {
      const check = await harness(
        page,
        `scope=following&authors=${authors}${native ? "&native" : ""}`,
      );
      await expect(choose(page)).toBeVisible();
      await expect(
        page.getByText("No matching followed discussions", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/You (?:have not|haven’t) followed|No boards followed/),
      ).toHaveCount(0);
      const href = new URL((await choose(page).getAttribute("href"))!);
      expect(href.origin).toBe("https://forum.symbaiex.com");
      expect(href.pathname).toBe("/catch-up");
      expect(href.hash).toBe("#interests");
      expect(
        await choose(page).getAttribute("data-forum-owner-control"),
      ).not.toBeNull();
      await expect(
        page.getByRole("button", {
          name: "Load more discussions",
          exact: true,
        }),
      ).toHaveCount(0);
      await check();
    });
test("failed refresh does not turn an old exhausted empty page into fresh Following setup guidance", async ({
  page,
}) => {
  const check = await harness(page, "scope=following&scenario=refresh-error");
  await expect(choose(page)).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText(
      "Could not update the feed. Your loaded discussions are still here.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(choose(page)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Browse boards", exact: true }),
  ).toBeVisible();
  await check(2);
});
for (const scenario of ["scan", "error", "loading", "discover", "community"])
  test(`${scenario} retains its existing loading/error/filtered-scan/discover empty distinction`, async ({
    page,
  }) => {
    const q =
      scenario === "discover"
        ? "scope=discover"
        : scenario === "community"
          ? "scope=discover&view=community"
          : `scope=following&scenario=${scenario}`;
    const check = await harness(page, q);
    if (scenario === "loading")
      await expect(
        page.getByText("Loading discussions", { exact: true }),
      ).toBeAttached();
    else if (scenario === "error")
      await expect(
        page.getByText("Discussions could not load.", { exact: true }),
      ).toBeVisible();
    else if (scenario === "scan") {
      await expect(
        page.getByRole("heading", {
          name: "More discussions ahead",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Load more discussions",
          exact: true,
        }),
      ).toBeVisible();
    } else
      await expect(
        page.getByRole("heading", {
          name: "No discussions here yet",
          exact: true,
        }),
      ).toBeVisible();
    await expect(choose(page)).toHaveCount(0);
    await expect(signIn(page)).toHaveCount(0);
    await check();
  });
for (const app of ["platform", "forum"])
  for (const width of [320, 390, 1280])
    for (const guest of [true, false])
      test(`${app} ${guest ? "guest" : "following"} onboarding fits ${width}px with readable keyboard target`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 });
        const check = await harness(
          page,
          `scope=following${guest ? "&scenario=guest" : ""}`,
          app,
        );
        const link = guest ? signIn(page) : choose(page);
        await expect(link).toBeVisible();
        await link.focus();
        await expect(link).toBeFocused();
        const b = await link.boundingBox();
        expect(b!.height).toBeGreaterThanOrEqual(44);
        expect(b!.x).toBeGreaterThanOrEqual(0);
        expect(b!.x + b!.width).toBeLessThanOrEqual(width);
        const box = await page.locator("main").boundingBox();
        expect(b!.x).toBeGreaterThanOrEqual(box!.x);
        expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width);
        expect(
          await page
            .locator("main")
            .evaluate((n) => n.scrollWidth <= n.clientWidth),
        ).toBe(true);
        await check();
      });
