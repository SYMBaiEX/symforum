import { test, expect, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";

const origin = "http://127.0.0.1:43250";
let script: string;
const css = new Map<string, string>();
const pillars = [
  ["AI", "ai"],
  ["Gaming", "gaming"],
  ["Web3", "crypto"],
  ["Hacking", "hacking"],
  ["Music", "music"],
] as const;
test.beforeAll(() => {
  for (const app of ["platform", "forum"])
    css.set(
      app,
      FORUM_SHARED_THEME_CSS +
        readFileSync("styles/forum-shared.css", "utf8") +
        execFileSync(
          "bun",
          [
            "-e",
            `import postcss from "postcss";import tailwind from "tailwindcss";import config from "./tailwind.config.ts";const css=(await Bun.file("apps/${app}/app/globals.css").text()).replace(/^@import.*$/m,"");process.stdout.write((await postcss([tailwind(config)]).process(css,{from:undefined})).css);`,
          ],
          { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
        ),
    );
  script = execFileSync(
    "bun",
    [
      "-e",
      `const r=await Bun.build({entrypoints:["tests/e2e/fixtures/start-here-pillars.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"isolated-pillars",setup(build){build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^next\\/link$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/start-here-pillars-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));for(const file of r.outputs){if(file.path.endsWith(".css"))process.stdout.write(";document.head.appendChild(Object.assign(document.createElement('style'),{textContent:"+JSON.stringify(await file.text())+"}));");else if(file.path.endsWith(".js"))process.stdout.write(await file.text());}`,
    ],
    { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
  );
});
const trigger = (page: Page) =>
  page.getByRole("button", { name: "Share a work in progress", exact: true });
const calls = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          pillarCalls: {
            auth: number;
            navigation: string[];
            readingNavigation: number;
          };
        }
      ).pillarCalls,
  );
async function harness(
  page: Page,
  path = "/start-here",
  scenario = "guest",
  app = "forum",
) {
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === path)
      return route.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.get(app)}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.origin === origin && url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    unexpected.push(url.href);
    return route.abort();
  });
  await page.goto(
    `${origin}${path}?scenario=${scenario}${scenario === "disabled" ? "&disabled" : ""}`,
  );
  await expect(trigger(page)).toBeVisible();
  return {
    check: () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}
async function bounded(control: Locator, width: number) {
  await control.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await control.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(44);
  const box = await control.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(
    await control.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return hit === node || node.contains(hit);
    }),
  ).toBe(true);
}

for (const path of ["/start-here", "/forum/start-here"]) {
  const prefix = path.startsWith("/forum") ? "/forum" : "";
  test(`${path}: all five choices are explicit host-aware board links and opening does no work`, async ({
    page,
  }) => {
    const run = await harness(page, path);
    const before = await calls(page),
      url = page.url();
    await trigger(page).click();
    await expect(
      page.getByRole("menu", { name: "Share a work in progress", exact: true }),
    ).toHaveAttribute("data-surface", "forum");
    await expect(page.getByRole("menuitem")).toHaveCount(5);
    for (const [label, slug] of pillars) {
      const choice = page.getByRole("menuitem", { name: label, exact: true });
      await expect(choice).toHaveAttribute("href", `${prefix}/${slug}`);
      await expect(choice).toHaveAttribute("data-fixture-prefetch", "false");
    }
    expect(page.url()).toBe(url);
    expect(await calls(page)).toEqual(before);
    await expect(
      page.getByRole("menuitem", { name: /archive|research|projects|news/i }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(trigger(page)).toBeFocused();
    for (const [label, slug] of pillars) {
      await trigger(page).click();
      await page.getByRole("menuitem", { name: label, exact: true }).click();
      expect((await calls(page)).navigation.at(-1)).toBe(`${prefix}/${slug}`);
    }
    expect((await calls(page)).navigation).toHaveLength(5);
    expect((await calls(page)).readingNavigation).toBe(5);
    run.check();
  });
  for (const scenario of ["guest", "loading", "member", "disabled"])
    test(`${path}: ${scenario} keeps existing join and other actions`, async ({
      page,
    }) => {
      const run = await harness(page, path, scenario);
      const interests = `${prefix}/catch-up#interests`;
      if (scenario === "guest") {
        const join = page.getByRole("link", {
          name: "Sign in to join",
          exact: true,
        });
        const href = await join.getAttribute("href");
        expect(new URL(href!, origin).pathname).toBe("/signin");
        expect(new URL(href!, origin).searchParams.get("redirectTo")).toBe(
          interests,
        );
      } else {
        await expect(
          page.getByRole("link", {
            name: "Choose your interests",
            exact: true,
          }),
        ).toHaveAttribute("href", interests);
        await expect(
          page.getByRole("link", { name: "Sign in to join", exact: true }),
        ).toHaveCount(0);
      }
      for (const [label, href] of [
        ["Introduce yourself", `${prefix}/general-introductions`],
        ["Join a conversation", `${prefix || "/"}?view=feed&sort=unanswered`],
        ["Browse all boards", `${prefix || "/"}?view=boards`],
        ["Explore the trading terminal", `${prefix}/trade`],
        ["Community tools & research", `${prefix}/community`],
      ])
        await expect(
          page.getByRole("link", { name: label, exact: true }),
        ).toHaveAttribute("href", href);
      const before = await calls(page);
      expect(before.auth).toBe(scenario === "disabled" ? 0 : 1);
      await trigger(page).click();
      await page.keyboard.press("Escape");
      expect(await calls(page)).toEqual(before);
      run.check();
    });
}

test("keyboard opens, chooses deliberately, closes and restores trigger focus", async ({
  page,
}) => {
  const run = await harness(page);
  await trigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: "AI", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Gaming", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger(page)).toBeFocused();
  expect((await calls(page)).navigation).toEqual([]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "Music", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  expect((await calls(page)).navigation).toEqual(["/music"]);
  run.check();
});

for (const app of ["platform", "forum"])
  for (const width of [320, 390])
    test(`${app} ${width}px: pillar choices stay bounded and touch accessible`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      const run = await harness(
        page,
        app === "forum" ? "/start-here" : "/forum/start-here",
        "guest",
        app,
      );
      await bounded(trigger(page), width);
      await trigger(page).click();
      const menu = await page.getByRole("menu").boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
      for (const [label] of pillars)
        await bounded(
          page.getByRole("menuitem", { name: label, exact: true }),
          width,
        );
      await page.screenshot({
        path: `tmp/start-here-pillars/${app}-${width}-choices.png`,
      });
      await page.keyboard.press("Escape");
      await expect(trigger(page)).toBeFocused();
      const card = await trigger(page).evaluate((node) => {
        const card = node.closest("li")!;
        const rect = card.getBoundingClientRect();
        return {
          x: rect.x,
          right: rect.right,
          scroll: card.scrollWidth,
          width: card.clientWidth,
        };
      });
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.right).toBeLessThanOrEqual(width);
      expect(card.scroll).toBeLessThanOrEqual(card.width);
      await page.screenshot({
        path: `tmp/start-here-pillars/${app}-${width}.png`,
      });
      run.check();
    });
