import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORUM_SHARED_THEME_CSS } from "../../packages/forum-ui/src/theme";
const origin = "http://127.0.0.1:43254";
declare global {
  interface Window {
    __feedRecovery: {
      reads: { args: Record<string, unknown> }[];
      writes: { kind: string; args: unknown }[];
      forbidden: string[];
      settle(index: number, done: boolean, rows?: boolean): void;
      reject(index: number): void;
      ready(): void;
      guest(): void;
    };
  }
}
let script: string;
const css = {} as Record<"platform" | "forum", string>;
const audits = new WeakMap<Page, { errors: string[]; outbound: string[] }>();
test.beforeAll(() => {
  for (const app of ["platform", "forum"] as const)
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
  const baseline =
    process.env.FEED_RECOVERY_BASELINE === "1"
      ? execFileSync(
          "git",
          ["show", "8ba7ac40:components/forum/forum-feed-list.tsx"],
          { encoding: "utf8" },
        )
      : null;
  script = execFileSync(
    "bun",
    [
      "-e",
      `const baseline=${JSON.stringify(baseline)};const r=await Bun.build({entrypoints:["tests/e2e/fixtures/feed-filter-recovery.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production",NEXT_PUBLIC_INSTALLATION_CONFIG:await Bun.file("tests/fixtures/installation.symbaiex.json").text()})},plugins:[{name:"read-only-feed",setup(build){if(baseline!==null)build.onLoad({filter:/forum-feed-list\\.tsx$/},()=>({contents:baseline,loader:"tsx"}));build.onResolve({filter:/^convex\\/react$|^next\\/navigation$|^next\\/link$|forum-primitives$|forum-feed-starter$|forum-media-gallery$|app-error-surface$/},()=>({path:process.cwd()+"/tests/e2e/fixtures/feed-filter-recovery-state.tsx"}));}}]});if(!r.success)throw Error(r.logs.join("\\n"));process.stdout.write(await r.outputs[0].text());`,
    ],
    { encoding: "utf8", maxBuffer: 6 * 1024 * 1024 },
  );
});
async function harness(
  page: Page,
  query = "scope=discover&authors=humans",
  app: "platform" | "forum" = "platform",
) {
  const audit = { errors: [] as string[], outbound: [] as string[] };
  audits.set(page, audit);
  page.on("pageerror", (e) => audit.errors.push(e.message));
  await page.clock.install({ time: new Date("2026-11-01T12:00:00Z") });
  await page.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin === origin && u.pathname === "/forum")
      return r.fulfill({
        contentType: "text/html",
        body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css[app]}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (u.origin === origin && u.pathname === "/fixture.js")
      return r.fulfill({ contentType: "text/javascript", body: script });
    audit.outbound.push(u.href);
    return r.abort();
  });
  const params = new URLSearchParams("view=feed&sort=active");
  for (const [key, value] of new URLSearchParams(query)) params.set(key, value);
  await page.goto(`${origin}/forum?${params}`);
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__feedRecovery)))
    .toBe(true);
}
async function calls(page: Page, count: number) {
  await expect
    .poll(() => page.evaluate(() => window.__feedRecovery.reads.length))
    .toBe(count);
}
async function settle(page: Page, index = 0, done = false, rows = false) {
  await page.evaluate(
    ({ index, done, rows }) => window.__feedRecovery.settle(index, done, rows),
    { index, done, rows },
  );
}
const reset = (p: Page) =>
  p.getByRole("button", { name: "Show everyone", exact: true });
const discover = (p: Page) =>
  p.getByRole("button", { name: "Explore Discover", exact: true });
const context = (p: Page) => p.getByLabel("Current feed view", { exact: true });
test.afterEach(async ({ page }) => {
  expect(audits.get(page)).toEqual({ errors: [], outbound: [] });
  expect(await page.evaluate(() => window.__feedRecovery.forbidden)).toEqual(
    [],
  );
});
for (const authors of ["humans", "agents"])
  for (const scope of ["discover", "following"])
    test(`${scope}/${authors} intermediate page explains current filters without extra scans`, async ({
      page,
    }) => {
      await harness(page, `scope=${scope}&authors=${authors}`);
      await calls(page, 1);
      await settle(page);
      await expect(context(page)).toContainText(
        `${authors === "humans" ? "Humans" : "Agents"} · ${scope === "following" ? "Following" : "Discover"} · Active`,
      );
      await expect(
        page.getByRole("heading", { name: "More discussions ahead" }),
      ).toBeVisible();
      await expect(
        page.getByText(/continue with the same filters/),
      ).toBeVisible();
      await page.clock.runFor(5000);
      await calls(page, 1);
      expect(
        await page.evaluate(() =>
          window.__feedRecovery.writes.filter((w) => w.kind === "preferences"),
        ),
      ).toEqual([]);
      await page
        .getByRole("button", { name: "Load more discussions", exact: true })
        .click();
      await calls(page, 2);
      const args = await page.evaluate(() =>
        window.__feedRecovery.reads.map((r) => r.args),
      );
      expect(args[1]).toMatchObject({
        scope,
        authorFilter: authors,
        paginationOpts: { numItems: 12, cursor: "opaque-fixture-next" },
      });
      expect(args[0]).toMatchObject({
        paginationOpts: { numItems: 12, cursor: null },
      });
      await settle(page, 1, true, true);
      await expect(page.getByRole("article")).toHaveCount(1);
      await expect(reset(page)).toHaveCount(0);
    });
for (const authors of ["humans", "agents"])
  test(`exhausted Discover/${authors} is a filtered result, not an empty community`, async ({
    page,
  }) => {
    await harness(page, `scope=discover&authors=${authors}`);
    await calls(page, 1);
    await settle(page, 0, true);
    await expect(
      page.getByRole("heading", {
        name: `No matching ${authors === "humans" ? "human" : "agent"} discussions`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No discussions here yet" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Load more discussions" }),
    ).toHaveCount(0);
    await expect(reset(page)).toBeVisible();
  });
test("explicit author reset preserves Following, sort, community and other URL context", async ({
  page,
}) => {
  await harness(
    page,
    "scope=following&authors=humans&view=community&sort=unanswered&keep=unchanged",
  );
  await calls(page, 1);
  await settle(page, 0, true);
  await reset(page).focus();
  await page.keyboard.press("Enter");
  await calls(page, 2);
  const url = new URL(page.url());
  expect(url.searchParams.get("scope")).toBe("following");
  expect(url.searchParams.get("authors")).toBe("all");
  expect(url.searchParams.get("keep")).toBe("unchanged");
  expect(url.searchParams.get("view")).toBe("community");
  expect(url.searchParams.get("sort")).toBe("unanswered");
  expect(
    await page.evaluate(() => window.__feedRecovery.reads[1].args),
  ).toMatchObject({ communityOnly: true, sort: "unanswered" });
  expect(
    await page.evaluate(() =>
      window.__feedRecovery.writes.filter((w) => w.kind === "preferences"),
    ),
  ).toEqual([
    {
      kind: "preferences",
      args: { defaultFeed: "following", authorFilter: "all" },
    },
  ]);
  await settle(page, 1, true);
  await expect(reset(page)).toHaveCount(0);
  await expect(discover(page)).toBeVisible();
});
test("explicit Discover reset keeps the chosen author filter and requests only its first page", async ({
  page,
}) => {
  await harness(page, "scope=following&authors=agents");
  await calls(page, 1);
  await settle(page);
  await discover(page).click();
  await calls(page, 2);
  expect(new URL(page.url()).searchParams.get("authors")).toBe("agents");
  expect(
    await page.evaluate(() => window.__feedRecovery.reads[1].args),
  ).toMatchObject({
    scope: "discover",
    authorFilter: "agents",
    paginationOpts: { cursor: null, numItems: 12 },
  });
  await settle(page, 1, true);
  await expect(context(page)).toContainText("Agents · Discover");
});
test("guest reset never persists preferences or grants Following", async ({
  page,
}) => {
  await harness(page, "scenario=guest&scope=following&authors=humans");
  await calls(page, 1);
  await settle(page);
  await expect(context(page)).toContainText("Humans · Discover");
  await expect(discover(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Following", exact: true }),
  ).toBeDisabled();
  await reset(page).click();
  await calls(page, 2);
  expect(await page.evaluate(() => window.__feedRecovery.writes)).toEqual([]);
  await settle(page, 1, true);
});
test("auth-loading and pending/error states never promise filtered results or perform recovery reads automatically", async ({
  page,
}) => {
  await harness(page, "scenario=auth-loading&scope=following&authors=agents");
  await calls(page, 0);
  await expect(context(page)).toHaveCount(0);
  await page.evaluate(() => window.__feedRecovery.ready());
  await calls(page, 1);
  await expect(reset(page)).toHaveCount(0);
  await page.evaluate(() => window.__feedRecovery.reject(0));
  await expect(
    page.getByText("Discussions could not load.", { exact: true }),
  ).toBeVisible();
  await expect(reset(page)).toHaveCount(0);
  await calls(page, 1);
});
for (const app of ["platform", "forum"] as const)
  for (const width of [320, 390])
    test(`${app} ${width}px empty recovery controls fit and remain keyboard/touch accessible`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await harness(page, "scope=following&authors=humans&native", app);
      await calls(page, 1);
      await settle(page);
      const section = page.getByRole("region", {
        name: "Forum discussions",
        exact: true,
      });
      for (const target of [
        section,
        context(page),
        reset(page),
        discover(page),
        page.getByRole("button", {
          name: "Load more discussions",
          exact: true,
        }),
      ]) {
        const b = await target.boundingBox();
        expect(b!.x).toBeGreaterThanOrEqual(0);
        expect(b!.x + b!.width).toBeLessThanOrEqual(width);
      }
      for (const control of [reset(page), discover(page)]) {
        const b = await control.boundingBox();
        expect(b!.height).toBeGreaterThanOrEqual(44);
        expect(b!.width).toBeGreaterThanOrEqual(44);
        await control.focus();
        await expect(control).toBeFocused();
      }
      await page.screenshot({
        path: `tmp/forum-render-tests/feed-filter-recovery-${app}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Enter");
      await calls(page, 2);
      await settle(page, 1, true);
      await expect(context(page)).toContainText("Humans · Discover");
    });
